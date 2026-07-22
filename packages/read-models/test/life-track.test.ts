import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, sessions, kills, positions } from "@onelife/db";
import { getLifeTrack } from "../src/life-track.js";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 52e7;
const start = new Date("2026-07-14T00:00:00Z");
const mins = (m: number) => new Date(start.getTime() + m * 60_000);
const tag = `TrkHero-${svc}`;
const other = `TrkOther-${svc}`;

let serverId: number;
let pid: number;
let otherPid: number;

beforeAll(async () => {
  const [s] = await db.insert(servers).values({
    nitradoServiceId: svc, name: "trk", map: "enoch", slug: `trk-${svc}`, active: true,
  }).returning();
  serverId = s!.id;

  // The other player is created first (irrelevant to the ordering below, but kept for
  // readability alongside its life).
  const [o] = await db.insert(players).values({ gamertag: other, lastSeenAt: mins(200) }).returning();
  otherPid = o!.id;
  const [p] = await db.insert(players).values({ gamertag: tag, lastSeenAt: mins(200) }).returning();
  pid = p!.id;

  // Another player's colliding life 1 on the same server.
  // ⚠️ This row is inserted BEFORE the subject's life 1 below, so it gets the lower
  // `lives.id`. `getLifeTrack`'s opening query orders `ASC(lives.id) LIMIT 1` for a
  // deterministic tiebreak — with the `lower(players.gamertag) = lower(gamertag)`
  // predicate removed, the two rows would still collide on (server_id, lifeNumber=1),
  // and the ORDER BY would deterministically pick THIS row (the wrong player's life),
  // which is what makes the guard test below fail in a way that doesn't depend on the
  // query planner. Swapping the insertion order would silently defang that test.
  const [ol] = await db.insert(lives).values({
    serverId, playerId: otherPid, lifeNumber: 1, startedAt: start, endedAt: mins(60), playtimeSeconds: 3600,
  }).returning();
  await db.insert(sessions).values({
    serverId, playerId: otherPid, lifeId: ol!.id, connectedAt: start, disconnectedAt: mins(60), durationSeconds: 3600, closeReason: "death",
  });
  await db.insert(positions).values({
    serverId, playerId: otherPid, gamertag: other, x: 9999, y: 9999, recordedAt: mins(10),
  });

  // Life 1: closed, two sessions with a gap between them.
  const [l1] = await db.insert(lives).values({
    serverId, playerId: pid, lifeNumber: 1, startedAt: start, endedAt: mins(120),
    deathCause: "pvp", deathByGamertag: "Killer", playtimeSeconds: 7200,
  }).returning();
  await db.insert(sessions).values([
    { serverId, playerId: pid, lifeId: l1!.id, connectedAt: start, disconnectedAt: mins(30), durationSeconds: 1800, closeReason: "disconnect" },
    { serverId, playerId: pid, lifeId: l1!.id, connectedAt: mins(60), disconnectedAt: mins(120), durationSeconds: 3600, closeReason: "death" },
  ]);
  await db.insert(kills).values({
    serverId, killerGamertag: tag, victimGamertag: "Victim1", weapon: "KAS-74U", distance: 25, occurredAt: mins(70),
  });
  // A kill by the OTHER player in the same server/time window — must never bleed into
  // the subject's track via a missing killerGamertag predicate.
  await db.insert(kills).values({
    serverId, killerGamertag: other, victimGamertag: "OtherVictim", weapon: "KAS-74U", distance: 10, occurredAt: mins(75),
  });
  // Fixes: two in session 1 (far apart so neither is thinned), two in session 2.
  await db.insert(positions).values([
    { serverId, playerId: pid, gamertag: tag, x: 1000, y: 1000, recordedAt: mins(5) },
    { serverId, playerId: pid, gamertag: tag, x: 2000, y: 2000, recordedAt: mins(25) },
    { serverId, playerId: pid, gamertag: tag, x: 5000, y: 5000, recordedAt: mins(65) },
    { serverId, playerId: pid, gamertag: tag, x: 6000, y: 6000, recordedAt: mins(119) },
  ]);

  // Life 2: open.
  const [l2] = await db.insert(lives).values({
    serverId, playerId: pid, lifeNumber: 2, startedAt: mins(150), endedAt: null, playtimeSeconds: 0,
  }).returning();
  await db.insert(sessions).values({
    serverId, playerId: pid, lifeId: l2!.id, connectedAt: mins(150), disconnectedAt: null, durationSeconds: null, closeReason: null,
  });
  await db.insert(positions).values({
    serverId, playerId: pid, gamertag: tag, x: 7000, y: 7000, recordedAt: mins(199),
  });
});

