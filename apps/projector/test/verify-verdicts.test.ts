import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql as dsql } from "drizzle-orm";
import { servers, players, lives } from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { seedAdmLog, line, fakeId, type Who } from "@onelife/test-support/adm-log";
import { sweepVerdicts } from "../src/verdict-sweep.js";
import { verifyVerdicts } from "../src/verify-verdicts.js";

/** verify-verdicts against Postgres. ⚠️ Invented players and lines only. */
const { db, sql } = getTestDb();
const V: Who = { name: "Victim One", id: fakeId("1") };
const O: Who = { name: "Other Two", id: fakeId("2") };
const NOW = new Date("2031-06-11T00:00:00Z");
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
let sid: number;
let deathRef: { f: number; l: number };

beforeEach(async () => {
  await db.execute(dsql`TRUNCATE lives, players, kills, events, raw_lines, adm_files, servers, death_verdict_overrides RESTART IDENTITY CASCADE`);
  const [s] = await db.insert(servers).values({ nitradoServiceId: Math.floor(Math.random() * 1e8) + 6e8, name: "VV" }).returning();
  sid = s!.id;
  const log2 = await seedAdmLog(db, sid, [
    { date: "2031-06-08", start: "08:00:00", lines: [["08:10:00", line.wire(O, 1001.5)]] },
    { date: "2031-06-10", start: "12:00:00", complete: true, lines: [
      ["12:01:00", line.connected(V)], ["12:20:00", line.trip(V)], ["12:20:04", line.fragBlast(V)], ["12:20:04", line.fragKill(V)],
    ] },
  ]);
  const f = log2.fileIds[1]!;
  const [v] = await db.insert(players).values({ gamertag: V.name, dayzId: V.id }).returning();
  await db.insert(players).values({ gamertag: O.name, dayzId: O.id });
  await db.insert(lives).values({ serverId: sid, playerId: v!.id, lifeNumber: 1, startedAt: log2.at(f, log2.idx(0)), endedAt: log2.at(f, log2.idx(3)), deathCause: "explosion", playtimeSeconds: 600 });
  deathRef = { f, l: log2.idx(3) };
});
afterAll(async () => { await sql.end(); });

