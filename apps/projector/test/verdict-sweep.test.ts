import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { sql as dsql, eq } from "drizzle-orm";
import { servers, players, lives, kills, deathVerdicts, events } from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { seedAdmLog, line, fakeId, type Who, type SeedFile } from "@onelife/test-support/adm-log";
import { CLASSIFIER_VERSION, type CreditEvidence } from "@onelife/death-verdict";
import { sweepVerdicts, SETTLE_WALL_MINUTES } from "../src/verdict-sweep.js";

/**
 * The verdict sweep against Postgres. ⚠️ Every name, id and line is invented: hand-written ADM
 * files go into raw_lines and events as ingest writes them, and lives are inserted by hand so a
 * test controls playtime and the coarse word.
 */
const { db, sql } = getTestDb();
const V: Who = { name: "Victim One", id: fakeId("1") };
const O: Who = { name: "Other Two", id: fakeId("2") };
const T: Who = { name: "Third Three", id: fakeId("3") };
const K: Who = { name: "Killer Four", id: fakeId("4") };
const NOW = new Date("2031-06-11T00:00:00Z");
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

let sid: number;
const pids = new Map<string, number>();

beforeEach(async () => {
  await db.execute(dsql`TRUNCATE lives, players, kills, events, raw_lines, adm_files, servers, death_verdict_overrides RESTART IDENTITY CASCADE`);
  const [s] = await db.insert(servers).values({ nitradoServiceId: Math.floor(Math.random() * 1e8) + 6e8, name: "VS", map: "chernarusplus" }).returning();
  sid = s!.id;
  pids.clear();
  log.info.mockClear(); log.warn.mockClear(); log.error.mockClear();
});
afterAll(async () => { await sql.end(); });

async function player(p: Who, dayzId: string | null = p.id): Promise<number> {
  const [r] = await db.insert(players).values({ gamertag: p.name, dayzId }).returning();
  pids.set(p.id, Number(r!.id));
  return Number(r!.id);
}
async function life(playerId: number, startedAt: Date, endedAt: Date, deathCause: string | null, playtimeSeconds = 600, n = 1): Promise<number> {
  const [r] = await db.insert(lives).values({ serverId: sid, playerId, lifeNumber: n, startedAt, endedAt, deathCause, playtimeSeconds }).returning();
  return Number(r!.id);
}
const sweep = (o: Partial<Parameters<typeof sweepVerdicts>[1]> = {}) => sweepVerdicts(db, { now: NOW, log, ...o });
async function verdict(lifeId: number) {
  return (await db.select().from(deathVerdicts).where(eq(deathVerdicts.lifeId, lifeId)))[0];
}
const creditOf = async (lifeId: number) => ((await verdict(lifeId))!.evidence as { credit: CreditEvidence | null }).credit;
async function trapRows() {
  return db.select().from(kills).where(eq(kills.basis, "trap_placement"));
}
async function queueRow(lifeId: number) {
  const r = (await db.execute(dsql`SELECT * FROM death_verdict_queue WHERE life_id = ${lifeId}`)) as unknown as Record<string, unknown>[];
  return r[0];
}
async function override(fileId: number, lineIndex: number, o: Record<string, string | null>) {
  await db.execute(dsql`
    INSERT INTO death_verdict_overrides (server_id, death_file_id, death_line_index, cause, confidence, credit, credit_dayz_id, note, created_by)
    VALUES (${sid}, ${fileId}, ${lineIndex}, ${o.cause ?? null}, ${o.confidence ?? null}, ${o.credit ?? null}, ${o.credit_dayz_id ?? null}, 'test', 'test')`);
}

/** A plain stated death (a died line with stats, no rule beyond B00) in one file. */
async function plainDeath(opts: { after?: [string, string][]; complete?: boolean; extraFile?: boolean } = {}) {
  const files: SeedFile[] = [{
    date: "2031-06-10", start: "12:00:00", complete: opts.complete,
    lines: [["12:01:00", line.connected(V)], ["12:20:00", line.suicide(V)], ["12:20:00", line.died(V)], ...(opts.after ?? [])],
  }];
  if (opts.extraFile) files.push({ date: "2031-06-10", start: "16:00:00", lines: [["16:01:00", line.connected(T, 5000)]] });
  const log2 = await seedAdmLog(db, sid, files);
  const f = log2.fileIds[0]!;
  const pid = await player(V);
  const lid = await life(pid, log2.at(f, log2.idx(0)), log2.at(f, log2.idx(1)), "suicide");
  return { log: log2, f, lid, deathLine: log2.idx(2) };
}

