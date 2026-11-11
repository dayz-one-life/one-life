import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sql as dsql } from "drizzle-orm";
import { getTestDb } from "@onelife/test-support";
import { CLASSIFIER_VERSION, type ContextInput, type CreditEvidence } from "@onelife/death-verdict";
import { getLeaderboard, loadDeath, newFileCache } from "@onelife/read-models";
import { readFixtures } from "../../../../packages/death-verdict/scripts/golden-io.js";
import { sweepVerdicts } from "../../src/verdict-sweep.js";
import { failedGoldenChecks, verifyVerdicts } from "../../src/verify-verdicts.js";
import { seedCorpus } from "./seed-corpus.js";

/**
 * The stored-verdict pipeline on the real One Life export — PRIVATE data, run only where
 * `$DEATH_GOLDEN_DIR` is (and a test database). The export is seeded into the database as
 * production holds it (raw lines, events, players, lives, kills); the sweep then loads every death
 * from raw_lines and stores its verdict, exactly as it will on the host. This is the local run of
 * what `verify-verdicts --golden` checks in production (spec 5.5, check 2): the loader on real data.
 *
 * - the loader selects for every death the lines the fixture builder selected from the whole log,
 *   except what lies after the death (see that test);
 * - every One Life death has a verdict at the current version, none is held, none needs review;
 * - every death matches the reference on the ten parity checks, whichever rule decided it (plan
 *   step 6: every rule is ported and `known-gaps.json` is empty);
 * - the trap-kill policy half (tests 6 and 7, the placer's life) gives the reviewed table:
 *   `credits.expected.json` → `policy`;
 * - most-kills and longest-killstreak with and without the trap rows give that table's boards.
 *
 * ⚠️ PRIVATE. Failure messages give counts and field names only. `DEATH_GOLDEN_DEBUG=1` on your own
 * machine prints which deaths differ; never paste that anywhere public.
 */
const GOLD = process.env.DEATH_GOLDEN_DIR;
const ready = GOLD != null && existsSync(join(GOLD, "corpus", "ol_raw_lines.tsv")) && existsSync(join(GOLD, "credits.expected.json"));
if (!ready) console.warn("[sweep-golden] SKIPPED — DEATH_GOLDEN_DIR is unset. This suite runs only where the private golden data is.");

const { db, sql } = getTestDb();
const NOW = new Date("2027-01-01T00:00:00Z");
const log = { info: () => {}, warn: () => {}, error: () => {} };
const TABLES = dsql`TRUNCATE death_verdict_overrides, kills, lives, players, events, raw_lines, adm_files, servers, bans, articles RESTART IDENTITY CASCADE`;

interface GoldenRow { uid: string; project: string; rule: string; [k: string]: unknown }
type Policy = {
  lives: Record<string, { outcome: string; refusedBy: number | null; placerLife: number | null }>;
  boards: Record<string, Record<string, [number, number, number]>>;
};
const debug = (what: string, xs: string[]) => { if (process.env.DEATH_GOLDEN_DEBUG) for (const x of xs.slice(0, 40)) console.error(`[debug] ${what}: ${x}`); };

