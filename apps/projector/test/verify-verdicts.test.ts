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
});