/**
 * A tripwire death: Other Two placed a wire 1.5 m from where Victim One trips it two days later;
 * a frag goes off four seconds after the trip. The file goes on six minutes past the death.
 */
async function trapDeath(opts: { secondPlacer?: boolean; placerRow?: boolean; playtime?: number; deathCause?: string } = {}) {
  const placements: [string, string][] = [["08:10:00", line.wire(O, 1001.5)]];
  if (opts.secondPlacer) placements.push(["08:15:00", line.wire(T, 1002.5)]);
  const log2 = await seedAdmLog(db, sid, [
    { date: "2031-06-08", start: "08:00:00", lines: placements },
    { date: "2031-06-10", start: "12:00:00", lines: [
      ["12:01:00", line.connected(V)], ["12:20:00", line.trip(V)], ["12:20:04", line.fragBlast(V)], ["12:20:04", line.fragKill(V)],
      ["12:26:05", line.pos(K, 6000)],
    ] },
  ]);
  const f = log2.fileIds[1]!;
  const vid = await player(V);
  if (opts.placerRow !== false) await player(O);
  if (opts.secondPlacer) await player(T);
  await player(K);
  const lid = await life(vid, log2.at(f, log2.idx(0)), log2.at(f, log2.idx(3)), opts.deathCause ?? "explosion", opts.playtime ?? 600);
  return { log: log2, f, lid, deathLine: log2.idx(3), endedAt: log2.at(f, log2.idx(3)) };
}

/** A kill-line death: Killer Four shoots Victim One. */
async function pvpDeath(deathCause: string | null = "pvp") {
  const log2 = await seedAdmLog(db, sid, [{ date: "2031-06-10", start: "12:00:00", complete: true, lines: [
    ["12:01:00", line.connected(V)], ["12:20:00", line.shotBy(V, K, 0)], ["12:20:00", line.killedBy(V, K)],
  ] }]);
  const f = log2.fileIds[0]!;
  const vid = await player(V);
  await player(K);
  const lid = await life(vid, log2.at(f, log2.idx(0)), log2.at(f, log2.idx(2)), deathCause);
  return { f, lid };
}

describe("settling", () => {
  it("settles by file progress", async () => {
    const d = await plainDeath({ after: [["12:25:01", line.connected(T, 5000)]] });
    expect(await sweep()).toMatchObject({ written: 1, failed: 0 });
    expect(await verdict(d.lid)).toMatchObject({ settledBy: "file", classifierVersion: CLASSIFIER_VERSION, cause: "suicide", rule: "B01" });
    expect(await queueRow(d.lid)).toBeUndefined();
  });

  it("does not settle on a line less than 300 s after the death in a file still being written", async () => {
    const d = await plainDeath({ after: [["12:24:59", line.connected(T, 5000)]] });
    expect(await sweep()).toMatchObject({ written: 0 });
    expect(await verdict(d.lid)).toBeUndefined();
    expect(await queueRow(d.lid)).toBeDefined();
  });

  it("settles by rotation", async () => {
    const later = await plainDeath({ extraFile: true });
    expect(await sweep()).toMatchObject({ written: 1 });
    expect((await verdict(later.lid))!.settledBy).toBe("rotation");
  });

  it("settles by rotation when the file is marked complete", async () => {
    const d = await plainDeath({ complete: true });
    await sweep();
    expect((await verdict(d.lid))!.settledBy).toBe("rotation");
  });

  it("settles by wall clock from first_seen_at, not ended_at", async () => {
    // ended_at is long before NOW; that must not count
    const d = await plainDeath();
    expect(await sweep({ now: NOW })).toMatchObject({ written: 0 });
    const first = new Date((await queueRow(d.lid))!.first_seen_at as string);
    expect(first.toISOString()).toBe(NOW.toISOString());
    expect(await sweep({ now: new Date(NOW.getTime() + (SETTLE_WALL_MINUTES * 60 - 1) * 1000) })).toMatchObject({ written: 0 });
    expect(await sweep({ now: new Date(NOW.getTime() + SETTLE_WALL_MINUTES * 60_000) })).toMatchObject({ written: 1 });
    expect((await verdict(d.lid))!.settledBy).toBe("wall");
  });

  it("a future-dated event on the server does not settle a death", async () => {
    const d = await plainDeath();
    // a stored time far ahead (the skew raw_lines.occurred_at is known for) settles nothing
    await db.insert(events).values({
      serverId: sid, admFileId: d.f, lineIndex: 999, subIndex: 0, type: "player.position",
      occurredAt: new Date("2099-01-01T00:00:00Z"), payload: { gamertag: "Third Three", x: 1, y: 1 },
    });
    await db.execute(dsql`UPDATE raw_lines SET occurred_at = '2099-01-01T00:00:00Z' WHERE adm_file_id = ${d.f}`);
    expect(await sweep()).toMatchObject({ written: 0 });
  });
});