describe.skipIf(!ready)("the verdict sweep on the One Life export (private data)", () => {
  let dead = 0;
  let trapRowsAfterR2 = -1;
  beforeAll(async () => {
    await db.execute(TABLES);
    dead = (await seedCorpus(db, GOLD!)).deadLives;
    // The release order: R2 sweeps every death with the switch off, then R3 turns it on. The trap
    // rows must appear for deaths that already have a verdict.
    for (const on of [false, true]) {
      for (let i = 0; i < 20; i++) {
        const r = await sweepVerdicts(db, { now: NOW, log, trapKillsWrite: on, limit: 2000, budgetMs: 3_600_000 });
        if (r.written === 0 && r.failed === 0) break;
      }
      if (!on) {
        const [t] = (await db.execute(dsql`SELECT count(*) AS n FROM kills WHERE basis = 'trap_placement'`)) as unknown as { n: string }[];
        trapRowsAfterR2 = Number(t!.n);
      }
    }
  }, 1_200_000);
  afterAll(async () => {
    await db.execute(TABLES);
    await sql.end();
  });

  it("every death has a verdict at the current version; none held, none flagged for review", async () => {
    const [c] = (await db.execute(dsql`
      SELECT (SELECT count(*) FROM death_verdicts WHERE classifier_version = ${CLASSIFIER_VERSION}) AS v,
             (SELECT count(*) FROM death_verdict_queue) AS q,
             (SELECT count(*) FROM death_verdicts WHERE needs_review) AS r`)) as unknown as { v: string; q: string; r: string }[];
    const errs = (await db.execute(dsql`SELECT last_error FROM death_verdict_queue`)) as unknown as { last_error: string | null }[];
    debug("queue", errs.map((e) => String(e.last_error)));
    expect({ verdicts: Number(c!.v), queued: Number(c!.q), review: Number(c!.r) }).toEqual({ verdicts: dead, queued: 0, review: 0 });
  });

  it("the loader selects what the fixture builder selected, up to the death", async () => {
    // ⚠️ Two deliberate differences, both after the death, so no rule can read them: the fixtures
    // were cut from the WHOLE log, so they also hold placements written weeks after the death (the
    // loader stops at the server window after it: a verdict must not change with the future), and
    // the untimed banner and header lines of a file take the time of whatever file was loaded
    // before them.
    const TIMED = /^\d\d:\d\d:\d\d \| /;
    const cache = newFileCache();
    const bad: string[] = [];
    let same = 0;
    for (const f of readFixtures(join(GOLD!, "ol"))) {
      const [l] = (await db.execute(dsql`
        SELECT v.life_id FROM death_verdicts v WHERE v.death_file_id = ${f.deathRef.admFileId} AND v.death_line_index = ${f.deathRef.lineIndex}`)) as unknown as { life_id: string }[];
      if (!l) { bad.push(`${f.uid} no verdict`); continue; }
      const d = await loadDeath(db, Number(l.life_id), cache);
      const t0 = d.deathTs;
      const lines = (x: ContextInput) => new Set(x.files.flatMap((ff) => ff.lines.filter(([, ts, text]) => TIMED.test(text) && ts <= t0 + 330)
        .map(([i, ts]) => `${ff.admFileId}:${i}:${ts}:${ff.boot ?? "-"}`)));
      const before = (x: ContextInput) => {
        const ts = new Map(x.files.flatMap((ff) => ff.lines.map(([i, t]) => [`${ff.admFileId}:${i}`, t] as const)));
        return JSON.stringify(x.placements.filter((p) => (ts.get(`${p.admFileId}:${p.lineIndex}`) ?? Infinity) <= t0));
      };
      const a = lines(f), b = lines(d.input);
      const diff = [...a].filter((k) => !b.has(k)).length + [...b].filter((k) => !a.has(k)).length;
      const ok = diff === 0 && before(f) === before(d.input) && JSON.stringify(f.prevDeaths) === JSON.stringify(d.input.prevDeaths)
        && JSON.stringify(f.cluster) === JSON.stringify(d.input.cluster);
      if (ok) same++;
      else bad.push(`${f.uid} lines ${diff} placements ${before(f) === before(d.input)} prev ${JSON.stringify(f.prevDeaths) === JSON.stringify(d.input.prevDeaths)}`);
    }
    debug("loader", bad);
    expect({ same, differ: bad.length }).toEqual({ same: 280, differ: 0 });
  }, 600_000);

  it("every death matches the reference on the ten checks, and there is no known gap", async () => {
    const rows = readFileSync(join(GOLD!, "classified.jsonl"), "utf8").split("\n").filter(Boolean)
      .map((l) => JSON.parse(l) as GoldenRow).filter((r) => r.project === "OL");
    const gaps = JSON.parse(readFileSync(join(GOLD!, "known-gaps.json"), "utf8")) as Record<string, unknown>;
    const stored = (await db.execute(dsql`SELECT * FROM death_verdicts`)) as unknown as Record<string, unknown>[];
    const byLine = new Map(stored.map((v) => [`${Number(v.death_file_id)}:${Number(v.death_line_index)}`, v]));
    const bad: string[] = [];
    let passed = 0;
    for (const e of rows) {
      const [, , f, l] = e.uid.split("-");
      const v = byLine.get(`${f}:${l}`);
      if (!v) { bad.push(`${e.uid} no verdict`); continue; }
      const checks = failedGoldenChecks(v, e as never);
      if (checks.length) {
        const ev = v.evidence as { flags: string[]; contributors: { dayzId: string; role: string; confidence: string }[] };
        const flags = (xs: string[]) => [...xs].sort().join(",");
        const ppl = (xs: { id: string; role: string; confidence: string }[]) => xs.map((c) => `${c.role}|${c.confidence}`).sort().join(",");
        const detail = process.env.DEATH_GOLDEN_DEBUG && checks.includes(10)
          ? ` flags got [${flags(ev.flags)}] want [${flags(e.flags as string[])}] people got [${ppl(ev.contributors.map((c) => ({ id: c.dayzId, role: c.role, confidence: c.confidence })))}] want [${ppl(e.contributors as never)}]`
          : "";
        bad.push(`${e.uid} checks ${checks.join(" ")}${detail}`);
      }
      else passed++;
    }
    debug("golden", bad);
    expect({ rows: rows.length, stored: stored.length, differ: bad.length }).toEqual({ rows: 280, stored: 280, differ: 0 });
    expect(Object.keys(gaps)).toEqual([]);
    expect(passed).toBe(280);
  });

  it("verify-verdicts passes on the swept export, re-derivation and credits included", async () => {
    const r = await verifyVerdicts(db, { golden: null, rederive: true, credits: true, trapKillsWrite: true });
    debug("verify", r.lines);
    expect(r.failures).toEqual([]);
  }, 600_000);

  it("the trap-kill policy half gives the reviewed table", async () => {
    const { policy } = JSON.parse(readFileSync(join(GOLD!, "credits.expected.json"), "utf8")) as { policy: Policy };
    const got = (await db.execute(dsql`
      SELECT v.life_id, v.evidence->'credit' AS credit, k.killer_player_id, k.occurred_at, k.server_id
      FROM death_verdicts v LEFT JOIN kills k ON k.victim_life_id = v.life_id AND k.basis = 'trap_placement'
      WHERE jsonb_typeof(v.evidence->'credit') = 'object'`)) as unknown as
      { life_id: string; credit: CreditEvidence; killer_player_id: string | null; occurred_at: string | null; server_id: number | null }[];
    const out: Record<string, { outcome: string; refusedBy: number | null; placerLife: number | null }> = {};
    for (const g of got) {
      let placerLife: number | null = null;
      if (g.killer_player_id != null) {
        const at = new Date(g.occurred_at!).toISOString();
        const [l] = (await db.execute(dsql`SELECT id FROM lives WHERE server_id = ${g.server_id} AND player_id = ${Number(g.killer_player_id)}
          AND started_at <= ${at} AND (ended_at IS NULL OR ended_at >= ${at}) ORDER BY started_at DESC LIMIT 1`)) as unknown as { id: string }[];
        placerLife = l ? Number(l.id) : null;
      }
      out[String(Number(g.life_id))] = { outcome: g.credit.outcome, refusedBy: g.credit.refusedBy, placerLife };
    }
    debug("policy", Object.entries(out).map(([k, v]) => `${k} ${JSON.stringify(v)}`));
    expect(out).toEqual(policy.lives);
  });

  it("most-kills and longest-killstreak with and without the trap rows give the reviewed boards", async () => {
    const { policy } = JSON.parse(readFileSync(join(GOLD!, "credits.expected.json"), "utf8")) as { policy: Policy };
    const traps = (await db.execute(dsql`SELECT * FROM kills WHERE basis = 'trap_placement'`)) as unknown as Record<string, unknown>[];
    const placers = new Map<number, string>();
    for (const t of traps) placers.set(Number(t.server_id), String(t.killer_gamertag));
    const value = (rows: { gamertag: string; value: number }[], who: string) => rows.find((r) => r.gamertag === who)?.value ?? 0;
    const best = (rows: { gamertag: string; value: number }[], who: string) => Math.max(0, ...rows.filter((r) => r.gamertag !== who).map((r) => r.value));
    const after: Record<string, Record<string, number[]>> = {};
    for (const [sid, who] of placers) {
      after[sid] = {};
      for (const b of ["most-kills", "longest-killstreak"] as const) {
        const rows = await getLeaderboard(db, sid, b, NOW, 100);
        after[sid]![b] = [value(rows, who), best(rows, who)];
      }
    }
    await db.execute(dsql`DELETE FROM kills WHERE basis = 'trap_placement'`);
    const out: Record<string, Record<string, number[]>> = {};
    try {
      for (const [sid, who] of placers) {
        out[sid] = {};
        for (const b of ["most-kills", "longest-killstreak"] as const) {
          const before = value(await getLeaderboard(db, sid, b, NOW, 100), who);
          out[sid]![b] = [before, after[sid]![b]![0]!, after[sid]![b]![1]!];
        }
      }
    } finally {
      for (const t of traps) {
        await db.execute(dsql`INSERT INTO kills (server_id, killer_gamertag, killer_player_id, victim_gamertag, victim_player_id, victim_life_id, weapon, occurred_at, basis, credit_source)
          VALUES (${Number(t.server_id)}, ${String(t.killer_gamertag)}, ${Number(t.killer_player_id)}, ${String(t.victim_gamertag)}, ${Number(t.victim_player_id)},
                  ${Number(t.victim_life_id)}, ${String(t.weapon)}, ${new Date(t.occurred_at as string).toISOString()}, 'trap_placement', ${String(t.credit_source)})`);
      }
    }
    const { _shape, ...want } = policy.boards as Record<string, unknown>;
    void _shape;
    if (process.env.DEATH_GOLDEN_DEBUG) console.error(`[debug] boards ${JSON.stringify(out)}`);
    expect(out).toEqual(want);
  });

  it("no trap row exists after R2; the switch turned off removes every one, and on brings them back", async () => {
    expect(trapRowsAfterR2).toBe(0);
    const count = async () => Number(((await db.execute(dsql`SELECT count(*) AS n FROM kills WHERE basis = 'trap_placement'`)) as unknown as { n: string }[])[0]!.n);
    const before = await count();
    expect(before).toBeGreaterThan(0);
    await sweepVerdicts(db, { now: NOW, log, trapKillsWrite: false, limit: 2000, budgetMs: 3_600_000 });
    expect(await count()).toBe(0);
    await sweepVerdicts(db, { now: NOW, log, trapKillsWrite: true, limit: 2000, budgetMs: 3_600_000 });
    expect(await count()).toBe(before);
  }, 600_000);
});
