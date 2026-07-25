import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, sessions, gamertagLinks, user } from "@onelife/db";
import { eq, inArray } from "drizzle-orm";
import { getLastPlayedMapSlug } from "../src/last-played.js";

const { db, sql } = getTestDb();

const now = new Date("2026-07-14T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);

const svcA = Math.floor(Math.random() * 1e8) + 42e7;
const svcB = Math.floor(Math.random() * 1e8) + 43e7;
const svcDead = Math.floor(Math.random() * 1e8) + 44e7;
const svcUnslugged = Math.floor(Math.random() * 1e8) + 45e7;

let chern: { id: number; slug: string };
let sakh: { id: number; slug: string };
let retired: { id: number; slug: string };
let unslugged: { id: number };

const USER_ID = `lastplayed-user-${svcA}`;
const GAMERTAG = `LastPlayed${svcA}`;

const insertedGamertags = new Set<string>();

async function insertPlayer(gamertag: string, lastSeenAt: Date): Promise<number> {
  const [p] = await db
    .insert(players)
    .values({ gamertag, dayzId: `dz-${gamertag}`, firstSeenAt: hoursAgo(50), lastSeenAt })
    .returning();
  insertedGamertags.add(gamertag);
  return p!.id;
}

/** A session needs a life (FK), so every helper mints one. */
async function insertSession(opts: { serverId: number; playerId: number; connectedAt: Date; disconnectedAt?: Date | null }) {
  const [l] = await db
    .insert(lives)
    .values({
      serverId: opts.serverId, playerId: opts.playerId, lifeNumber: 1,
      startedAt: hoursAgo(40), endedAt: null, playtimeSeconds: 600,
    })
    .returning();
  await db.insert(sessions).values({
    serverId: opts.serverId, playerId: opts.playerId, lifeId: l!.id,
    connectedAt: opts.connectedAt, disconnectedAt: opts.disconnectedAt ?? null,
  });
}

async function link(userId: string, gamertag: string, status: "verified" | "pending") {
  await db.insert(gamertagLinks).values({ userId, gamertag, status });
}

beforeAll(async () => {
  const [a] = await db.insert(servers).values({ nitradoServiceId: svcA, name: "LP-Chernarus", map: "chernarusplus", slug: `lp-chernarus-${svcA}`, active: true }).returning();
  const [b] = await db.insert(servers).values({ nitradoServiceId: svcB, name: "LP-Sakhal", map: "sakhal", slug: `lp-sakhal-${svcB}`, active: true }).returning();
  const [d] = await db.insert(servers).values({ nitradoServiceId: svcDead, name: "LP-Retired", map: "enoch", slug: `lp-retired-${svcDead}`, active: false }).returning();
  const [u] = await db.insert(servers).values({ nitradoServiceId: svcUnslugged, name: "LP-Unslugged", map: "enoch", slug: null, active: true }).returning();
  chern = { id: a!.id, slug: a!.slug! };
  sakh = { id: b!.id, slug: b!.slug! };
  retired = { id: d!.id, slug: d!.slug! };
  unslugged = { id: u!.id };
  await db.insert(user).values({ id: USER_ID, name: "LP", email: `${USER_ID}@example.test`, emailVerified: true });
});

afterEach(async () => {
  const ids = [chern.id, sakh.id, retired.id, unslugged.id];
  await db.delete(sessions).where(inArray(sessions.serverId, ids));
  await db.delete(lives).where(inArray(lives.serverId, ids));
  await db.delete(gamertagLinks).where(eq(gamertagLinks.userId, USER_ID));
  if (insertedGamertags.size > 0) {
    await db.delete(players).where(inArray(players.gamertag, [...insertedGamertags]));
    insertedGamertags.clear();
  }
});

afterAll(async () => {
  await db.delete(user).where(eq(user.id, USER_ID));
  await db.delete(servers).where(inArray(servers.id, [chern.id, sakh.id, retired.id, unslugged.id]));
  await sql.end();
});

describe("getLastPlayedMapSlug", () => {
  it("returns the slug of the most recently connected session", async () => {
    const pid = await insertPlayer(GAMERTAG, hoursAgo(1));
    await link(USER_ID, GAMERTAG, "verified");
    await insertSession({ serverId: chern.id, playerId: pid, connectedAt: hoursAgo(10) });
    await insertSession({ serverId: sakh.id, playerId: pid, connectedAt: hoursAgo(2) });
    expect(await getLastPlayedMapSlug(db, USER_ID)).toBe(sakh.slug);
  });

  it("orders by connected_at, not by insertion order", async () => {
    // Guards the ORDER BY itself: the newest session is inserted FIRST here, so a query that
    // dropped the ordering (or took the last row) would return the wrong map.
    const pid = await insertPlayer(GAMERTAG, hoursAgo(1));
    await link(USER_ID, GAMERTAG, "verified");
    await insertSession({ serverId: sakh.id, playerId: pid, connectedAt: hoursAgo(1) });
    await insertSession({ serverId: chern.id, playerId: pid, connectedAt: hoursAgo(20) });
    expect(await getLastPlayedMapSlug(db, USER_ID)).toBe(sakh.slug);
  });

  it("counts an OPEN session — the player most likely to be asked about", async () => {
    // Ordering on `disconnected_at` would rank a null last (or throw it away entirely), and an
    // open session is exactly the case where "which map am I on" has an obvious right answer.
    const pid = await insertPlayer(GAMERTAG, hoursAgo(1));
    await link(USER_ID, GAMERTAG, "verified");
    await insertSession({ serverId: chern.id, playerId: pid, connectedAt: hoursAgo(9), disconnectedAt: hoursAgo(8) });
    await insertSession({ serverId: sakh.id, playerId: pid, connectedAt: hoursAgo(1), disconnectedAt: null });
    expect(await getLastPlayedMapSlug(db, USER_ID)).toBe(sakh.slug);
  });

  it("returns null for a user with no sessions at all", async () => {
    await insertPlayer(GAMERTAG, hoursAgo(1));
    await link(USER_ID, GAMERTAG, "verified");
    expect(await getLastPlayedMapSlug(db, USER_ID)).toBeNull();
  });

  it("returns null for a user with no verified link", async () => {
    const pid = await insertPlayer(GAMERTAG, hoursAgo(1));
    await insertSession({ serverId: chern.id, playerId: pid, connectedAt: hoursAgo(1) });
    expect(await getLastPlayedMapSlug(db, USER_ID)).toBeNull();
  });

  it("a PENDING link is not enough — anyone can type any gamertag into the claim box", async () => {
    const pid = await insertPlayer(GAMERTAG, hoursAgo(1));
    await link(USER_ID, GAMERTAG, "pending");
    await insertSession({ serverId: chern.id, playerId: pid, connectedAt: hoursAgo(1) });
    expect(await getLastPlayedMapSlug(db, USER_ID)).toBeNull();
  });

  // ⚠️ Mutation-tested: making the servers join a post-filter (or dropping either predicate)
  // makes these two return a slug the router would then have to reject.
  it("skips a session on an INACTIVE server rather than returning its slug", async () => {
    const pid = await insertPlayer(GAMERTAG, hoursAgo(1));
    await link(USER_ID, GAMERTAG, "verified");
    await insertSession({ serverId: chern.id, playerId: pid, connectedAt: hoursAgo(10) });
    await insertSession({ serverId: retired.id, playerId: pid, connectedAt: hoursAgo(1) });
    expect(await getLastPlayedMapSlug(db, USER_ID)).toBe(chern.slug);
  });

  it("skips a session on an UNSLUGGED server rather than returning null-as-a-slug", async () => {
    const pid = await insertPlayer(GAMERTAG, hoursAgo(1));
    await link(USER_ID, GAMERTAG, "verified");
    await insertSession({ serverId: chern.id, playerId: pid, connectedAt: hoursAgo(10) });
    await insertSession({ serverId: unslugged.id, playerId: pid, connectedAt: hoursAgo(1) });
    expect(await getLastPlayedMapSlug(db, USER_ID)).toBe(chern.slug);
  });

  it("returns null when EVERY session is on a server that no longer counts", async () => {
    const pid = await insertPlayer(GAMERTAG, hoursAgo(1));
    await link(USER_ID, GAMERTAG, "verified");
    await insertSession({ serverId: retired.id, playerId: pid, connectedAt: hoursAgo(1) });
    await insertSession({ serverId: unslugged.id, playerId: pid, connectedAt: hoursAgo(2) });
    expect(await getLastPlayedMapSlug(db, USER_ID)).toBeNull();
  });

  it("never returns another player's map", async () => {
    const mine = await insertPlayer(GAMERTAG, hoursAgo(1));
    const theirs = await insertPlayer(`${GAMERTAG}Other`, hoursAgo(1));
    await link(USER_ID, GAMERTAG, "verified");
    await insertSession({ serverId: chern.id, playerId: mine, connectedAt: hoursAgo(10) });
    // Newer, but not ours — a query missing the player predicate would return sakhal.
    await insertSession({ serverId: sakh.id, playerId: theirs, connectedAt: hoursAgo(1) });
    expect(await getLastPlayedMapSlug(db, USER_ID)).toBe(chern.slug);
  });
});