describe("a pass", () => {
  it("stops at the time budget", async () => {
    const log2 = await seedAdmLog(db, sid, [{ date: "2031-06-10", start: "12:00:00", complete: true, lines: [
      ["12:01:00", line.connected(V)], ["12:20:00", line.died(V)],
      ["12:01:00", line.connected(O, 3000)], ["12:30:00", line.died(O, 3000)],
      ["12:01:00", line.connected(T, 5000)], ["12:40:00", line.died(T, 5000)],
    ] }]);
    const f = log2.fileIds[0]!;
    for (const [i, p] of [V, O, T].entries()) await life(await player(p), log2.at(f, log2.idx(2 * i)), log2.at(f, log2.idx(2 * i + 1)), "died");
    let t = 0;
    // every look at the clock costs six seconds: one life fits in the ten-second budget
    expect(await sweep({ clock: () => (t += 6000) })).toMatchObject({ written: 1 });
    expect(await sweep()).toMatchObject({ written: 2 });
  });

  it("stops at the life limit", async () => {
    await plainDeath({ complete: true });
    expect(await sweep({ limit: 0 })).toMatchObject({ written: 0 });
  });

  it("is idempotent", async () => {
    const d = await trapDeath();
    expect(await sweep({ trapKillsWrite: true })).toMatchObject({ written: 1 });
    const first = await verdict(d.lid);
    expect(await sweep({ trapKillsWrite: true, now: new Date(NOW.getTime() + 60_000) })).toMatchObject({ written: 0, failed: 0 });
    expect(await verdict(d.lid)).toEqual(first);
    expect(await trapRows()).toHaveLength(1);
  });

  it("rewrites a row at an older version in place", async () => {
    const d = await plainDeath({ complete: true });
    await sweep();
    await db.execute(dsql`UPDATE death_verdicts SET classifier_version = ${CLASSIFIER_VERSION - 1}, cause = 'unknown', rule = 'B00'`);
    expect(await sweep()).toMatchObject({ written: 1 });
    const rows = await db.select().from(deathVerdicts);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ lifeId: d.lid, classifierVersion: CLASSIFIER_VERSION, cause: "suicide", rule: "B01" });
  });

  it("a throwing life gets a queue row with backoff and the others are written", async () => {
    const log2 = await seedAdmLog(db, sid, [{ date: "2031-06-10", start: "12:00:00", complete: true, lines: [
      ["12:01:00", line.connected(V)], ["12:20:00", line.died(V)],
      ["12:01:00", line.connected(O, 3000)], ["12:30:00", line.died(O, 3000)],
    ] }]);
    const f = log2.fileIds[0]!;
    const bad = await life(await player(V, null), log2.at(f, log2.idx(0)), log2.at(f, log2.idx(1)), "died");
    const good = await life(await player(O), log2.at(f, log2.idx(2)), log2.at(f, log2.idx(3)), "died");
    expect(await sweep()).toMatchObject({ written: 1, failed: 1, held: 0 });
    expect(await verdict(good)).toBeDefined();
    const q = (await queueRow(bad))!;
    expect(q).toMatchObject({ attempts: 1, last_error: "no dayz id" });
    expect(new Date(q.next_attempt_at as string).getTime()).toBe(NOW.getTime() + 30_000);
    // not retried while backing off
    expect(await sweep({ now: new Date(NOW.getTime() + 10_000) })).toMatchObject({ failed: 0 });
    const t1 = new Date(NOW.getTime() + 30_000);
    expect(await sweep({ now: t1 })).toMatchObject({ failed: 1 });
    const q2 = (await queueRow(bad))!;
    expect(q2.attempts).toBe(2);
    expect(new Date(q2.next_attempt_at as string).getTime()).toBe(t1.getTime() + 60_000);
    const t2 = new Date(t1.getTime() + 60_000);
    expect(await sweep({ now: t2 })).toMatchObject({ failed: 1, held: 1 });
    expect(log.error).toHaveBeenCalledWith({ held: 1 }, "verdict_sweep.held");
  });

  it("re-derives a wall-settled row once", async () => {
    const d = await plainDeath();
    await sweep({ now: NOW });
    const later = new Date(NOW.getTime() + SETTLE_WALL_MINUTES * 60_000);
    await sweep({ now: later });
    expect((await verdict(d.lid))!.settledBy).toBe("wall");
    // the server rotates: the second look runs once and records how it settled
    await seedAdmLog(db, sid, [{ date: "2031-06-10", start: "16:00:00", lines: [["16:01:00", line.connected(T, 5000)]] }]);
    expect(await sweep({ now: new Date(later.getTime() + 60_000) })).toMatchObject({ rederived: 1 });
    expect((await verdict(d.lid))!.settledBy).toBe("rotation");
    expect(await sweep({ now: new Date(later.getTime() + 120_000) })).toMatchObject({ rederived: 0, written: 0 });
  });

  it("re-derives a wall-settled row after 24 h even with no new line, and only once", async () => {
    const d = await plainDeath();
    await sweep({ now: NOW });
    const later = new Date(NOW.getTime() + SETTLE_WALL_MINUTES * 60_000);
    await sweep({ now: later });
    const day = new Date(later.getTime() + 24 * 3600_000);
    expect(await sweep({ now: day })).toMatchObject({ rederived: 1 });
    expect((await verdict(d.lid))!.settledBy).toBe("wall");
    expect(await sweep({ now: new Date(day.getTime() + 60_000) })).toMatchObject({ rederived: 0 });
  });

  it("refills after TRUNCATE lives CASCADE", async () => {
    const d = await plainDeath({ complete: true });
    await sweep();
    expect(await verdict(d.lid)).toBeDefined();
    const [l] = await db.select().from(lives);
    await db.execute(dsql`TRUNCATE lives CASCADE`);
    expect(await db.select().from(deathVerdicts)).toHaveLength(0);
    const again = await life(l!.playerId, l!.startedAt, l!.endedAt!, l!.deathCause);
    expect(await sweep()).toMatchObject({ written: 1 });
    expect(await verdict(again)).toMatchObject({ cause: "suicide" });
  });
});

