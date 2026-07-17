import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, articles } from "@onelife/db";
import { eq } from "drizzle-orm";
import { getPublishedObituaries, getObituaryBySlug } from "../src/obituary-articles.js";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 52e7;
const t0 = new Date("2026-07-12T00:00:00Z");
const hrs = (h: number) => new Date(t0.getTime() + h * 3600_000);
let serverId: number;

// The articles table no longer FKs to players/lives, so seed articles directly against a server;
// distinct lifeStartedAt keeps the natural key (kind, serverId, gamertag, lifeStartedAt) unique.
const base = (over: Partial<typeof articles.$inferInsert>): typeof articles.$inferInsert =>
  ({
    kind: "obituary", serverId, gamertag: `oa-${svc}`, map: "chernarusplus", mapSlug: `oa-${svc}`, lifeNumber: 1, ...over,
  }) as typeof articles.$inferInsert;

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "ob", map: "chernarusplus", slug: `oa-${svc}`, active: true }).returning();
  serverId = s!.id;
  await db.insert(articles).values([
    base({ status: "published", slug: `early-${svc}`, lifeStartedAt: hrs(1), deathAt: hrs(2), timeAliveSeconds: 3600, kills: 1, longestKillMeters: 12, cause: "pvp", headline: "Early Death", lede: "e-lede", body: "e-body", tags: ["Obituaries", "Chernarus"], pullQuoteText: "q1", pullQuoteAttribution: "a coast source", facts: { sessions: 2, killerGamertag: "K1", weapon: "AK" }, generatedAt: hrs(2) }),
    base({ status: "published", slug: `late-${svc}`, lifeStartedAt: hrs(4), deathAt: hrs(5), timeAliveSeconds: 3600, kills: 4, longestKillMeters: 300, cause: "pvp", headline: "Late Death", lede: "l-lede", body: "l-body", tags: ["Obituaries"], facts: { sessions: 1, killerGamertag: null, weapon: null }, generatedAt: hrs(5) }),
    base({ status: "failed", slug: null, lifeStartedAt: hrs(8), deathAt: hrs(9), attempts: 3, lastError: "boom" }),
  ]);
});
afterAll(async () => {
  await db.delete(articles).where(eq(articles.serverId, serverId));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

describe("getPublishedObituaries", () => {
  it("returns published obituaries newest death first, excluding failed stubs", async () => {
    const res = await getPublishedObituaries(db, { page: 1, pageSize: 50 });
    const mine = res.rows.filter((r) => r.gamertag === `oa-${svc}`);
    expect(mine.map((r) => r.headline)).toEqual(["Late Death", "Early Death"]);
    expect(mine.every((r) => typeof r.slug === "string")).toBe(true);
  });
  it("paginates", async () => {
    const res = await getPublishedObituaries(db, { page: 1, pageSize: 1 });
    expect(res.pageSize).toBe(1);
    expect(res.rows).toHaveLength(1);
    expect(res.total).toBeGreaterThanOrEqual(2);
  });
});

describe("getObituaryBySlug", () => {
  it("returns the full article (body, pull quote, killer/weapon/sessions from facts)", async () => {
    const feed = await getPublishedObituaries(db, { page: 1, pageSize: 50 });
    const slug = feed.rows.find((r) => r.headline === "Early Death")!.slug;
    const a = await getObituaryBySlug(db, slug);
    expect(a).not.toBeNull();
    expect(a!.body).toBe("e-body");
    expect(a!.pullQuote).toEqual({ text: "q1", attribution: "a coast source" });
    expect(a!.sessions).toBe(2);
    expect(a!.killerGamertag).toBe("K1");
    expect(a!.weapon).toBe("AK");
  });
  it("returns null for an unknown or failed slug", async () => {
    expect(await getObituaryBySlug(db, "no-such-slug")).toBeNull();
  });
});
