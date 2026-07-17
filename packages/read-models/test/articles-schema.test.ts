import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, articles } from "@onelife/db";
import { eq } from "drizzle-orm";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 52e7;
let serverId: number, lifeId: number, playerId: number;

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "ar", map: "chernarusplus", slug: `ar-${svc}`, active: true }).returning();
  serverId = s!.id;
  const [p] = await db.insert(players).values({ gamertag: `ar-${svc}` }).returning();
  playerId = p!.id;
  const [l] = await db.insert(lives).values({ serverId, playerId, lifeNumber: 1, startedAt: new Date("2026-07-10T00:00:00Z"), endedAt: new Date("2026-07-10T02:00:00Z"), deathCause: "pvp", playtimeSeconds: 7200 }).returning();
  lifeId = l!.id;
});
afterAll(async () => {
  await db.delete(articles).where(eq(articles.serverId, serverId));
  await db.delete(lives).where(eq(lives.serverId, serverId));
  await db.delete(players).where(eq(players.id, playerId));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

describe("articles table", () => {
  it("stores a published obituary row with tags + facts jsonb and reads it back", async () => {
    await db.insert(articles).values({
      kind: "obituary", status: "published", slug: `the-end-${lifeId}`,
      playerId, serverId, lifeId, gamertag: `ar-${svc}`, map: "chernarusplus", mapSlug: `ar-${svc}`,
      lifeNumber: 1, deathAt: new Date("2026-07-10T02:00:00Z"), timeAliveSeconds: 7200, kills: 3,
      longestKillMeters: 210.5, cause: "pvp", headline: "H", lede: "L", body: "B",
      pullQuoteText: "q", pullQuoteAttribution: "a rival", tags: ["Obituaries", "Chernarus"],
      facts: { sessions: 2, killerGamertag: "Killer", weapon: "M4" }, promptVersion: "obituary-v1",
      model: "test", attempts: 1, generatedAt: new Date("2026-07-10T03:00:00Z"),
    });
    const [row] = await db.select().from(articles).where(eq(articles.lifeId, lifeId));
    expect(row!.tags).toEqual(["Obituaries", "Chernarus"]);
    expect((row!.facts as { sessions: number }).sessions).toBe(2);
    expect(row!.imageUrl).toBeNull(); // reserved R5c column present + nullable
  });
});