describe("the invariant", () => {
  it("sets needs_review when the basis and the coarse word disagree", async () => {
    const a = await pvpDeath("died");
    await sweep();
    expect(await verdict(a.lid)).toMatchObject({ attrBasis: "kill_line", needsReview: true });
  });

  it("a kill-line death stored as pvp is not flagged", async () => {
    const a = await pvpDeath("pvp");
    await sweep();
    expect(await verdict(a.lid)).toMatchObject({ attrBasis: "kill_line", needsReview: false, rule: "A04" });
  });

  it("a pvp coarse word with no kill-line attribution is flagged", async () => {
    const d = await trapDeath({ deathCause: "pvp" });
    await sweep();
    expect(await verdict(d.lid)).toMatchObject({ needsReview: true });
  });
});

describe("overrides", () => {
  it("applies an override matched on the death line", async () => {
    const d = await plainDeath({ complete: true });
    await override(d.f, d.deathLine, { cause: "fall", confidence: "strong" });
    await sweep();
    const v = (await verdict(d.lid))!;
    expect(v).toMatchObject({ cause: "fall", confidence: "strong", source: "override", rule: "B01" });
    const o = (await db.execute(dsql`SELECT updated_at FROM death_verdict_overrides`)) as unknown as { updated_at: string }[];
    expect(v.overrideSeenAt!.toISOString()).toBe(new Date(o[0]!.updated_at).toISOString());
  });

  it("an override keyed on the suicide line the life was folded from does not match", async () => {
    const d = await plainDeath({ complete: true });
    await override(d.f, d.log.idx(1), { cause: "fall" });
    await sweep();
    expect(await verdict(d.lid)).toMatchObject({ cause: "suicide", source: "classifier", overrideSeenAt: null });
  });

  it("ignores an override with an unknown cause", async () => {
    const d = await plainDeath({ complete: true });
    await override(d.f, d.deathLine, { cause: "teleported" });
    await sweep();
    expect(await verdict(d.lid)).toMatchObject({ cause: "suicide", source: "classifier" });
  });

  it("an override with null cause changes only the credit", async () => {
    const d = await trapDeath();
    await override(d.f, d.deathLine, { credit: "deny" });
    await sweep({ trapKillsWrite: true });
    expect(await verdict(d.lid)).toMatchObject({ cause: "explosive_trap", confidence: "definitive", source: "classifier", rule: "A07" });
    expect(await creditOf(d.lid)).toMatchObject({ outcome: "denied", refusedBy: null });
    expect(await trapRows()).toHaveLength(0);
  });

  it("an override applied once is not applied again: updated_at's microseconds are not a change", async () => {
    const d = await plainDeath({ complete: true });
    await db.execute(dsql`
      INSERT INTO death_verdict_overrides (server_id, death_file_id, death_line_index, cause, note, created_by, updated_at)
      VALUES (${sid}, ${d.f}, ${d.deathLine}, 'fall', 'test', 'test', '2031-06-01T00:00:00.123456Z')`);
    expect(await sweep()).toMatchObject({ written: 1 });
    expect(await sweep()).toMatchObject({ written: 0 });
  });

  it("editing an override row re-derives the life on the next pass", async () => {
    const d = await plainDeath({ complete: true });
    await override(d.f, d.deathLine, { cause: "fall" });
    await sweep();
    expect(await sweep()).toMatchObject({ written: 0 });
    await db.execute(dsql`UPDATE death_verdict_overrides SET cause = 'drowned'`);
    expect(await sweep()).toMatchObject({ written: 1 });
    expect(await verdict(d.lid)).toMatchObject({ cause: "drowned", source: "override" });
  });

  it("the trigger moves updated_at on every update", async () => {
    const d = await plainDeath({ complete: true });
    await override(d.f, d.deathLine, { cause: "fall" });
    await db.execute(dsql`UPDATE death_verdict_overrides SET updated_at = '2000-01-01T00:00:00Z'`);
    const r = (await db.execute(dsql`SELECT updated_at FROM death_verdict_overrides`)) as unknown as { updated_at: string }[];
    expect(new Date(r[0]!.updated_at).getUTCFullYear()).toBeGreaterThan(2000);
  });

  it("deleting an override row re-derives the life and removes a granted credit", async () => {
    const d = await trapDeath({ secondPlacer: true });
    await override(d.f, d.deathLine, { credit: "grant", credit_dayz_id: O.id });
    await sweep({ trapKillsWrite: true });
    expect(await creditOf(d.lid)).toMatchObject({ outcome: "granted", placerDayzId: O.id });
    expect(await trapRows()).toHaveLength(1);
    await db.execute(dsql`DELETE FROM death_verdict_overrides`);
    expect(await sweep({ trapKillsWrite: true })).toMatchObject({ written: 1 });
    expect(await creditOf(d.lid)).toMatchObject({ outcome: "refused", refusedBy: 2 });
    expect(await trapRows()).toHaveLength(0);
    expect((await verdict(d.lid))!.overrideSeenAt).toBeNull();
  });
});

