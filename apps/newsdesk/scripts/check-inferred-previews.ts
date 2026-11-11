import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import { getDb, type Database } from "@onelife/db";
import { loadConfig } from "../src/config.js";
import { assertTestDatabase } from "@onelife/test-support";
import { buildObituaryPrompt, parseObituary } from "../src/prompt.js";
import { checkDraft, type CompletionClient } from "../src/generate.js";
import { loadObituaryInputs, type ObituaryInputs } from "../src/inputs.js";
import { recentProse, RECENT_PROSE_LIMIT, type RecentProse } from "../src/prose-pg-store.js";
import { targetForLife } from "../src/pg-store.js";
import { openrouterClient } from "../src/openrouter.js";

/**
 * Tune the cause check before the release 3 gate (death-verdict plan step 8).
 *
 *   pnpm --filter @onelife/newsdesk run check-inferred-previews -- [--seed] [--drafts 3] [--sample 10] [--only inferred|unknown|traps] [--life <id> ...]
 *
 * Three groups of deaths, each drafted N times (3 by default) from the obituary-v4 prompt the tick
 * would send (the recent-prose block included):
 *   - inferred: every death whose public cause is shown as a best reading (rule 4);
 *   - unknown: the first `--sample` deaths (10 by default) shown with no cause, not recorded or
 *     withheld (rule 2);
 *   - traps: every life whose obituary counts a trap kill, this life or earlier (rule 6).
 * It runs `findCauseViolations` and `findPlaceViolations` on each FIRST draft (no retry) and
 * prints every rejection with the rule and the sentence. Read them: an honest sentence that was
 * rejected is a word list to fix in `cause-check.ts`. The number of clean drafts rejected, per
 * group, goes in the PR description and must be zero before release 3.
 *
 * ⚠️ RUN IT ONLY AGAINST A LOCAL TEST DATABASE, never production. It refuses a DATABASE_URL that is
 * not on this machine (localhost / 127.0.0.1 / ::1) AND whose database name does not end in
 * `_test` (the repo's `assertTestDatabase` guard). Production's database is also on 127.0.0.1, so
 * the host test alone would not do. It writes nothing except with `--seed`.
 * ⚠️ It calls the model with OPENROUTER_API_KEY and costs money (about 3 calls per life).
 * ⚠️ PRIVATE output: the drafts are about real players. Read them on your own machine and paste
 * only counts anywhere public.
 *
 * `--seed` loads the private One Life export from `$DEATH_GOLDEN_DIR` into the (empty) database
 * with the projector's `seedCorpus` and runs the verdict sweep until it settles, the same way the
 * private sweep suite does. Without it the database must already hold the corpus and its verdicts.
 */

export type Group = "inferred" | "unknown" | "traps";
export const GROUPS: readonly Group[] = ["inferred", "unknown", "traps"];

export interface CheckOptions {
  drafts: number;
  lives: number[] | null;
  /** How many deaths shown with no cause to draft (the unknown group). */
  sample?: number;
  /** Draft only these groups (all three by default). Ignored with `lives`. */
  only?: Group[] | null;
}

export interface CheckResult {
  lives: number; drafts: number; rejected: number; failed: number;
  /** Lives, drafts and rejections per group. */
  byGroup: Record<Group, { lives: number; drafts: number; rejected: number }>;
}

/** Does this death belong to the group, by what the writer is shown? */
export function inGroup(group: Group, i: ObituaryInputs): boolean {
  if (group === "inferred") return i.facts.death.certainty === "inferred";
  if (group === "unknown") return i.facts.death.certainty === "unknown";
  return i.facts.trapKills > 0 || i.facts.priors.trapKills > 0;
}

