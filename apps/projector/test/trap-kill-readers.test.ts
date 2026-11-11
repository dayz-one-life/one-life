import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { sql as dsql } from "drizzle-orm";
import { servers, players, lives, sessions, playerGamertags } from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { seedAdmLog, line, fakeId, type Who } from "@onelife/test-support/adm-log";
import { getPlayerPage, getLifeTimeline, getLeaderboard, getPublicDeath } from "@onelife/read-models";
import { sweepVerdicts } from "../src/verdict-sweep.js";

/**
 * Death-verdict step 7: a trap kill written by the sweep reaches every reader, and a deny override
 * followed by one sweep pass takes it out of every reader again — the placer's life is unqualified,
 * the kill is gone from the page, the timeline and the boards, and the victim's death has no credit.
 *
 * ⚠️ Every name, id and line is invented. Fixtures follow `verdict-sweep.test.ts`.
 */
const { db, sql } = getTestDb();
const V: Who = { name: "Victim One", id: fakeId("1") };
const O: Who = { name: "Placer Two", id: fakeId("2") };
const K: Who = { name: "Bystander Four", id: fakeId("4") };
const NOW = new Date("2031-06-11T00:00:00Z");
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
let sid: number;

beforeEach(async () => {
  await db.execute(dsql`TRUNCATE lives, players, kills, events, raw_lines, adm_files, servers, death_verdict_overrides RESTART IDENTITY CASCADE`);
  const [s] = await db.insert(servers).values({ nitradoServiceId: Math.floor(Math.random() * 1e8) + 6e8, name: "TR", map: "chernarusplus", slug: "tr-readers", active: true }).returning();
  sid = s!.id;
});
afterAll(async () => { await sql.end(); });

async function player(p: Who, lastSeenAt: Date | null = null): Promise<number> {
  const [r] = await db.insert(players).values({ gamertag: p.name, dayzId: p.id, lastSeenAt }).returning();
  await db.insert(playerGamertags).values({ playerId: Number(r!.id), gamertag: p.name, firstSeenAt: NOW, lastSeenAt: NOW });
  return Number(r!.id);
}

/** Placer Two sets a wire two days early, respawns into a fresh 60-second life and logs off;
 *  Victim One (a 600-second life) trips it. */
async function world() {
  const log2 = await seedAdmLog(db, sid, [
    { date: "2031-06-08", start: "08:00:00", lines: [["08:10:00", line.wire(O, 1001.5)]] },
    { date: "2031-06-10", start: "12:00:00", lines: [
      ["12:01:00", line.connected(V)], ["12:20:00", line.trip(V)], ["12:20:04", line.fragBlast(V)], ["12:20:04", line.fragKill(V)],
      ["12:26:05", line.pos(K, 6000)],
    ] },
  ]);
  const f = log2.fileIds[1]!;
  const vid = await player(V);
  const placerStart = new Date("2031-06-10T11:00:00Z");
  const oid = await player(O, new Date(placerStart.getTime() + 60_000));
  await player(K);
  const endedAt = log2.at(f, log2.idx(3));
  const [vl] = await db.insert(lives).values({ serverId: sid, playerId: vid, lifeNumber: 1, startedAt: log2.at(f, log2.idx(0)), endedAt, deathCause: "explosion", playtimeSeconds: 600 }).returning();
  const [pl] = await db.insert(lives).values({ serverId: sid, playerId: oid, lifeNumber: 1, startedAt: placerStart, endedAt: null, playtimeSeconds: 60 }).returning();
  await db.insert(sessions).values({ serverId: sid, playerId: oid, lifeId: Number(pl!.id), connectedAt: placerStart, disconnectedAt: new Date(placerStart.getTime() + 60_000), durationSeconds: 60, closeReason: "disconnect" });
  return { f, deathLine: log2.idx(3), victimLife: { ...vl!, id: Number(vl!.id) }, placerLife: Number(pl!.id) };
}

async function readers(w: Awaited<ReturnType<typeof world>>) {
  const page = (await getPlayerPage(db, O.name, NOW))!;
  const card = page.standing.find((c) => c.serverId === sid)!;
  const timeline = (await getLifeTimeline(db, sid, O.name, w.placerLife))!;
  const most = await getLeaderboard(db, sid, "most-kills", NOW, 50);
  const streak = await getLeaderboard(db, sid, "longest-killstreak", NOW, 50);
  const alive = await getLeaderboard(db, sid, "alive-longest", NOW, 50);
  const victim = (await getPublicDeath(db, w.victimLife))!;
  return { page, card, timeline, most, streak, alive, victim };
}

describe("a trap kill through the sweep, and its denial", () => {
  it("a deny override and a sweep pass make that life unqualified everywhere and remove the kill from every route", async () => {
    const w = await world();
    await sweepVerdicts(db, { now: NOW, log, trapKillsWrite: true });

    const on = await readers(w);
    expect(on.card).toMatchObject({ state: "alive", alive: { qualified: true, kills: 1 } });
    expect(on.card.alive!.killList[0]).toMatchObject({ victimGamertag: V.name, basis: "trap_placement" });
    expect(on.page.totals.kills).toBe(1);
    expect(on.timeline.qualifiedAt).toMatchObject({ by: "kill", killBasis: "trap_placement" });
    expect(on.most.map((r) => r.gamertag)).toContain(O.name);
    expect(on.streak.map((r) => r.gamertag)).toContain(O.name);
    expect(on.alive.map((r) => r.gamertag)).toContain(O.name);
    expect(on.victim.credit).toMatchObject({ gamertag: O.name, device: "tripwire", byOperator: false });

    await db.execute(dsql`
      INSERT INTO death_verdict_overrides (server_id, death_file_id, death_line_index, credit, note, created_by)
      VALUES (${sid}, ${w.f}, ${w.deathLine}, 'deny', 'test', 'test')`);
    await sweepVerdicts(db, { now: NOW, log, trapKillsWrite: true });

    const off = await readers(w);
    expect(off.card).toMatchObject({ state: "alive", alive: { qualified: false, kills: 0 } });
    expect(off.page.totals.kills).toBe(0);
    expect(off.timeline.qualifiedAt).toBeNull();
    expect(off.timeline.kills).toEqual([]);
    expect(off.most.map((r) => r.gamertag)).not.toContain(O.name);
    expect(off.streak.map((r) => r.gamertag)).not.toContain(O.name);
    expect(off.alive.map((r) => r.gamertag)).not.toContain(O.name);
    expect(off.victim.credit).toBeNull();
    expect(JSON.stringify(off.victim)).not.toContain(O.name);
  });

  it("with the switch off the death reads as a tripwire with no credit and the placer's life does not count", async () => {
    const w = await world();
    await sweepVerdicts(db, { now: NOW, log, trapKillsWrite: false });
    const r = await readers(w);
    expect(r.victim).toMatchObject({ status: "final", label: "Tripwire", detail: "M67 frag grenade", credit: null });
    expect(r.card).toMatchObject({ alive: { qualified: false, kills: 0 } });
  });
});