describe("trap kills", () => {
  it("a passing trap death writes a trap_placement row in kills in the same transaction as the verdict", async () => {
    const d = await trapDeath();
    await sweep({ trapKillsWrite: true });
    expect(await creditOf(d.lid)).toMatchObject({ outcome: "credited", refusedBy: null, placerDayzId: O.id });
    const rows = await trapRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      serverId: sid, killerPlayerId: pids.get(O.id), killerGamertag: O.name, victimGamertag: V.name,
      victimPlayerId: pids.get(V.id), victimLifeId: d.lid, weapon: "Tripwire", distance: null,
      basis: "trap_placement", creditSource: "classifier",
    });
    expect(rows[0]!.occurredAt.toISOString()).toBe(d.endedAt.toISOString());
  });

  it("a failed verdict write leaves no trap row behind", async () => {
    const d = await trapDeath();
    await db.execute(dsql`ALTER TABLE death_verdicts ADD CONSTRAINT test_no_trap CHECK (cause <> 'explosive_trap')`);
    try {
      expect(await sweep({ trapKillsWrite: true })).toMatchObject({ written: 0, failed: 1 });
      expect(await trapRows()).toHaveLength(0);
      expect(await verdict(d.lid)).toBeUndefined();
    } finally {
      await db.execute(dsql`ALTER TABLE death_verdicts DROP CONSTRAINT test_no_trap`);
    }
  });

  it("nothing is written to kills while TRAP_KILLS_WRITE is off, and an existing trap row is removed", async () => {
    const d = await trapDeath();
    await db.insert(kills).values({
      serverId: sid, killerGamertag: O.name, killerPlayerId: pids.get(O.id), victimGamertag: V.name, victimPlayerId: pids.get(V.id),
      victimLifeId: d.lid, weapon: "Tripwire", occurredAt: d.endedAt, basis: "trap_placement", creditSource: "classifier",
    });
    await sweep({ trapKillsWrite: false });
    expect(await trapRows()).toHaveLength(0);
    // the outcome is still worked out and kept for the operator
    expect(await creditOf(d.lid)).toMatchObject({ outcome: "credited" });
  });

  it("a kill_line row for the same victim life is never touched", async () => {
    const d = await trapDeath();
    await db.insert(kills).values({
      serverId: sid, killerGamertag: K.name, killerPlayerId: pids.get(K.id), victimGamertag: V.name, victimPlayerId: pids.get(V.id),
      victimLifeId: d.lid, weapon: "M4-A1", distance: 40, occurredAt: d.endedAt,
    });
    await sweep({ trapKillsWrite: true });
    const all = await db.select().from(kills);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ basis: "kill_line", creditSource: null, killerGamertag: K.name, weapon: "M4-A1" });
    expect((await creditOf(d.lid))!.flags).toContain("kill_line_row_exists");
  });

  it("the check constraint refuses a trap row with no killer id", async () => {
    await expect(db.execute(dsql`
      INSERT INTO kills (server_id, killer_gamertag, victim_gamertag, occurred_at, basis, credit_source)
      VALUES (${sid}, 'Other Two', 'Victim One', now(), 'trap_placement', 'classifier')`)).rejects.toThrow();
    await expect(db.execute(dsql`
      INSERT INTO kills (server_id, killer_gamertag, victim_gamertag, occurred_at, credit_source)
      VALUES (${sid}, 'Other Two', 'Victim One', now(), 'classifier')`)).rejects.toThrow();
  });

  it("a placer with no players row is refused by test 6", async () => {
    const d = await trapDeath({ placerRow: false });
    await sweep({ trapKillsWrite: true });
    expect(await creditOf(d.lid)).toMatchObject({ outcome: "refused", refusedBy: 6 });
    expect(await trapRows()).toHaveLength(0);
  });

  it("a victim life of 238 s with no kill is refused by test 7", async () => {
    const d = await trapDeath({ playtime: 238 });
    await sweep({ trapKillsWrite: true });
    expect(await creditOf(d.lid)).toMatchObject({ outcome: "refused", refusedBy: 7 });
    expect(await trapRows()).toHaveLength(0);
  });

  it("a victim life of 238 s with a kill-line kill of its own passes test 7", async () => {
    const d = await trapDeath({ playtime: 238 });
    const [l] = await db.select().from(lives).where(eq(lives.id, d.lid));
    await db.insert(kills).values({
      serverId: sid, killerGamertag: V.name, killerPlayerId: pids.get(V.id), victimGamertag: K.name, victimPlayerId: pids.get(K.id),
      victimLifeId: null, occurredAt: new Date(l!.startedAt.getTime() + 60_000),
    });
    await sweep({ trapKillsWrite: true });
    expect(await creditOf(d.lid)).toMatchObject({ outcome: "credited" });
  });

  it("a deny removes the row and records outcome denied", async () => {
    const d = await trapDeath();
    await sweep({ trapKillsWrite: true });
    expect(await trapRows()).toHaveLength(1);
    await override(d.f, d.deathLine, { credit: "deny" });
    expect(await sweep({ trapKillsWrite: true })).toMatchObject({ written: 1 });
    expect(await trapRows()).toHaveLength(0);
    expect(await creditOf(d.lid)).toMatchObject({ outcome: "denied" });
  });

  it("a grant writes a row with credit_source override for a death tests 2, 3 or 5 refused", async () => {
    const d = await trapDeath({ secondPlacer: true });
    await sweep({ trapKillsWrite: true });
    expect(await creditOf(d.lid)).toMatchObject({ outcome: "refused", refusedBy: 2 });
    expect(await trapRows()).toHaveLength(0);
    await override(d.f, d.deathLine, { credit: "grant", credit_dayz_id: T.id });
    await sweep({ trapKillsWrite: true });
    expect(await creditOf(d.lid)).toMatchObject({ outcome: "granted", refusedBy: null, placerDayzId: T.id });
    expect(await trapRows()).toMatchObject([{ creditSource: "override", killerPlayerId: pids.get(T.id), killerGamertag: T.name }]);
  });

  it("a grant for a victim life of 238 s writes no row", async () => {
    const d = await trapDeath({ secondPlacer: true, playtime: 238 });
    await override(d.f, d.deathLine, { credit: "grant", credit_dayz_id: O.id });
    await sweep({ trapKillsWrite: true });
    const c = (await creditOf(d.lid))!;
    expect(c).toMatchObject({ outcome: "refused", refusedBy: 7 });
    expect(c.flags).toContain("grant_refused");
    expect(await trapRows()).toHaveLength(0);
  });

  it("a grant to the victim is refused by test 4", async () => {
    const d = await trapDeath({ secondPlacer: true });
    await override(d.f, d.deathLine, { credit: "grant", credit_dayz_id: V.id });
    await sweep({ trapKillsWrite: true });
    expect(await creditOf(d.lid)).toMatchObject({ outcome: "refused", refusedBy: 4 });
  });

  it("a grant on a death that is no trap death is refused (test 1) and writes nothing", async () => {
    const d = await plainDeath({ complete: true });
    await override(d.f, d.deathLine, { credit: "grant", credit_dayz_id: O.id });
    await player(O);
    await sweep({ trapKillsWrite: true });
    expect(await creditOf(d.lid)).toBeNull();
    expect(await trapRows()).toHaveLength(0);
  });

  it("a needs_review verdict gets no credit", async () => {
    const d = await trapDeath({ deathCause: "pvp" });
    await sweep({ trapKillsWrite: true });
    expect(await verdict(d.lid)).toMatchObject({ needsReview: true });
    expect(await trapRows()).toHaveLength(0);
  });

  it("a version bump rewrites the credit with the verdict", async () => {
    const d = await trapDeath();
    await sweep({ trapKillsWrite: true });
    await db.execute(dsql`DELETE FROM kills`);
    await db.execute(dsql`UPDATE death_verdicts SET classifier_version = ${CLASSIFIER_VERSION - 1}, evidence = '{}'::jsonb`);
    expect(await sweep({ trapKillsWrite: true })).toMatchObject({ written: 1 });
    expect(await creditOf(d.lid)).toMatchObject({ outcome: "credited" });
    expect(await trapRows()).toHaveLength(1);
  });

  it("trap rows go with the kills truncate and are refilled", async () => {
    const d = await trapDeath();
    await sweep({ trapKillsWrite: true });
    const [l] = await db.select().from(lives).where(eq(lives.id, d.lid));
    // the rebuild's truncate set: kills, and lives with the verdicts by cascade
    await db.execute(dsql`TRUNCATE kills, lives CASCADE`);
    expect(await trapRows()).toHaveLength(0);
    const again = await life(l!.playerId, l!.startedAt, l!.endedAt!, l!.deathCause, l!.playtimeSeconds);
    await sweep({ trapKillsWrite: true });
    expect(await trapRows()).toMatchObject([{ victimLifeId: again, basis: "trap_placement" }]);
  });

  it("a stored credit never says evidence_passes", async () => {
    const d = await trapDeath({ placerRow: false });
    await sweep({ trapKillsWrite: false });
    const d2 = await creditOf(d.lid);
    expect(d2!.outcome).not.toBe("evidence_passes");
  });
});