/** Candidate lives per group, before the shown-certainty filter. */
async function candidateLives(db: Database, group: Group): Promise<number[]> {
  const q = group === "inferred"
    ? sql`SELECT life_id AS id FROM death_verdicts
          WHERE NOT needs_review AND (confidence = 'inferred' OR upstream_confidence = 'inferred') ORDER BY life_id`
    : group === "unknown"
      ? sql`SELECT life_id AS id FROM death_verdicts WHERE NOT needs_review ORDER BY life_id`
      : sql`SELECT DISTINCT l.id FROM lives l
            WHERE l.ended_at IS NOT NULL
              AND EXISTS (SELECT 1 FROM kills k WHERE k.basis = 'trap_placement' AND k.killer_player_id = l.player_id)
            ORDER BY l.id`;
  const rows = (await db.execute(q)) as unknown as { id: string | number }[];
  return rows.map((r) => Number(r.id));
}

export async function checkInferredPreviews(
  db: Database,
  opts: CheckOptions,
  deps: { client: CompletionClient; out: (line: string) => void },
): Promise<CheckResult> {
  const res: CheckResult = {
    lives: 0, drafts: 0, rejected: 0, failed: 0,
    byGroup: { inferred: { lives: 0, drafts: 0, rejected: 0 }, unknown: { lives: 0, drafts: 0, rejected: 0 }, traps: { lives: 0, drafts: 0, rejected: 0 } },
  };
  // The tick sends the do-not-reuse block; so does this run, or the drafts it tunes against differ.
  const recent: RecentProse[] = await recentProse(db, "obituary", RECENT_PROSE_LIMIT);
  const sample = opts.sample ?? 10;
  const plan: [Group | null, number[]][] = opts.lives
    ? [[null, opts.lives]]
    : await Promise.all((opts.only ?? GROUPS).map(async (g) => [g, await candidateLives(db, g)] as [Group, number[]]));
  for (const [group, ids] of plan) {
    if (group) deps.out(`=== ${group} ===`);
    let taken = 0;
    for (const lifeId of ids) {
      if (group === "unknown" && taken >= sample) break;
      const target = await targetForLife(db, lifeId);
      const inputs = target ? await loadObituaryInputs(db, target) : null;
      if (!inputs) { if (!group) deps.out(`life ${lifeId}: no final verdict, skipped`); continue; }
      if (group && !inGroup(group, inputs)) continue;
      taken++;
      await draftLife(lifeId, inputs, group);
    }
  }

  async function draftLife(lifeId: number, inputs: ObituaryInputs, group: Group | null): Promise<void> {
    if (!group) deps.out(`life ${lifeId}: shown as ${inputs.facts.death.certainty}`);
    res.lives++;
    if (group) res.byGroup[group].lives++;
    const { system, user } = buildObituaryPrompt(inputs.facts, recent);
    for (let n = 1; n <= opts.drafts; n++) {
      res.drafts++;
      if (group) res.byGroup[group].drafts++;
      let v: { place: string[]; cause: string[] };
      let headline = "";
      try {
        const draft = parseObituary(await deps.client.complete({ system, user }));
        headline = draft.headline;
        v = checkDraft(draft, inputs.facts, inputs.hints);
      } catch (e) {
        res.failed++;
        deps.out(`life ${lifeId} draft ${n}: generation failed: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      if (v.place.length === 0 && v.cause.length === 0) {
        deps.out(`life ${lifeId} draft ${n}: pass`);
        continue;
      }
      res.rejected++;
      if (group) res.byGroup[group].rejected++;
      deps.out(`life ${lifeId} draft ${n}: REJECTED ("${headline}")`);
      for (const c of v.cause) deps.out(`  ${c}`);
      if (v.place.length) deps.out(`  no-place: ${v.place.join(", ")}`);
    }
  }

  deps.out("");
  for (const g of GROUPS) {
    const b = res.byGroup[g];
    if (b.lives) deps.out(`${g}: ${b.lives} lives, ${b.drafts} drafts, ${b.rejected} rejected.`);
  }
  deps.out(`${res.lives} lives, ${res.drafts} drafts, ${res.rejected} rejected, ${res.failed} failed to generate.`);
  deps.out("Read every rejection. Count the ones whose sentences were honest (hedged, nothing invented): that is the number of clean drafts rejected, and it must be 0 before release 3.");
  return res;
}

/**
 * The URL is a local TEST database: its host is this machine and its name ends in `_test`
 * (`assertTestDatabase`, fail-closed). ⚠️ The host test alone accepts production, whose database
 * is host Postgres at 127.0.0.1 too (deploy/README.md), and a developer's `onelife` database.
 */
export function isLocalDatabase(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
    if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") return false;
    assertTestDatabase(url);
    return true;
  } catch {
    return false;
  }
}

export function parseArgs(argv: string[]): CheckOptions & { seed: boolean } {
  let drafts = 3, sample = 10, seed = false;
  const lives: number[] = [];
  const only: Group[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--") continue;
    if (a === "--seed") seed = true;
    else if (a === "--drafts") drafts = Number(argv[++i]);
    else if (a === "--sample") sample = Number(argv[++i]);
    else if (a === "--only") {
      const g = argv[++i] as Group;
      if (!GROUPS.includes(g)) throw new Error(`--only needs one of ${GROUPS.join(", ")}`);
      only.push(g);
    } else if (a === "--life") lives.push(Number(argv[++i]));
    else throw new Error(`unknown argument ${a}`);
  }
  if (!Number.isInteger(drafts) || drafts < 1) throw new Error("--drafts needs a positive whole number");
  if (!Number.isInteger(sample) || sample < 0) throw new Error("--sample needs a whole number");
  if (lives.some((n) => !Number.isInteger(n) || n <= 0)) throw new Error("--life needs a life id");
  return { drafts, sample, only: only.length ? only : null, lives: lives.length ? lives : null, seed };
}

/** Seeds the private export and sweeps it, through the projector's own code (dynamic import, so
 *  newsdesk does not depend on the projector at type level). */
async function seed(db: Database, gold: string): Promise<void> {
  const [row] = (await db.execute(sql`SELECT count(*) AS n FROM lives`)) as unknown as { n: string }[];
  if (Number(row?.n ?? 0) > 0) throw new Error("--seed needs an empty database (it holds lives already)");
  const here = dirname(fileURLToPath(import.meta.url));
  const seedPath = join(here, "../../projector/test/golden-private/seed-corpus.ts");
  const sweepPath = join(here, "../../projector/src/verdict-sweep.ts");
  const { seedCorpus } = (await import(pathToFileURL(seedPath).href)) as { seedCorpus: (db: Database, gold: string) => Promise<{ deadLives: number }> };
  const { sweepVerdicts } = (await import(pathToFileURL(sweepPath).href)) as {
    sweepVerdicts: (db: Database, o: Record<string, unknown>) => Promise<{ written: number; failed: number }>;
  };
  const { deadLives } = await seedCorpus(db, gold);
  console.log(`seeded ${deadLives} dead lives; sweeping`);
  const log = { info: () => {}, warn: () => {}, error: () => {} };
  for (let i = 0; i < 20; i++) {
    const r = await sweepVerdicts(db, { now: new Date(), log, trapKillsWrite: true, limit: 2000, budgetMs: 3_600_000 });
    if (r.written === 0 && r.failed === 0) break;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const cfg = loadConfig(process.env);
  if (!isLocalDatabase(cfg.databaseUrl)) throw new Error("refusing: DATABASE_URL is not a local *_test database. Never run this against production.");
  if (cfg.openrouterApiKey === "") throw new Error("OPENROUTER_API_KEY is unset");
  const { db, sql: end } = getDb(cfg.databaseUrl);
  (async () => {
    if (args.seed) {
      const gold = process.env.DEATH_GOLDEN_DIR;
      if (!gold || !existsSync(join(gold, "corpus"))) throw new Error("--seed needs DEATH_GOLDEN_DIR");
      await seed(db, gold);
    }
    const client = openrouterClient({ apiKey: cfg.openrouterApiKey, model: cfg.model, temperature: cfg.temperature });
    const r = await checkInferredPreviews(db, args, { client, out: (l) => console.log(l) });
    process.exitCode = r.failed ? 1 : 0;
  })()
    .catch((e) => { console.error(e); process.exitCode = 1; })
    .finally(() => end.end());
}