afterAll(async () => { await sql.end(); });

describe("getLifeTrack", () => {
  it("returns the map codename so the client can pick the right projection", async () => {
    const t = await getLifeTrack(db, serverId, tag, 1);
    expect(t!.mapCodename).toBe("enoch");
  });

  it("segments per session and never joins across the gap", async () => {
    const t = await getLifeTrack(db, serverId, tag, 1);
    expect(t!.segments).toHaveLength(2);
    expect(t!.segments[0]!.points).toHaveLength(2);
    expect(t!.segments[1]!.points).toHaveLength(2);
  });

  it("emits an approximate kill marker from the preceding fix", async () => {
    const t = await getLifeTrack(db, serverId, tag, 1);
    const k = t!.markers.find((m) => m.kind === "kill");
    expect(k!.x).toBe(5000);
    expect(k!.label).toBe("Victim1");
    expect(k!.sampleAgeSeconds).toBe(300); // 65m fix, 70m kill
  });

  it("NEVER includes a kill credited to another player, even in the same server and window", async () => {
    const t = await getLifeTrack(db, serverId, tag, 1);
    expect(t!.markers.some((m) => m.label === "OtherVictim")).toBe(false);
  });

  it("resolves the CALLER's own life 1, not another player's colliding life 1", async () => {
    const t = await getLifeTrack(db, serverId, tag, 1);
    // The subject's life 1 has two sessions and a kill marker; the other player's life 1
    // (same serverId, same lifeNumber) has one session and no kills.
    expect(t!.segments).toHaveLength(2);
    expect(t!.markers.some((m) => m.kind === "kill")).toBe(true);
  });

  it("emits a death marker for a closed life and no `now` marker", async () => {
    const t = await getLifeTrack(db, serverId, tag, 1);
    expect(t!.markers.some((m) => m.kind === "death")).toBe(true);
    expect(t!.markers.some((m) => m.kind === "now")).toBe(false);
    expect(t!.alive).toBe(false);
  });

  it("emits a `now` marker for an open life and no death marker", async () => {
    const t = await getLifeTrack(db, serverId, tag, 2);
    expect(t!.markers.some((m) => m.kind === "now")).toBe(true);
    expect(t!.markers.some((m) => m.kind === "death")).toBe(false);
    expect(t!.alive).toBe(true);
  });

  it("reports the honest pre-thinning sample count", async () => {
    const t = await getLifeTrack(db, serverId, tag, 1);
    expect(t!.sampleCount).toBe(4);
    expect(t!.truncated).toBe(false);
  });

  it("NEVER returns another player's fixes, even on the same server and life number", async () => {
    const t = await getLifeTrack(db, serverId, tag, 1);
    const xs = t!.segments.flatMap((s) => s.points.map((p) => p.x));
    expect(xs).not.toContain(9999);
  });

  it("returns null for a life number that gamertag does not have", async () => {
    expect(await getLifeTrack(db, serverId, tag, 99)).toBeNull();
  });

  it("returns null for a gamertag with no lives at all", async () => {
    expect(await getLifeTrack(db, serverId, `Ghost-${svc}`, 1)).toBeNull();
  });
});
