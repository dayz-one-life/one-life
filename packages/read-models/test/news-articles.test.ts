import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, articles } from "@onelife/db";
import { eq } from "drizzle-orm";
import { getPublishedNews } from "../src/news-articles.js";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 53e7;
const t0 = new Date("2026-07-12T00:00:00Z");
const hrs = (h: number) => new Date(t0.getTime() + h * 3600_000);
let serverId: number;

const tag = `na-${svc}`;

// `articles` no longer FKs to players/lives, so news rows can be seeded directly against a
// server. News dedupes on natural_key (partial-unique WHERE NOT NULL), NOT on the life tuple,
// so every seeded row needs a distinct natural_key.
const base = (over: Partial<typeof articles.$inferInsert>): typeof articles.$inferInsert =>
  ({
    kind: "news", serverId, gamertag: tag, map: "chernarusplus", mapSlug: `na-${svc}`,
    lifeNumber: 1, lifeStartedAt: hrs(0), headline: "H", lede: "L", body: "B",
    promptVersion: "news-v1", model: "test", attempts: 1, ...over,
  }) as typeof articles.$inferInsert;

beforeAll(async () => {
  const [s] = await db.insert(servers).values({
    nitradoServiceId: svc, name: "na", map: "chernarusplus", slug: `na-${svc}`, active: true,
  }).returning();
  serverId = s!.id;

  await db.insert(articles).values([
    base({
      status: "published", slug: `sd-old-${svc}`, naturalKey: `standing_dead:${serverId}:${tag}:${hrs(0).toISOString()}`,
      headline: "The Man Who Did Not Come Back", lede: "sd-lede", tags: ["News", "Chernarus", "The Standing Dead"],
      createdAt: hrs(1), facts: { trigger: "standing_dead", subjectCount: 1 },
    }),
    base({
      status: "published", slug: `lf-new-${svc}`, naturalKey: `long_form:${serverId}:${hrs(3).toISOString()}:Ay+Zed`,
      headline: "Two Went Out Together", lede: "lf-lede", tags: ["News", "Chernarus", "The Long Form"],
      createdAt: hrs(4), deathAt: hrs(3), facts: { trigger: "long_form", subjectCount: 2 },
    }),
    base({
      status: "retracted", slug: `sd-retracted-${svc}`, naturalKey: `standing_dead:${serverId}:${tag}:${hrs(6).toISOString()}`,
      headline: "He Came Back", lede: "r-lede", createdAt: hrs(7), facts: { trigger: "standing_dead", subjectCount: 1 },
    }),
    base({
      status: "failed", slug: null, naturalKey: `standing_dead:${serverId}:${tag}:${hrs(9).toISOString()}`,
      headline: null, lede: null, body: null, attempts: 3, lastError: "boom", createdAt: hrs(9),
    }),
    base({
      status: "published", slug: `sd-nosubj-${svc}`, naturalKey: `standing_dead:${serverId}:${tag}:${hrs(-1).toISOString()}`,
      headline: "No Subject Count Recorded", lede: "nosubj-lede", tags: ["News", "Chernarus", "The Standing Dead"],
      createdAt: hrs(-1), facts: { trigger: "standing_dead" },
    }),
  ]);
});

afterAll(async () => {
  await db.delete(articles).where(eq(articles.serverId, serverId));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

const mine = <T extends { gamertag: string }>(rows: T[]) => rows.filter((r) => r.gamertag === tag);

describe("getPublishedNews", () => {
  it("returns published news newest-CREATED first — not by death_at, which a Standing Dead row lacks", async () => {
    const res = await getPublishedNews(db, { page: 1, pageSize: 100 });
    expect(mine(res.rows).map((r) => r.headline)).toEqual([
      "Two Went Out Together",
      "The Man Who Did Not Come Back",
      "No Subject Count Recorded",
    ]);
  });

  it("excludes retracted and failed rows from the feed", async () => {
    const res = await getPublishedNews(db, { page: 1, pageSize: 100 });
    const heads = mine(res.rows).map((r) => r.headline);
    expect(heads).not.toContain("He Came Back");
    expect(mine(res.rows).every((r) => typeof r.slug === "string")).toBe(true);
  });

  it("derives the trigger from the natural_key prefix", async () => {
    const res = await getPublishedNews(db, { page: 1, pageSize: 100 });
    const byHead = new Map(mine(res.rows).map((r) => [r.headline, r]));
    expect(byHead.get("The Man Who Did Not Come Back")!.trigger).toBe("standing_dead");
    expect(byHead.get("Two Went Out Together")!.trigger).toBe("long_form");
  });

  it("reads subjectCount from facts, defaulting to 1 when facts omits it", async () => {
    const res = await getPublishedNews(db, { page: 1, pageSize: 100 });
    const byHead = new Map(mine(res.rows).map((r) => [r.headline, r]));
    expect(byHead.get("Two Went Out Together")!.subjectCount).toBe(2);
    expect(byHead.get("The Man Who Did Not Come Back")!.subjectCount).toBe(1);
    expect(byHead.get("No Subject Count Recorded")!.subjectCount).toBe(1);
  });

  it("paginates", async () => {
    const res = await getPublishedNews(db, { page: 1, pageSize: 1 });
    expect(res.pageSize).toBe(1);
    expect(res.rows).toHaveLength(1);
    expect(res.total).toBeGreaterThanOrEqual(2);
  });

  it("defaults pageSize to NEWS_FEED_PAGE_SIZE and clamps a junk page to 1", async () => {
    const res = await getPublishedNews(db, { page: -4 });
    expect(res.page).toBe(1);
    expect(res.pageSize).toBe(20);
  });
});