describe("verifyVerdicts", () => {
  it("passes on a fully swept database, re-derivation and credits included", async () => {
    await sweepVerdicts(db, { now: NOW, log, trapKillsWrite: true });
    const r = await verifyVerdicts(db, { rederive: true, credits: true, trapKillsWrite: true, expectTrap: `${deathRef.f}:${deathRef.l}` });
    expect(r.failures).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.lines.join("\n")).toContain("credited");
    // check 7 prints the classifier's spawn table beside what production observed
    expect(r.lines.some((l) => /^7\. server \d+: table water \d+, energy \d+( since [\d-]+| \(default\)); /.test(l))).toBe(true);
  });

  it("fails while a life has no verdict, and on a needs_review row", async () => {
    expect((await verifyVerdicts(db)).failures.some((f) => f.startsWith("check 1"))).toBe(true);
    await sweepVerdicts(db, { now: NOW, log });
    await db.execute(dsql`UPDATE death_verdicts SET needs_review = true`);
    expect((await verifyVerdicts(db)).failures.some((f) => f.startsWith("check 4"))).toBe(true);
  });

  it("lists an invalid or unmatched override", async () => {
    await sweepVerdicts(db, { now: NOW, log });
    await db.execute(dsql`INSERT INTO death_verdict_overrides (server_id, death_file_id, death_line_index, cause, note, created_by)
      VALUES (${sid}, ${deathRef.f}, ${deathRef.l}, 'teleported', 'n', 't'), (${sid}, 999, 1, 'fall', 'n', 't')`);
    const r = await verifyVerdicts(db);
    expect(r.failures.filter((f) => f.startsWith("check 8"))).toHaveLength(2);
  });

  it("re-derivation passes with a deny on a credited death", async () => {
    await db.execute(dsql`INSERT INTO death_verdict_overrides (server_id, death_file_id, death_line_index, credit, note, created_by)
      VALUES (${sid}, ${deathRef.f}, ${deathRef.l}, 'deny', 'n', 't')`);
    await sweepVerdicts(db, { now: NOW, log, trapKillsWrite: true });
    const r = await verifyVerdicts(db, { rederive: true, credits: true, trapKillsWrite: true });
    expect(r.lines.join("\n")).toContain("denied");
    expect(r.failures).toEqual([]);
  });

  it("re-derivation passes with a grant, and with a deny, on a death the evidence refused", async () => {
    // a second wire near the first: test 2 refuses, which is what a grant is for
    const T: Who = { name: "Third Three", id: fakeId("3") };
    const more = await seedAdmLog(db, sid, [{ date: "2031-06-08", start: "09:00:00", lines: [["09:15:00", line.wire(T, 1002.5)]] }]);
    expect(more.fileIds).toHaveLength(1);
    await db.insert(players).values({ gamertag: T.name, dayzId: T.id });
    await sweepVerdicts(db, { now: NOW, log, trapKillsWrite: true });
    const [c] = (await db.execute(dsql`SELECT evidence->'credit' AS c FROM death_verdicts`)) as unknown as { c: { outcome: string; refusedBy: number } }[];
    expect(c!.c).toMatchObject({ outcome: "refused", refusedBy: 2 });
    for (const [credit, id] of [["grant", T.id], ["deny", null]] as const) {
      await db.execute(dsql`DELETE FROM death_verdict_overrides`);
      await db.execute(dsql`INSERT INTO death_verdict_overrides (server_id, death_file_id, death_line_index, credit, credit_dayz_id, note, created_by)
        VALUES (${sid}, ${deathRef.f}, ${deathRef.l}, ${credit}, ${id}, 'n', 't')`);
      await sweepVerdicts(db, { now: NOW, log, trapKillsWrite: true });
      const r = await verifyVerdicts(db, { rederive: true, credits: true, trapKillsWrite: true });
      expect(r.lines.join("\n")).toContain(credit === "grant" ? "granted" : "denied");
      expect(r.failures).toEqual([]);
    }
  });

  it("an override whose server_id is not the death file's server fails check 8", async () => {
    await sweepVerdicts(db, { now: NOW, log });
    await db.execute(dsql`INSERT INTO death_verdict_overrides (server_id, death_file_id, death_line_index, credit, note, created_by)
      VALUES (999999, ${deathRef.f}, ${deathRef.l}, 'deny', 'n', 't')`);
    const r = await verifyVerdicts(db);
    expect(r.failures.filter((f) => f.startsWith("check 8"))).toEqual([expect.stringContaining("server")]);
  });

  it("a trap row with no credited verdict fails check 10", async () => {
    await sweepVerdicts(db, { now: NOW, log, trapKillsWrite: true });
    await db.execute(dsql`UPDATE death_verdicts SET evidence = jsonb_set(evidence, '{credit,outcome}', '"denied"')`);
    const r = await verifyVerdicts(db, { credits: true, trapKillsWrite: true });
    expect(r.failures.some((f) => f.startsWith("check 10"))).toBe(true);
  });

  it("diffs against a golden file by the death line", async () => {
    await sweepVerdicts(db, { now: NOW, log });
    const [v] = (await db.execute(dsql`SELECT * FROM death_verdicts`)) as unknown as Record<string, unknown>[];
    const ev = v!.evidence as { deathLines: { admFileId: number; lineIndex: number; role: string }[]; flags: string[] };
    const row = {
      uid: `OL-${sid}-${deathRef.f}-${deathRef.l}`, project: "OL", cause: v!.cause, confidence: v!.confidence, rule: v!.rule,
      mechanism_stated: v!.mechanism_stated, upstream_cause: v!.upstream_cause, upstream_confidence: v!.upstream_confidence,
      co_causes: v!.co_causes, weapon_or_object: v!.object_text, attributed_to: v!.attr_role ? { role: v!.attr_role, id: v!.attr_dayz_id, confidence: v!.attr_confidence } : null,
      contributors: [], flags: ev.flags, death_lines: ev.deathLines.map((l) => ({ ref: `${l.admFileId}:${l.lineIndex}`, role: l.role })),
      utc: new Date(v!.death_at as string).toISOString().replace(/\.\d{3}Z$/, "Z"),
    };
    const dir = mkdtempSync(join(tmpdir(), "vv-"));
    try {
      const same = join(dir, "same.jsonl"), other = join(dir, "other.jsonl");
      writeFileSync(same, JSON.stringify(row) + "\n");
      writeFileSync(other, JSON.stringify({ ...row, cause: "landmine", flags: [...row.flags, "extra"] }) + "\n");
      expect((await verifyVerdicts(db, { golden: same })).failures.filter((f) => f.startsWith("check 2"))).toEqual([]);
      const r = await verifyVerdicts(db, { golden: other });
      expect(r.failures.some((f) => f.startsWith("check 2"))).toBe(true);
      expect(r.csv).toContain(`${row.uid},1 10`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("check 7 measures only the deaths since the server's current spawn levels, and flags a difference either way", async () => {
    // Five deaths within 120 s of spawn at the old levels (Water and Energy 595), three at the
    // new ones (740 / 990). Over all time the median is the old level; since the change it is 750/1000.
    const deaths = async (date: string, n: number, water: number, energy: number, from: number) => {
      const entries: [string, string][] = [];
      for (let i = 0; i < n; i++) {
        entries.push([`1${i}:00:00`, line.connected(O, 3000)], [`1${i}:01:00`, line.died(O, 3000, 2000, water, energy)]);
      }
      const l = await seedAdmLog(db, sid, [{ date, start: "09:00:00", complete: true, lines: entries }]);
      const f = l.fileIds[0]!;
      const [o] = (await db.execute(dsql`SELECT id FROM players WHERE dayz_id = ${O.id}`)) as unknown as { id: string }[];
      for (let i = 0; i < n; i++) {
        await db.insert(lives).values({ serverId: sid, playerId: Number(o!.id), lifeNumber: from + i, startedAt: l.at(f, l.idx(2 * i)), endedAt: l.at(f, l.idx(2 * i + 1)), deathCause: "died", playtimeSeconds: 60 });
      }
    };
    await deaths("2031-05-20", 5, 595, 595, 1);
    await deaths("2031-06-05", 3, 740, 990, 10);
    const run = (rows: { from: string; water: number; energy: number }[]) =>
      verifyVerdicts(db, { now: new Date("2031-06-20T00:00:00Z"), spawnTable: { [sid]: rows } });
    const right = await run([{ from: "2031-05-01T00:00:00Z", water: 600, energy: 600 }, { from: "2031-06-01T00:00:00Z", water: 750, energy: 1000 }]);
    expect(right.lines.find((l) => l.startsWith(`7. server ${sid}:`))).toContain("since 2031-06-01");
    expect(right.lines.find((l) => l.startsWith(`7. server ${sid}:`))).toContain("deaths within 120 s of spawn 3");
    expect(right.failures.filter((f) => f.startsWith("check 7"))).toEqual([]);
    // the table says higher than observed: flagged too
    const high = await run([{ from: "2031-06-01T00:00:00Z", water: 1000, energy: 1000 }]);
    expect(high.failures.filter((f) => f.startsWith("check 7"))).toEqual([expect.stringContaining(`server ${sid}`)]);
    // the table says lower than observed: an entry since the change that kept the old levels
    const low = await run([{ from: "2031-06-01T00:00:00Z", water: 600, energy: 600 }]);
    expect(low.lines.find((l) => l.startsWith(`7. server ${sid}:`))).toContain("level 750 / 1000");
    expect(low.failures.filter((f) => f.startsWith("check 7"))).toEqual([expect.stringContaining(`server ${sid}`)]);
  });

  it("--held lists needs_review rows, the death event of a held life, and lives still waiting", async () => {
    await sweepVerdicts(db, { now: NOW, log });
    await db.execute(dsql`UPDATE death_verdicts SET needs_review = true`);
    const r = await verifyVerdicts(db, { held: true, now: new Date(NOW.getTime() + 3600_000) });
    const text = r.lines.join("\n");
    expect(text).toMatch(/needs_review: life \d+ explosive_trap/);
    expect(text).toMatch(/waiting over 45 min for a reviewable verdict: 1/);
    await db.execute(dsql`DELETE FROM death_verdicts`);
    await db.execute(dsql`INSERT INTO death_verdict_queue (life_id, attempts, last_error) SELECT id, 3, 'boom' FROM lives`);
    const h = (await verifyVerdicts(db, { held: true })).lines.join("\n");
    expect(h).toContain(`override key (death event) ${deathRef.f}:${deathRef.l}`);
  });
});
