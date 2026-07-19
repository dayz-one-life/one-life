import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, articles } from "@onelife/db";
import { eq } from "drizzle-orm";
import { getPublishedNews, getNewsArticleBySlug } from "../src/news-articles.js";

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

describe("getNewsArticleBySlug", () => {
  beforeAll(async () => {
    await db.insert(articles).values([
      base({
        status: "published", slug: `detail-${svc}`,
        naturalKey: `standing_dead:${serverId}:${tag}:${hrs(20).toISOString()}`,
        headline: "Still Standing, Somewhere", lede: "d-lede", body: "Para one.\n\nPara two.",
        // NEWS IS THE FIRST KIND TO POPULATE body_blocks. Every live interior before this took
        // the flat fallback, so this row is the first exercise of ArticleBody's blocks path.
        bodyBlocks: [
          { type: "para", text: "Para one." },
          { type: "subhead", text: "The Long Middle" },
          { type: "para", text: "Para two." },
        ],
        pullQuoteText: "He was here on Tuesday.", pullQuoteAttribution: "a quartermaster",
        tags: ["News", "Chernarus", "The Standing Dead"],
        timeAliveSeconds: 5600, kills: 0, createdAt: hrs(21),
        imageUrl: "/media/heroes/detail.png", imageCaption: "A ROOM, RECENTLY LEFT",
        facts: {
          trigger: "standing_dead", subjectCount: 1, idleSeconds: 259200, spanSeconds: null,
          subjects: [{ gamertag: tag, mapSlug: `na-${svc}`, lifeNumber: 1 }],
        },
      }),
      base({
        status: "published", slug: `detail-lf-${svc}`,
        naturalKey: `long_form:${serverId}:${hrs(24).toISOString()}:Ay+Zed`,
        headline: "They Went Out Inside A Minute", lede: "lf-d-lede", body: "Flat only.",
        tags: ["News"], timeAliveSeconds: 6660, kills: 1, createdAt: hrs(25), deathAt: hrs(24),
        facts: {
          trigger: "long_form", subjectCount: 2, idleSeconds: null, spanSeconds: 27,
          subjects: [
            { gamertag: "Ay", mapSlug: `na-${svc}`, lifeNumber: 1 },
            { gamertag: "Zed", mapSlug: null, lifeNumber: 3 },
          ],
        },
      }),
      base({
        status: "retracted", slug: `detail-retracted-${svc}`,
        naturalKey: `standing_dead:${serverId}:${tag}:${hrs(30).toISOString()}`,
        headline: "He Came Back After All", lede: "r-d-lede", body: "B", createdAt: hrs(31),
        imageUrl: "/media/heroes/detail-retracted.png", imageCaption: "SHOULD NOT SHIP",
        facts: { trigger: "standing_dead", subjectCount: 1 },
      }),
    ]);
  });

  it("returns the full article with the rich body blocks", async () => {
    const a = await getNewsArticleBySlug(db, `detail-${svc}`);
    expect(a).not.toBeNull();
    expect(a!.headline).toBe("Still Standing, Somewhere");
    expect(a!.body).toBe("Para one.\n\nPara two.");
    expect(a!.bodyBlocks).toEqual([
      { type: "para", text: "Para one." },
      { type: "subhead", text: "The Long Middle" },
      { type: "para", text: "Para two." },
    ]);
    expect(a!.pullQuote).toEqual({ text: "He was here on Tuesday.", attribution: "a quartermaster" });
    expect(a!.imageUrl).toBe("/media/heroes/detail.png");
    expect(a!.imageCaption).toBe("A ROOM, RECENTLY LEFT");
    expect(a!.retracted).toBe(false);
  });

  it("returns null bodyBlocks when the column is unset", async () => {
    const a = await getNewsArticleBySlug(db, `detail-lf-${svc}`);
    expect(a!.bodyBlocks).toBeNull();
    expect(a!.body).toBe("Flat only.");
  });

  it("carries the factual dossier figures, with the trigger-specific ones nulled out", async () => {
    const sd = await getNewsArticleBySlug(db, `detail-${svc}`);
    expect(sd!.timeAliveSeconds).toBe(5600);
    expect(sd!.kills).toBe(0);
    expect(sd!.idleSeconds).toBe(259200);
    expect(sd!.spanSeconds).toBeNull();

    const lf = await getNewsArticleBySlug(db, `detail-lf-${svc}`);
    expect(lf!.idleSeconds).toBeNull();
    expect(lf!.spanSeconds).toBe(27);
  });

  it("returns the co-subject refs for a Long Form piece, preserving a null mapSlug", async () => {
    const lf = await getNewsArticleBySlug(db, `detail-lf-${svc}`);
    expect(lf!.subjects).toEqual([
      { gamertag: "Ay", mapSlug: `na-${svc}`, lifeNumber: 1 },
      { gamertag: "Zed", mapSlug: null, lifeNumber: 3 },
    ]);
  });

  it("falls back to a single self-subject when facts carry no subjects array", async () => {
    const r = await getNewsArticleBySlug(db, `detail-retracted-${svc}`);
    expect(r!.subjects).toEqual([{ gamertag: tag, mapSlug: `na-${svc}`, lifeNumber: 1 }]);
  });

  it("RESOLVES a retracted article and flags it, so the interior can noindex rather than 404", async () => {
    const r = await getNewsArticleBySlug(db, `detail-retracted-${svc}`);
    expect(r).not.toBeNull();
    expect(r!.retracted).toBe(true);
  });

  // Named for what it actually asserts. A `failed` stub carries `slug: null`, so it is unreachable
  // by a by-slug lookup and cannot be pinned here; its exclusion is covered feed-side by Task 3's
  // `expect(mine(res.rows).every((r) => typeof r.slug === "string")).toBe(true)`.
  it("returns null for an unknown slug", async () => {
    expect(await getNewsArticleBySlug(db, "no-such-news-slug")).toBeNull();
  });

  it("never resolves an obituary or a birth notice through the news route", async () => {
    await db.insert(articles).values(base({
      kind: "obituary", status: "published", slug: `not-news-${svc}`,
      lifeStartedAt: hrs(40), deathAt: hrs(41), headline: "Not News", lede: "x", naturalKey: null,
    }));
    expect(await getNewsArticleBySlug(db, `not-news-${svc}`)).toBeNull();
  });
});
