import { getDb, type Database } from "@onelife/db";
import { loadConfig } from "./config.js";
import { buildObituaryPrompt, parseObituary, type Obituary } from "./prompt.js";
import { checkDraft, type CompletionClient } from "./generate.js";
import { loadObituaryInputs } from "./inputs.js";
import { targetForLife } from "./pg-store.js";
import { openrouterClient } from "./openrouter.js";

/**
 * `pnpm --filter @onelife/newsdesk run preview -- --life <id> [--life <id> ...] [--generate]`
 *
 * Builds the obituary-v4 facts for each named life through the same functions as the tick
 * (`loadObituaryInputs`) and prints the prompt. With `--generate` it also asks the model for ONE
 * draft and prints it with the result of both checks (no-place and cause), without the retry the
 * tick would give it, so a rejection is visible.
 *
 * ⚠️ It WRITES NOTHING: no article, no failure stub, no attempt. It ignores the tick's gates
 * (qualification, NEWSDESK_SINCE, an existing article) on purpose, so the operator can read any
 * death; a life with no final verdict says so and is skipped, as the tick would skip it.
 * `NEWSDESK_DRY_RUN` cannot serve this purpose: in dry-run the tick logs only gamertag, life id and
 * map. `--generate` calls the model with the operator's own key and costs money.
 */

export interface PreviewArgs { lives: number[]; generate: boolean }

export function parsePreviewArgs(argv: string[]): PreviewArgs {
  const lives: number[] = [];
  let generate = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--generate") generate = true;
    else if (a === "--life") {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n <= 0) throw new Error(`--life needs a life id, got ${argv[i] ?? "nothing"}`);
      lives.push(n);
    } else if (a === "--") continue;
    else throw new Error(`unknown argument ${a}`);
  }
  if (lives.length === 0) throw new Error("usage: preview --life <id> [--life <id> ...] [--generate]");
  return { lives, generate };
}

export interface PreviewDeps {
  /** Required with --generate; never called without it. */
  client: CompletionClient | null;
  out: (line: string) => void;
}

const showDraft = (o: Obituary): string => JSON.stringify(o, null, 2);

/** Returns the number of lives that could not be previewed (0 = all printed). */
export async function runPreview(db: Database, args: PreviewArgs, deps: PreviewDeps): Promise<number> {
  if (args.generate && !deps.client) throw new Error("--generate needs a model client (OPENROUTER_API_KEY)");
  let missed = 0;
  for (const lifeId of args.lives) {
    deps.out(`=== life ${lifeId} ===`);
    const target = await targetForLife(db, lifeId);
    if (!target) {
      deps.out("no ended life with this id");
      missed++;
      continue;
    }
    const inputs = await loadObituaryInputs(db, target);
    if (!inputs) {
      deps.out("no final verdict yet (none stored, or held for review): no obituary would be written");
      missed++;
      continue;
    }
    const { system, user } = buildObituaryPrompt(inputs.facts);
    deps.out(`--- prompt (verdict version ${inputs.verdictVersion}; the system prompt is OBITUARY_SYSTEM in voice.ts) ---`);
    deps.out(user);
    if (!args.generate) continue;
    let draft: Obituary;
    try {
      draft = parseObituary(await deps.client!.complete({ system, user }));
    } catch (e) {
      deps.out(`--- generation failed: ${e instanceof Error ? e.message : String(e)} ---`);
      missed++;
      continue;
    }
    deps.out("--- draft ---");
    deps.out(showDraft(draft));
    const v = checkDraft(draft, inputs.facts, inputs.hints);
    deps.out(`--- no-place check: ${v.place.length ? `REJECTED: ${v.place.join(", ")}` : "pass"} ---`);
    deps.out(`--- cause check: ${v.cause.length ? `REJECTED:\n${v.cause.map((c) => `  ${c}`).join("\n")}` : "pass"} ---`);
  }
  return missed;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parsePreviewArgs(process.argv.slice(2));
  const cfg = loadConfig(process.env);
  if (args.generate && cfg.openrouterApiKey === "") throw new Error("--generate needs OPENROUTER_API_KEY");
  const { db, sql } = getDb(cfg.databaseUrl);
  const client = args.generate
    ? openrouterClient({ apiKey: cfg.openrouterApiKey, model: cfg.model, temperature: cfg.temperature })
    : null;
  runPreview(db, args, { client, out: (l) => console.log(l) })
    .then((missed) => { process.exitCode = missed ? 1 : 0; })
    .catch((e) => { console.error(e); process.exitCode = 1; })
    .finally(() => sql.end());
}
