import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, positions, articles } from "@onelife/db";
import { inArray } from "drizzle-orm";
import { findLongFormCandidates, findLongFormTargets } from "../src/long-form-targets.js";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 58e7;
const t0 = new Date("2026-07-11T00:00:00.000Z");
const mins = (m: number) => new Date(t0.getTime() + m * 60_000);
const secs = (s: number) => new Date(t0.getTime() + s * 1000);
const tag = (n: string) => `lb-${n}-${svc}`;
let serverA: number;
let serverB: number;
const pids: number[] = [];

async function mkPlayer(name: string) {
  const [p] = await db.insert(players).values({ gamertag: tag(name), lastSeenAt: mins(600) }).returning();
  pids.push(p!.id);
  return p!.id;
}

beforeAll(async () => {
  const [a] = await db.insert(servers).values({
    nitradoServiceId: svc, name: "lbA", map: "chernarusplus", slug: `lba-${svc}`, active: true,
  }).returning();
  const [b] = await db.insert(servers).values({
    nitradoServiceId: svc + 1, name: "lbB", map: "sakhal", slug: `lbb-${svc}`, active: true,
  }).returning();
  serverA = a!.id;
  serverB = b!.id;

  // ── Cross-server pair: same instant, same coordinates, DIFFERENT servers. ──
  const xa = await mkPlayer("xserver-a");
  const xb = await mkPlayer("xserver-b");
  // ── Fix-age boundary: fix EXACTLY maxFixAgeSeconds (120s) before the death -> IN. ──
  const edgeIn = await mkPlayer("fix-edge-in");
  // ── Fix-age boundary: fix 121s before the death -> OUT. ──
  const edgeOut = await mkPlayer("fix-edge-out");
  // ── Upper `now` bound: a death exactly at `now` -> IN; one a second later -> OUT. ──
  const nowIn = await mkPlayer("now-in");
  const nowOut = await mkPlayer("now-out");

  await db.insert(lives).values([
    { serverId: serverA, playerId: xa, lifeNumber: 1, startedAt: mins(0), endedAt: mins(60), deathCause: "infected", playtimeSeconds: 3600 },
    { serverId: serverB, playerId: xb, lifeNumber: 1, startedAt: mins(0), endedAt: mins(60), deathCause: "infected", playtimeSeconds: 3600 },
    { serverId: serverA, playerId: edgeIn,  lifeNumber: 1, startedAt: mins(0), endedAt: secs(6000), deathCause: "infected", playtimeSeconds: 3600 },
    { serverId: serverA, playerId: edgeOut, lifeNumber: 1, startedAt: mins(0), endedAt: secs(6000), deathCause: "infected", playtimeSeconds: 3600 },
    { serverId: serverA, playerId: nowIn,  lifeNumber: 1, startedAt: mins(0), endedAt: mins(300), deathCause: "infected", playtimeSeconds: 3600 },
    { serverId: serverA, playerId: nowOut, lifeNumber: 1, startedAt: mins(0), endedAt: secs(18_001), deathCause: "infected", playtimeSeconds: 3600 },
  ]);

  await db.insert(positions).values([
    { serverId: serverA, playerId: xa, gamertag: tag("xserver-a"), x: 7423.51, y: 9210.88, recordedAt: mins(60) },
    { serverId: serverB, playerId: xb, gamertag: tag("xserver-b"), x: 7423.51, y: 9210.88, recordedAt: mins(60) },
    // exactly 120s stale — the guard is `fix.recorded_at >= ended_at - 120s`, INCLUSIVE
    { serverId: serverA, playerId: edgeIn,  gamertag: tag("fix-edge-in"),  x: 100.0, y: 100.0, recordedAt: secs(5880) },
    // 121s stale — one second past
    { serverId: serverA, playerId: edgeOut, gamertag: tag("fix-edge-out"), x: 100.0, y: 100.0, recordedAt: secs(5879) },
    { serverId: serverA, playerId: nowIn,  gamertag: tag("now-in"),  x: 200.0, y: 200.0, recordedAt: mins(300) },
    { serverId: serverA, playerId: nowOut, gamertag: tag("now-out"), x: 200.0, y: 200.0, recordedAt: secs(18_001) },
  ]);
});

afterAll(async () => {
  await db.delete(articles).where(inArray(articles.serverId, [serverA, serverB]));
  await db.delete(positions).where(inArray(positions.serverId, [serverA, serverB]));
  await db.delete(lives).where(inArray(lives.serverId, [serverA, serverB]));
  await db.delete(players).where(inArray(players.id, pids));
  await db.delete(servers).where(inArray(servers.id, [serverA, serverB]));
  await sql.end();
});

const OPTS = {
  since: t0, now: mins(300), maxFixAgeSeconds: 120,
  suppressedGamertags: [] as string[], candidateLimit: 500,
};
const T_OPTS = { ...OPTS, windowSeconds: 180, radiusMeters: 100, maxAttempts: 3, limit: 5 };
const mine = <T extends { gamertag: string }>(rows: T[]): T[] =>
  rows.filter((r) => r.gamertag.endsWith(`-${svc}`));

describe("Long Form — cross-server, at the SQL layer", () => {
  it("selects both deaths as candidates", async () => {
    const tags = mine(await findLongFormCandidates(db, OPTS)).map((r) => r.gamertag);
    expect(tags).toContain(tag("xserver-a"));
    expect(tags).toContain(tag("xserver-b"));
  });

  it("never clusters them together — identical instant, identical coordinates, two servers", async () => {
    // buildLongFormClusters buckets by serverId in memory; this pins that the QUERY feeding it
    // preserves the distinction rather than collapsing rows from two servers into one bucket.
    const r = await findLongFormTargets(db, T_OPTS);
    const mixed = r.clusters.filter((c) =>
      c.subjects.some((s) => s.gamertag === tag("xserver-a")) &&
      c.subjects.some((s) => s.gamertag === tag("xserver-b")));
    expect(mixed).toEqual([]);
  });
});

describe("Long Form — the fix-age guard is inclusive at exactly maxFixAgeSeconds", () => {
  it("admits a fix exactly 120s before the death", async () => {
    const tags = mine(await findLongFormCandidates(db, OPTS)).map((r) => r.gamertag);
    expect(tags).toContain(tag("fix-edge-in"));
  });

  it("drops a fix 121s before the death", async () => {
    const tags = mine(await findLongFormCandidates(db, OPTS)).map((r) => r.gamertag);
    expect(tags).not.toContain(tag("fix-edge-out"));
  });
});

describe("Long Form — the upper `now` bound", () => {
  it("admits a death at exactly `now`", async () => {
    const tags = mine(await findLongFormCandidates(db, OPTS)).map((r) => r.gamertag);
    expect(tags).toContain(tag("now-in"));
  });

  it("drops a death one second after `now`", async () => {
    // Not hypothetical: `now` is passed per tick, and a projector fold running concurrently can
    // land a death with a timestamp past the instant this tick claimed to be reporting.
    const tags = mine(await findLongFormCandidates(db, OPTS)).map((r) => r.gamertag);
    expect(tags).not.toContain(tag("now-out"));
  });
});
