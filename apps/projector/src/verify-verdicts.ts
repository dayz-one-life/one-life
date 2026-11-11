import { readFileSync, writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import pino from "pino";
import { getDb, type Database } from "@onelife/db";
import { CLASSIFIER_VERSION, SPAWN_BASELINES, objectKeyFromText, spawnAt, type CreditEvidence, type SpawnBaseline } from "@onelife/death-verdict";
import { deathSeedOf, newFileCache } from "@onelife/read-models";
import {
  deriveLife, lifeCountsOnItsOwn, overrideOf, overrideProblem, verdictRow, HELD_ATTEMPTS,
} from "./verdict-sweep.js";

/**
 * The operator's check of the stored death verdicts (death-verdict spec 5.5). READ-ONLY: it writes
 * nothing, anywhere. The exit code is non-zero on any failure.
 *
 *   pnpm --filter @onelife/projector run verify-verdicts -- [--golden <classified.jsonl>] [--csv <out>]
 *     [--rederive] [--held] [--credits] [--expect-trap <fileId:lineIndex>]
 *
 * ⚠️ Its output names players (the credits list, held lives, the golden diff). Read it on the host;
 * never paste it into the public repository, an issue or a PR. The golden file is copied to the
 * host by hand, outside the checkout, and deleted afterwards.
 */

export interface VerifyOptions {
  golden?: string | null;
  csv?: string | null;
  rederive?: boolean;
  held?: boolean;
  credits?: boolean;
  /** `fileId:lineIndex` of a death that must be explosive_trap / definitive / m67_grenade / A07. */
  expectTrap?: string | null;
  trapKillsWrite?: boolean;
  /** Test seams: the clock, and a spawn table in place of the checked-in one (check 7). */
  now?: Date;
  spawnTable?: Readonly<Record<number, readonly SpawnBaseline[]>>;
}

/** A death this long after its life ended with no reviewable verdict at this version is overdue. */
export const OVERDUE_MINUTES = 45;

/**
 * The spawn level behind a stat read within 120 s of a respawn: the smallest level seen in the data
 * that is at or above it (the reference's `spawn_level`).
 */
export function spawnLevel(v: number): number {
  for (const k of [600, 750, 1000]) if (v <= k + 1) return k;
  return Math.ceil(v / 50) * 50;
}

export interface VerifyReport { ok: boolean; lines: string[]; failures: string[]; csv: string | null }

type Row = Record<string, unknown>;
async function q<T extends Row = Row>(db: Database, s: ReturnType<typeof sql>): Promise<T[]> {
  return (await db.execute<T>(s)) as unknown as T[];
}
const n = (v: unknown): number => Number(v ?? 0);
const isoS = (d: unknown): string => new Date(d as string).toISOString().replace(/\.\d{3}Z$/, "Z");

/** The same multiset comparison as the golden parity harness. */
function sameBag(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const x = [...a].sort(), y = [...b].sort();
  return x.every((v, i) => v === y[i]);
}
/** The basis a reference rule and role allow (the parity harness's check 7). */
export function basisOf(rule: string, role: string): string {
  if (role === "killer" || role === "grenade_holder") return "kill_line";
  if (role === "driver") return "kill_line_driver";
  if (role === "self") return "kill_line_self";
  if (role === "trap_owner" && (rule === "A06" || rule === "A07" || rule === "A09")) return "placement";
  return "not_stated";
}

interface GoldenRow {
  uid: string; project: string; cause: string; confidence: string; rule: string; mechanism_stated: boolean;
  upstream_cause: string | null; upstream_confidence: string | null; co_causes: string[]; weapon_or_object: string | null;
  attributed_to: { role: string; id: string; confidence: string } | null;
  contributors: { id: string; role: string; confidence: string }[]; flags: string[];
  death_lines: { ref: string; role: string }[]; utc: string;
}

/** The parity checks (1 to 10) a stored row fails against the reference's answer. */
export function failedGoldenChecks(v: Row, e: GoldenRow): number[] {
  const bad: number[] = [];
  const ev = (v.evidence ?? {}) as { flags?: string[]; contributors?: { dayzId: string; role: string; confidence: string }[]; deathLines?: { admFileId: number; lineIndex: number; role: string }[] };
  if (v.cause !== e.cause) bad.push(1);
  if (v.confidence !== e.confidence || v.mechanism_stated !== e.mechanism_stated) bad.push(2);
  if (v.rule !== e.rule) bad.push(3);
  if ((v.upstream_cause ?? null) !== e.upstream_cause || (v.upstream_confidence ?? null) !== e.upstream_confidence) bad.push(4);
  if (!sameBag((v.co_causes as string[]) ?? [], e.co_causes)) bad.push(5);
  const text = (v.object_text as string | null) ?? null;
  if (text !== e.weapon_or_object || ((v.object_key as string | null) ?? null) !== (text == null ? null : objectKeyFromText(text))) bad.push(6);
  const ea = e.attributed_to;
  if ((v.attr_role == null) !== (ea == null) || (ea && (v.attr_role !== ea.role || v.attr_dayz_id !== ea.id || v.attr_confidence !== ea.confidence || v.attr_basis !== basisOf(e.rule, ea.role)))) bad.push(7);
  if (isoS(v.death_at) !== e.utc) bad.push(8);
  const lines = (ev.deathLines ?? []).map((l) => `${l.admFileId}:${l.lineIndex}=${l.role}`).join(" ");
  const [project, server] = e.uid.split("-");
  if (lines !== e.death_lines.map((l) => `${l.ref}=${l.role}`).join(" ")
    || `${project}-${server}-${n(v.death_file_id)}-${n(v.death_line_index)}` !== e.uid) bad.push(9);
  const people = (xs: readonly { id: string; role: string; confidence: string }[]) => xs.map((c) => `${c.id}|${c.role}|${c.confidence}`);
  if (!sameBag(ev.flags ?? [], e.flags)
    || !sameBag(people((ev.contributors ?? []).map((c) => ({ id: c.dayzId, role: c.role, confidence: c.confidence }))), people(e.contributors))) bad.push(10);
  return bad;
}

/**
 * The evidence half of a credit (tests 1 to 5) as the policy half left it, with tests 6 and 7
 * counted as passing. ⚠️ Compare a stored credit only with a fresh credit that went through the same
 * policy half (`Derivation.credit`), never with the classifier's raw one: a grant or a deny
 * overwrites the outcome, and a grant to another placer clears the placement.
 */
function evidenceHalf(c: CreditEvidence | null): string {
  if (!c) return "none";
  const passed = ["evidence_passes", "credited", "granted", "denied"].includes(c.outcome) || (c.outcome === "refused" && (c.refusedBy ?? 0) >= 6);
  const out = c.outcome === "not_applicable" ? "not_applicable" : passed ? "evidence_passes" : `refused:${c.refusedBy}`;
  return `${out}|${c.placement ? `${c.placement.admFileId}:${c.placement.lineIndex}` : "-"}`;
}

export async function verifyVerdicts(db: Database, o: VerifyOptions = {}): Promise<VerifyReport> {
  const lines: string[] = [];
  const failures: string[] = [];
  const fail = (m: string) => { failures.push(m); lines.push(`FAIL ${m}`); };
  const say = (m: string) => lines.push(m);
  let csv: string | null = null;

  // 1. Row count and held lives.
  const [c1] = await q(db, sql`
    SELECT (SELECT count(*) FROM lives WHERE ended_at IS NOT NULL) AS dead,
           (SELECT count(*) FROM death_verdicts WHERE classifier_version = ${CLASSIFIER_VERSION}) AS current,
           (SELECT count(*) FROM death_verdicts) AS total`);
  say(`1. ended lives ${n(c1!.dead)}, verdicts at version ${CLASSIFIER_VERSION}: ${n(c1!.current)} (all versions ${n(c1!.total)})`);
  if (n(c1!.dead) !== n(c1!.current)) fail(`check 1: ${n(c1!.dead) - n(c1!.current)} ended lives have no verdict at version ${CLASSIFIER_VERSION}`);
  const held = await q(db, sql`SELECT life_id, attempts, last_error, next_attempt_at FROM death_verdict_queue WHERE attempts >= ${o.held ? 1 : HELD_ATTEMPTS} ORDER BY life_id`);
  for (const h of held) {
    // A held life has no stored verdict, so no resolved line: its override goes on the death event.
    const seed = o.held ? await deathSeedOf(db, n(h.life_id)) : null;
    say(`   queue: life ${n(h.life_id)} attempts ${n(h.attempts)} next ${isoS(h.next_attempt_at)}: ${String(h.last_error ?? "")}${
      seed ? `; override key (death event) ${seed.admFileId}:${seed.lineIndex}` : ""}`);
  }
  if (o.held) {
    // Lives that block their obituary: a needs_review row, and every ended life that has waited
    // more than OVERDUE_MINUTES for a reviewable verdict at this version.
    const review = await q(db, sql`
      SELECT v.life_id, v.cause, v.attr_basis, l.death_cause FROM death_verdicts v JOIN lives l ON l.id = v.life_id
      WHERE v.needs_review ORDER BY v.life_id`);
    for (const r of review) say(`   needs_review: life ${n(r.life_id)} ${String(r.cause)} (basis ${String(r.attr_basis ?? "none")}, life row ${String(r.death_cause ?? "none")})`);
    const cutoff = new Date((o.now ?? new Date()).getTime() - OVERDUE_MINUTES * 60_000).toISOString();
    const waiting = await q(db, sql`
      SELECT l.id, v.classifier_version, v.needs_review, qq.last_error FROM lives l
      LEFT JOIN death_verdicts v ON v.life_id = l.id
      LEFT JOIN death_verdict_queue qq ON qq.life_id = l.id
      WHERE l.ended_at IS NOT NULL AND l.ended_at < ${cutoff}::timestamptz
        AND (v.life_id IS NULL OR v.classifier_version <> ${CLASSIFIER_VERSION} OR v.needs_review)
      ORDER BY l.ended_at`);
    say(`   waiting over ${OVERDUE_MINUTES} min for a reviewable verdict: ${waiting.length}`);
    for (const w of waiting.slice(0, 50)) {
      const why = w.classifier_version == null ? (w.last_error ? `failing: ${String(w.last_error)}` : "no verdict yet")
        : w.needs_review ? "needs_review" : `verdict at version ${n(w.classifier_version)}`;
      say(`     life ${n(w.id)}: ${why}`);
    }
  }
  const heldCount = held.filter((h) => n(h.attempts) >= HELD_ATTEMPTS).length;
  if (heldCount > 0) fail(`check 1: ${heldCount} held lives`);

  // 2. The golden diff.
  if (o.golden) {
    const rows = readFileSync(o.golden, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as GoldenRow).filter((r) => r.project === "OL");
    const stored = await q(db, sql`SELECT * FROM death_verdicts`);
    const byLine = new Map(stored.map((v) => [`${n(v.death_file_id)}:${n(v.death_line_index)}`, v]));
    const out = ["uid,checks"];
    let diffs = 0;
    for (const e of rows) {
      const [, , f, l] = e.uid.split("-");
      const v = byLine.get(`${f}:${l}`);
      const bad = v ? failedGoldenChecks(v, e) : [0];
      if (bad.length) { diffs++; out.push(`${e.uid},${bad.join(" ")}`); }
    }
    csv = out.join("\n") + "\n";
    say(`2. golden: ${rows.length} rows, ${diffs} differ (check 0 = no stored verdict on that line)`);
    if (diffs) fail(`check 2: ${diffs} golden rows differ`);
  } else say("2. golden: skipped (no --golden)");

  // 3. The tier-A audit table.
  const [audit] = await q(db, sql`SELECT to_regclass('death_backfill_audit_20261110') AS t`);
  if (audit?.t) {
    const a = await q(db, sql`
      SELECT a.uid, a.research_cause, v.cause FROM death_backfill_audit_20261110 a
      LEFT JOIN death_verdicts v ON v.death_file_id = split_part(a.uid, '-', 3)::bigint AND v.death_line_index = split_part(a.uid, '-', 4)::int
      WHERE a.tbl = 'lives' AND a.status = 'applied'`);
    const off = a.filter((r) => r.cause !== r.research_cause);
    say(`3. audit keys: ${a.length}, disagreeing ${off.length}`);
    for (const r of off) say(`   ${String(r.uid)}: stored ${String(r.cause ?? "(none)")} research ${String(r.research_cause)}`);
    if (off.length) fail(`check 3: ${off.length} audit keys disagree`);
  } else say("3. audit keys: skipped (table death_backfill_audit_20261110 absent)");

  // 4. The invariant.
  const [c4] = await q(db, sql`
    SELECT (SELECT count(*) FROM death_verdicts WHERE needs_review) AS review,
           (SELECT count(*) FROM death_verdicts WHERE attr_basis IN ('kill_line', 'kill_line_driver')) AS named,
           (SELECT count(*) FROM lives WHERE ended_at IS NOT NULL AND death_cause = 'pvp') AS pvp,
           (SELECT count(*) FROM kills k JOIN lives l ON l.id = k.victim_life_id WHERE k.basis = 'kill_line' AND l.death_cause IS DISTINCT FROM 'pvp') AS stray`);
  say(`4. needs_review ${n(c4!.review)}; kill-line verdicts ${n(c4!.named)}, pvp lives ${n(c4!.pvp)}; kill-line rows on a non-pvp victim life ${n(c4!.stray)}`);
  if (n(c4!.review)) fail(`check 4: ${n(c4!.review)} verdicts need review`);
  // Each life whose verdict and life row disagree, row by row (a pvp life with no verdict is check
  // 1's). One an operator's override decided is listed, not failed.
  const odd = await q(db, sql`
    SELECT v.life_id, v.evidence->>'reviewResolvedBy' AS resolved FROM death_verdicts v JOIN lives l ON l.id = v.life_id
    WHERE coalesce(v.attr_basis IN ('kill_line', 'kill_line_driver'), false) <> coalesce(l.death_cause = 'pvp', false)
    ORDER BY v.life_id`);
  for (const r of odd.filter((x) => x.resolved === "override")) say(`   life ${n(r.life_id)}: basis and coarse word differ; decided by an override`);
  const undecided = odd.filter((x) => x.resolved !== "override").length;
  if (undecided) fail(`check 4: ${undecided} verdicts disagree with their life row on a kill-line killer`);
  if (n(c4!.stray)) fail(`check 4: ${n(c4!.stray)} kill-line rows on a victim life that is not pvp`);

  // 5. The tripwire case (named by the operator on the command line, never in the repository).
  if (o.expectTrap) {
    const [f, l] = o.expectTrap.split(":").map(Number);
    const [v] = await q(db, sql`SELECT cause, confidence, object_key, rule FROM death_verdicts WHERE death_file_id = ${f} AND death_line_index = ${l}`);
    const got = v ? `${String(v.cause)}/${String(v.confidence)}/${String(v.object_key)}/${String(v.rule)}` : "(none)";
    say(`5. the tripwire case: ${got}`);
    if (got !== "explosive_trap/definitive/m67_grenade/A07") fail("check 5: the tripwire case is not explosive_trap/definitive/m67_grenade/A07");
  } else say("5. the tripwire case: skipped (no --expect-trap)");

  // 6. Placement coverage.
  const cov = await q(db, sql`
    SELECT s.id, (SELECT count(*) FROM raw_lines r WHERE r.server_id = s.id AND r.text LIKE '% placed %') AS raw,
           (SELECT count(*) FROM events e WHERE e.server_id = s.id AND e.type = 'build.placed') AS ev
    FROM servers s ORDER BY s.id`);
  for (const c of cov) {
    say(`6. server ${n(c.id)}: placed lines ${n(c.raw)}, build.placed events ${n(c.ev)}`);
    if (n(c.raw) !== n(c.ev)) fail(`check 6: server ${n(c.id)} placed lines and events differ`);
  }

  // 7. Observed spawn levels next to the classifier's table (SPAWN_BASELINES, as it applies now).
  // ⚠️ Only deaths since the table entry that applies now are measured: a median over all time
  // blends two levels. A server whose observed level differs from its table level, either way,
  // needs a new entry: a classifier version bump.
  const table = o.spawnTable ?? SPAWN_BASELINES;
  const nowTs = Math.floor((o.now ?? new Date()).getTime() / 1000);
  for (const sv of await q(db, sql`SELECT id FROM servers ORDER BY id`)) {
    const id = n(sv.id), rows = table[id] ?? [], t = spawnAt(id, nowTs, rows);
    const entry = [...rows].reverse().find((r) => Date.parse(r.from) / 1000 <= nowTs) ?? null;
    const since = entry ? new Date(entry.from).toISOString() : null;
    const [s] = await q(db, sql`
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY (e.payload->>'water')::float8) AS water,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY (e.payload->>'energy')::float8) AS energy, count(*) AS n
      FROM lives l JOIN events e ON e.server_id = l.server_id AND e.type = 'player.died'
        AND e.occurred_at BETWEEN l.ended_at - interval '2 seconds' AND l.ended_at + interval '2 seconds'
        AND e.payload->>'water' IS NOT NULL
      WHERE l.server_id = ${id} AND l.ended_at IS NOT NULL AND l.ended_at - l.started_at < interval '120 seconds'
        AND (${since}::timestamptz IS NULL OR l.ended_at >= ${since}::timestamptz)`);
    const seen = s && n(s.n) > 0 ? { n: n(s.n), water: Number(s.water), energy: Number(s.energy) } : null;
    say(`7. server ${id}: table water ${t.water}, energy ${t.energy}${since ? ` since ${since.slice(0, 10)}` : " (default)"}; ${seen
      ? `deaths within 120 s of spawn ${seen.n}, median water ${seen.water.toFixed(0)}, energy ${seen.energy.toFixed(0)} (level ${spawnLevel(seen.water)} / ${spawnLevel(seen.energy)})`
      : "no death within 120 s of spawn observed"}`);
    if (seen && seen.n >= 3 && (spawnLevel(seen.water) !== t.water || spawnLevel(seen.energy) !== t.energy)) {
      fail(`check 7: server ${id} spawns at ${spawnLevel(seen.water)} / ${spawnLevel(seen.energy)} since ${since ?? "its first death"}, the table says ${t.water} / ${t.energy}: add a SPAWN_BASELINES entry (a classifier version bump)`);
    }
  }

  // 8. Overrides.
  const ovs = await q(db, sql`
    SELECT o.*, f.server_id AS file_server_id, v.life_id FROM death_verdict_overrides o
    LEFT JOIN adm_files f ON f.id = o.death_file_id
    LEFT JOIN death_verdicts v ON v.death_file_id = o.death_file_id AND v.death_line_index = o.death_line_index`);
  for (const r of ovs) {
    const p = overrideProblem(overrideOf(r));
    if (p) fail(`check 8: override ${n(r.death_file_id)}:${n(r.death_line_index)} is invalid (${p})`);
    else if (r.life_id == null) fail(`check 8: override ${n(r.death_file_id)}:${n(r.death_line_index)} matches no stored verdict`);
  }
  say(`8. overrides: ${ovs.length}`);

  // 9. Re-derive every stored row.
  if (o.rederive) {
    const stored = await q(db, sql`SELECT * FROM death_verdicts WHERE classifier_version = ${CLASSIFIER_VERSION} ORDER BY life_id`);
    const cache = newFileCache();
    let differ = 0, policy = 0;
    for (const s of stored) {
      try {
        const d = await deriveLife(db, n(s.life_id), cache);
        const fresh = verdictRow(d, s.settled_by as "file", new Date());
        const keys: [keyof typeof fresh, string][] = [["cause", "cause"], ["confidence", "confidence"], ["rule", "rule"], ["objectText", "object_text"],
          ["upstreamCause", "upstream_cause"], ["attrRole", "attr_role"], ["attrDayzId", "attr_dayz_id"], ["attrBasis", "attr_basis"]];
        const changed = keys.filter(([a, b]) => (fresh[a] ?? null) !== (s[b] ?? null)).map(([, b]) => b);
        if (isoS(fresh.deathAt) !== isoS(s.death_at)) changed.push("death_at");
        const sc = ((s.evidence as { credit?: CreditEvidence | null }).credit) ?? null;
        if (evidenceHalf(d.credit) !== evidenceHalf(sc)) changed.push("credit evidence");
        if (changed.length) { differ++; say(`   life ${n(s.life_id)} differs: ${changed.join(", ")}`); }
        if ((d.credit?.outcome ?? null) !== (sc?.outcome ?? null) || (d.credit?.refusedBy ?? null) !== (sc?.refusedBy ?? null)) {
          policy++; say(`   life ${n(s.life_id)} credit policy now ${d.credit?.outcome ?? "none"}${d.credit?.refusedBy ? ` (test ${d.credit.refusedBy})` : ""}, stored ${sc?.outcome ?? "none"}`);
        }
      } catch (err) {
        differ++; say(`   life ${n(s.life_id)} cannot be re-derived: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    say(`9. re-derived ${stored.length}: ${differ} differ; credit policy (tests 6, 7, overrides) changed for ${policy}`);
    if (differ) fail(`check 9: ${differ} stored verdicts differ from a fresh derivation`);
  }

  // 10. Trap kills.
  if (o.credits) await credits(db, o, say, fail);

  return { ok: failures.length === 0, lines, failures, csv };
}

async function credits(db: Database, o: VerifyOptions, say: (m: string) => void, fail: (m: string) => void): Promise<void> {
  const rows = await q(db, sql`
    SELECT v.life_id, v.rule, v.cause, v.evidence->'credit' AS credit, v.needs_review, v.death_file_id, v.death_line_index,
           l.server_id, l.started_at, l.ended_at, l.playtime_seconds, l.player_id, p.gamertag AS victim, p.dayz_id AS victim_id
    FROM death_verdicts v JOIN lives l ON l.id = v.life_id JOIN players p ON p.id = l.player_id
    WHERE v.evidence->'credit' IS NOT NULL AND jsonb_typeof(v.evidence->'credit') = 'object'
    ORDER BY l.ended_at`);
  const trapRows = await q(db, sql`SELECT * FROM kills WHERE basis = 'trap_placement' ORDER BY occurred_at`);
  say(`10. trap and mine deaths ${rows.length}; trap rows in kills ${trapRows.length}`);
  for (const r of rows) {
    const c = r.credit as CreditEvidence;
    const [pl] = c.placerDayzId ? await q(db, sql`SELECT id, gamertag FROM players WHERE dayz_id = ${c.placerDayzId}`) : [];
    const head = `   life ${n(r.life_id)} (${String(r.rule)}, victim ${String(r.victim)}): ${c.outcome}${c.refusedBy ? ` by test ${c.refusedBy}` : ""}`;
    say(`${head}; placer ${pl ? String(pl.gamertag) : c.placerDayzId ?? "-"}; distance ${c.distanceM ?? "-"} m, age ${c.ageHours ?? "-"} h, boots ${c.boots ?? "-"}; flags ${c.flags.join(" ") || "none"}`);
    if (c.placement) {
      // Site evidence, from the log at run time: who was logged near the placement, on how many days.
      const [pt] = await q(db, sql`SELECT (payload->>'x')::float8 AS x, (payload->>'y')::float8 AS y, occurred_at FROM events
        WHERE adm_file_id = ${c.placement.admFileId} AND line_index = ${c.placement.lineIndex} AND type = 'build.placed'`);
      if (pt && pt.x != null) {
        const names = [String(r.victim), pl ? String(pl.gamertag) : null].filter(Boolean) as string[];
        const site = await q(db, sql`
          SELECT coalesce(payload->>'gamertag', payload->>'victim') AS who, count(DISTINCT occurred_at::date) AS days, count(*) AS lines
          FROM events WHERE server_id = ${n(r.server_id)} AND type IN ('player.position', 'build.placed')
            AND NOT (type = 'build.placed' AND payload->>'className' IN ('TripwireTrap', 'LandMineTrap'))
            AND (payload->>'x')::float8 BETWEEN ${Number(pt.x) - 100} AND ${Number(pt.x) + 100}
            AND (payload->>'y')::float8 BETWEEN ${Number(pt.y) - 100} AND ${Number(pt.y) + 100}
            AND lower(coalesce(payload->>'gamertag', payload->>'victim')) IN (${sql.join(names.map((x) => sql`${x.toLowerCase()}`), sql`, `)})
          GROUP BY 1`);
        for (const s of site) say(`      within 100 m: ${String(s.who)} on ${n(s.days)} days (${n(s.lines)} lines)`);
        // A world wipe leaves no line; a long total silence is the best hint there is.
        const [gap] = await q(db, sql`
          SELECT max(extract(epoch FROM gap)) / 3600 AS h FROM (
            SELECT occurred_at - lag(occurred_at) OVER (ORDER BY occurred_at) AS gap FROM events
            WHERE server_id = ${n(r.server_id)} AND occurred_at BETWEEN ${new Date(pt.occurred_at as string).toISOString()} AND ${new Date(r.ended_at as string).toISOString()}) g`);
        if (Number(gap?.h ?? 0) >= 72) {
          say(`      WARNING: the server was silent for ${Number(gap!.h).toFixed(0)} h after the placement: a wipe would leave no line. Check by hand (a map change is not recorded either).`);
        }
      }
    }
    if (pl && (c.outcome === "credited" || c.outcome === "granted")) {
      const [life] = await q(db, sql`
        SELECT id, started_at, ended_at, playtime_seconds, death_cause FROM lives
        WHERE server_id = ${n(r.server_id)} AND player_id = ${n(pl.id)} AND started_at <= ${new Date(r.ended_at as string).toISOString()}
          AND (ended_at IS NULL OR ended_at >= ${new Date(r.ended_at as string).toISOString()}) ORDER BY started_at DESC LIMIT 1`);
      if (!life) say("      falls in no life of the placer (career total only)");
      else {
        const end = life.ended_at == null ? new Date() : new Date(life.ended_at as string);
        const [other] = await q(db, sql`SELECT count(*) AS k FROM kills WHERE server_id = ${n(r.server_id)} AND killer_player_id = ${n(pl.id)}
          AND victim_life_id IS DISTINCT FROM ${n(r.life_id)} AND occurred_at >= ${new Date(life.started_at as string).toISOString()}
          AND occurred_at <= ${end.toISOString()}`);
        const anyway = life.death_cause === "pvp" || n(life.playtime_seconds) >= 300 || n(other!.k) > 0;
        say(`      falls in the placer's life ${n(life.id)}${life.ended_at ? "" : " (open)"}: ${anyway ? "qualified anyway" : "THIS KILL IS WHAT QUALIFIES IT"}`);
      }
    }
    const row = trapRows.find((k) => n(k.victim_life_id) === n(r.life_id));
    const stands = (c.outcome === "credited" || c.outcome === "granted") && !r.needs_review;
    if (row && (!stands || (pl && n(row.killer_player_id) !== n(pl.id)))) fail(`check 10: trap row for life ${n(r.life_id)} without a matching credited verdict`);
    if (o.trapKillsWrite && stands && !row && !c.flags.includes("kill_line_row_exists")) fail(`check 10: life ${n(r.life_id)} is ${c.outcome} but has no trap row`);
  }
  for (const k of trapRows) {
    if (!rows.some((r) => n(r.life_id) === n(k.victim_life_id))) fail(`check 10: trap row ${n(k.id)} has no verdict with a credit`);
    const [l] = await q(db, sql`SELECT l.id, l.server_id, l.player_id, l.started_at, l.ended_at, l.playtime_seconds, l.death_cause, p.dayz_id, p.gamertag
      FROM lives l JOIN players p ON p.id = l.player_id WHERE l.id = ${n(k.victim_life_id)}`);
    if (l && l.ended_at && !(await lifeCountsOnItsOwn(db, {
      id: n(l.id), serverId: n(l.server_id), playerId: n(l.player_id), startedAt: new Date(l.started_at as string), endedAt: new Date(l.ended_at as string),
      playtimeSeconds: n(l.playtime_seconds), deathCause: (l.death_cause as string | null) ?? null, victimDayzId: String(l.dayz_id ?? ""), victimGamertag: String(l.gamertag),
    }))) say(`   WARNING: trap row ${n(k.id)}: the victim's life no longer counts on its own (listed, not removed)`);
  }
  // Grants not applied yet: what each would newly qualify.
  const pending = await q(db, sql`
    SELECT o.*, v.life_id, l.ended_at, l.server_id AS lserver FROM death_verdict_overrides o
    JOIN death_verdicts v ON v.death_file_id = o.death_file_id AND v.death_line_index = o.death_line_index
    JOIN lives l ON l.id = v.life_id
    WHERE o.credit = 'grant' AND date_trunc('milliseconds', o.updated_at) IS DISTINCT FROM date_trunc('milliseconds', v.override_seen_at)`);
  for (const g of pending) {
    const [pl] = await q(db, sql`SELECT id, gamertag FROM players WHERE dayz_id = ${String(g.credit_dayz_id)}`);
    if (!pl) { say(`   grant on life ${n(g.life_id)}: the granted id has no player row (test 6 will refuse it)`); continue; }
    const at = new Date(g.ended_at as string).toISOString();
    const [life] = await q(db, sql`SELECT id, playtime_seconds, death_cause FROM lives WHERE server_id = ${n(g.lserver)} AND player_id = ${n(pl.id)}
      AND started_at <= ${at} AND (ended_at IS NULL OR ended_at >= ${at}) ORDER BY started_at DESC LIMIT 1`);
    say(`   grant on life ${n(g.life_id)} to ${String(pl.gamertag)}: ${life ? `falls in life ${n(life.id)}${n(life.playtime_seconds) >= 300 || life.death_cause === "pvp" ? " (qualified anyway)" : " (WOULD NEWLY QUALIFY IT, if it has no other kill)"}` : "falls in no life"}`);
  }
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const arg = (name: string): string | null => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] ?? null : null; };
  const has = (name: string): boolean => argv.includes(`--${name}`);
  const log = pino({ level: "info" });
  const url = process.env.DATABASE_URL;
  if (!url) { log.fatal("DATABASE_URL is not set"); process.exit(2); }
  const { db, sql: end } = getDb(url);
  verifyVerdicts(db, {
    golden: arg("golden"), csv: arg("csv"), rederive: has("rederive"), held: has("held"), credits: has("credits"),
    expectTrap: arg("expect-trap"), trapKillsWrite: process.env.TRAP_KILLS_WRITE === "true",
  })
    .then((r) => {
      for (const l of r.lines) console.log(l);
      if (r.csv && arg("csv")) { writeFileSync(arg("csv")!, r.csv); console.log(`golden diff written to ${arg("csv")}`); }
      console.log(r.ok ? "verify-verdicts: OK" : `verify-verdicts: ${r.failures.length} failure(s)`);
      process.exitCode = r.ok ? 0 : 1;
    })
    .catch((err) => { log.fatal({ err }, "verify-verdicts failed"); process.exitCode = 2; })
    .finally(() => end.end());
}
