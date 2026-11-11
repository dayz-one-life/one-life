import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { user, servers, players, lives, sessions, gamertagLinks, kills } from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { lifeQualifiedGenerator } from "../src/generators/lives.js";

/**
 * Death-verdict spec 2.4: a trap fires while the player who set it is offline. Their open life of
 * 180 s, last seen at three minutes, is qualified by a trap kill 19 hours later, and "This life
 * counts now" must go out for it. ⚠️ Invented user, player and server.
 */
const { db, sql } = getTestDb();
const START = new Date("2026-08-01T10:00:00Z");
const LAST_SEEN = new Date(START.getTime() + 180_000);
const KILL_AT = new Date(START.getTime() + 19 * 3600_000);
const NOW = new Date(START.getTime() + 20 * 3600_000);
let sid: number, lid: number;

beforeAll(async () => {
  await db.insert(user).values({ id: "op-placer", name: "OP", email: "op-placer@x.com" });
  const [s] = await db.insert(servers).values({ nitradoServiceId: 992101, name: "opsrv", slug: "opsrv" }).returning();
  sid = s!.id;
  const [p] = await db.insert(players).values({ gamertag: "Placer Ten", dayzId: "A".repeat(40), lastSeenAt: LAST_SEEN }).returning();
  await db.insert(gamertagLinks).values({ userId: "op-placer", gamertag: "Placer Ten", status: "verified", verifiedAt: START });
  const [l] = await db.insert(lives).values({ serverId: sid, playerId: p!.id, lifeNumber: 1, startedAt: START, playtimeSeconds: 180 }).returning();
  lid = Number(l!.id);
  await db.insert(sessions).values({ serverId: sid, playerId: p!.id, lifeId: lid, connectedAt: START, disconnectedAt: LAST_SEEN, durationSeconds: 180 });
  await db.insert(kills).values({
    serverId: sid, killerGamertag: "Placer Ten", killerPlayerId: p!.id, victimGamertag: "Victim Eleven", victimLifeId: 880000 + lid,
    weapon: "Tripwire", occurredAt: KILL_AT, basis: "trap_placement", creditSource: "classifier",
  });
});
afterAll(async () => {
  await db.delete(kills).where(eq(kills.serverId, sid));
  await sql.end();
});

describe("lifeQualifiedGenerator and an offline placer", () => {
  it("a trap kill 19 hours after the last heartbeat qualifies the open life", async () => {
    const drafts = await lifeQualifiedGenerator({ db, now: NOW, since: new Date("2026-07-01T00:00:00Z"), lookbackHours: 48, siteUrl: "https://s" });
    expect(drafts.filter((d) => d.userId === "op-placer").map((d) => d.naturalKey)).toEqual([`life_qualified:${lid}`]);
  });
});
