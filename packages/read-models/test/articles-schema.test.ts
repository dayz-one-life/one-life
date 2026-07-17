import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, articles } from "@onelife/db";
import { eq } from "drizzle-orm";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 52e7;
const startedAt = new Date("2026-07-10T00:00:00Z");
let serverId: number;

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "ar", map: "chernarusplus", slug: `ar-${svc}`, active: true }).returning();
  serverId = s!.id;
});
afterAll(async () => {
  await db.delete(articles).where(eq(articles.serverId, serverId));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

describe("articles table", () => {
  it("stores a published obituary keyed on the natural life tuple, with tags + facts jsonb", async () => {
    await db.insert(articles).values({
      kind: "obituary", status: "published", slug: `the-end-${svc}`,
      serverId, gamertag: `ar-${svc}`, map: "chernarusplus", mapSlug: `ar-${svc}`,
      lifeNumber: 1, lifeStartedAt: startedAt, deathAt: new Date("2026-07-10T02:00:00Z"),
      timeAliveSeconds: 7200, kills: 3, longestKillMeters: 210.5, cause: "pvp",
      headline: "H", lede: "L", body: "B", pullQuoteText: "q", pullQuoteAttribution: "a rival",
      tags: ["Obituaries", "Chernarus"], facts: { sessions: 2, killerGamertag: "Killer", weapon: "M4" },
      promptVersion: "obituary-v1", model: "test", attempts: 1, generatedAt: new Date("2026-07-10T03:00:00Z"),
    });
    const [row] = await db.select().from(articles).where(eq(articles.serverId, serverId));
    expect(row!.tags).toEqual(["Obituaries", "Chernarus"]);
    expect((row!.facts as { sessions: number }).sessions).toBe(2);
    expect(row!.imageUrl).toBeNull(); // reserved R5c column present + nullable
  });
});
