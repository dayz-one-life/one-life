import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, sessions, positions } from "@onelife/db";
import { inArray } from "drizzle-orm";
import { findLongFormCandidates } from "../src/long-form-targets.js";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 53e7;
const t0 = new Date("2026-07-11T00:00:00.000Z");
const mins = (m: number) => new Date(t0.getTime() + m * 60_000);
let serverId: number;
const pids: number[] = [];
const tag = (n: string) => `lf-${n}-${svc}`;

async function mkPlayer(name: string) {
  const [p] = await db.insert(players).values({ gamertag: tag(name), lastSeenAt: mins(600) }).returning();
  pids.push(p!.id);
  return p!.id;
}

beforeAll(async () => {
  const [s] = await db.insert(servers).values({
    nitradoServiceId: svc, name: "lf", map: "chernarusplus", slug: `lf-${svc}`, active: true,
  }).returning();
  serverId = s!.id;

  const ay = await mkPlayer("ay");        // qualified (playtime), fresh fix
  const bee = await mkPlayer("bee");      // qualified, fresh fix, near Ay
  const shorty = await mkPlayer("short"); // NOT qualified — 30s playtime, no kills, not pvp
  const stale = await mkPlayer("stale");  // qualified but fix is 10 minutes old
  const nofix = await mkPlayer("nofix");  // qualified, no positions row at all

  await db.insert(lives).values([
    { serverId, playerId: ay,     lifeNumber: 1, startedAt: mins(0), endedAt: mins(60), deathCause: "pvp",         playtimeSeconds: 3600 },
    { serverId, playerId: bee,    lifeNumber: 1, startedAt: mins(0), endedAt: mins(61), deathCause: "infected",    playtimeSeconds: 3660 },
    { serverId, playerId: shorty, lifeNumber: 1, startedAt: mins(0), endedAt: mins(60), deathCause: "environment", playtimeSeconds: 30 },
    { serverId, playerId: stale,  lifeNumber: 1, startedAt: mins(0), endedAt: mins(60), deathCause: "mauled",      playtimeSeconds: 3600 },
    { serverId, playerId: nofix,  lifeNumber: 1, startedAt: mins(0), endedAt: mins(60), deathCause: "mauled",      playtimeSeconds: 3600 },
  ]);

  await db.insert(positions).values([
    { serverId, playerId: ay,     gamertag: tag("ay"),    x: 7423.51, y: 9210.88, recordedAt: mins(60) },
    { serverId, playerId: ay,     gamertag: tag("ay"),    x: 1111.11, y: 2222.22, recordedAt: mins(90) }, // AFTER death — must be ignored
    { serverId, playerId: bee,    gamertag: tag("bee"),   x: 7443.19, y: 9245.02, recordedAt: mins(61) },
    { serverId, playerId: shorty, gamertag: tag("short"), x: 7430.00, y: 9220.00, recordedAt: mins(60) },
    { serverId, playerId: stale,  gamertag: tag("stale"), x: 7430.00, y: 9220.00, recordedAt: mins(50) }, // 10 min stale
  ]);
});

afterAll(async () => {
  await db.delete(positions).where(inArray(positions.serverId, [serverId]));
  await db.delete(sessions).where(inArray(sessions.serverId, [serverId]));
  await db.delete(lives).where(inArray(lives.serverId, [serverId]));
  await db.delete(players).where(inArray(players.id, pids));
  await db.delete(servers).where(inArray(servers.id, [serverId]));
  await sql.end();
});

const OPTS = { since: t0, now: mins(600), maxFixAgeSeconds: 120, suppressedGamertags: [], candidateLimit: 200 };
// Generic (not `(rows: { gamertag: string }[]) => ...`): a non-generic parameter type would
// widen the filtered array back down to `{ gamertag: string }[]`, dropping DeathCandidate's
// `x`/`y` fields that the second test below asserts on.
const mine = <T extends { gamertag: string }>(rows: T[]): T[] =>
  rows.filter((r) => r.gamertag.endsWith(`-${svc}`));

describe("findLongFormCandidates", () => {
  it("returns only qualified deaths with a fresh fix, oldest death first", async () => {
    const rows = mine(await findLongFormCandidates(db, OPTS));
    expect(rows.map((r) => r.gamertag)).toEqual([tag("ay"), tag("bee")]);
  });

  it("takes the last fix AT OR BEFORE ended_at, never a later one", async () => {
    const rows = mine(await findLongFormCandidates(db, OPTS));
    const a = rows.find((r) => r.gamertag === tag("ay"))!;
    expect(a.x).toBeCloseTo(7423.51, 2);
    expect(a.y).toBeCloseTo(9210.88, 2);
  });

  it("drops a death whose only fix is older than maxFixAgeSeconds", async () => {
    const rows = mine(await findLongFormCandidates(db, OPTS));
    expect(rows.map((r) => r.gamertag)).not.toContain(tag("stale"));
  });

  it("drops a death with no positions row at all (INNER lateral, not LEFT)", async () => {
    const rows = mine(await findLongFormCandidates(db, OPTS));
    expect(rows.map((r) => r.gamertag)).not.toContain(tag("nofix"));
  });

  it("drops an unqualified death before it can seed or join a clique", async () => {
    const rows = mine(await findLongFormCandidates(db, OPTS));
    expect(rows.map((r) => r.gamertag)).not.toContain(tag("short"));
  });

  it("drops a suppressed gamertag case-insensitively", async () => {
    const rows = mine(await findLongFormCandidates(db, {
      ...OPTS, suppressedGamertags: [tag("ay").toUpperCase()],
    }));
    expect(rows.map((r) => r.gamertag)).toEqual([tag("bee")]);
  });

  it("honours the forward-only `since` cutoff on ended_at", async () => {
    const rows = mine(await findLongFormCandidates(db, { ...OPTS, since: mins(61) }));
    expect(rows.map((r) => r.gamertag)).toEqual([tag("bee")]);
  });
});
