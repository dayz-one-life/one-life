import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, articles } from "@onelife/db";
import { eq } from "drizzle-orm";
import type { PlayerPriors } from "@onelife/read-models";
import { newsSlug, publishNews, recordNewsFailure } from "../src/news-pg-store.js";
import type { NewsFacts, NewsSubject } from "../src/news-facts.js";
import type { NewsArticle } from "../src/news-prompt.js";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 55e7;
let serverId: number;
const NOW = new Date("2026-07-19T00:00:00Z");

const priors: PlayerPriors = {
  livesLived: 0, longestLifeSeconds: 0, totalKills: 0,
  usualDeathCause: null, lastDeathCause: null, bestLifeMap: null,
};

const subject = (over: Partial<NewsSubject> = {}): NewsSubject => ({
  gamertag: `np-gabe-${svc}`, map: "chernarusplus", mapSlug: "chernarus", lifeNumber: 3,
  lifeStartedAt: "2026-07-11T00:00:00.000Z", endedAt: null,
  timeAliveSeconds: 5600, timeAliveLabel: "1h 33m", kills: 2, sessions: 4,
  persona: "Lewis", deathCause: null, priors, isKnownQuantity: false, isFresh: false, ...over,
});

const facts = (over: Partial<NewsFacts> = {}): NewsFacts => ({
  trigger: "standing_dead", map: "chernarusplus", mapSlug: "chernarus",
  idleHours: 96, timeAliveSeconds: 5600, hitsAbsorbed: 137, lifeNumber: 3,
  priors, subjectCount: 1, allFreshSubjects: false,
  naturalKey: `standing_dead:${serverId}:np-gabe-${svc}:2026-07-11T00:00:00.000Z`,
  serverId, primaryGamertag: `np-gabe-${svc}`, subjects: [subject()],
  lastSeenAt: "2026-07-14T00:00:00.000Z", eligibleAt: "2026-07-17T00:00:00.000Z",
  idleSeconds: 345_600, earliestDeathAt: null, spanSeconds: null, ...over,
});

const article = (over: Partial<NewsArticle> = {}): NewsArticle => ({
  headline: "Nobody Has Seen Him Since Tuesday",
  lede: "The record simply stops.",
  blocks: [
    { type: "para", text: "First paragraph." },
    { type: "subhead", text: "The Turn" },
    { type: "para", text: "Second paragraph." },
  ],
  body: "First paragraph.\n\nSecond paragraph.",
  pullQuote: { text: "He is still standing somewhere.", attribution: "an unnamed witness" },
  tags: ["News", "Chernarus", "The Standing Dead"],
  ...over,
});

const rowFor = async (key: string) =>
  (await db.select().from(articles).where(eq(articles.naturalKey, key)))[0];

beforeAll(async () => {
  const [s] = await db.insert(servers).values({
    nitradoServiceId: svc, name: "np", map: "chernarusplus", slug: `np-${svc}`, active: true,
  }).returning();
  serverId = s!.id;
});
afterAll(async () => {
  await db.delete(articles).where(eq(articles.serverId, serverId));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

describe("newsSlug", () => {
  it("prefixes the trigger so a news slug can never collide with an obituary's", () => {
    expect(newsSlug("standing_dead", "Nobody Has Seen Him", "GabeFox101", 7, 3))
      .toBe("standing-dead-nobody-has-seen-him-gabefox101-7-3");
    expect(newsSlug("long_form", "Within The Same Minute", "CUPID18", 7, 1))
      .toBe("long-form-within-the-same-minute-cupid18-7-1");
  });

  it("matches [a-z0-9-]+ so the media route serves its hero image unchanged", () => {
    expect(newsSlug("standing_dead", "Ünïcødé!! & Symbols??", "Cee Lo GREEN 96", 12, 2))
      .toMatch(/^[a-z0-9-]+$/);
  });

  it("falls back rather than emit an empty segment", () => {
    expect(newsSlug("long_form", "!!!", "???", 1, 1)).toBe("long-form-news-survivor-1-1");
  });
});

describe("publishNews", () => {
  it("writes a kind='news' row keyed on natural_key, with derived body and body_blocks", async () => {
    const f = facts();
    await publishNews(db, { facts: f, article: article(), promptVersion: "news-v1", model: "test", now: NOW });
    const row = await rowFor(f.naturalKey);
    expect(row!.kind).toBe("news");
    expect(row!.status).toBe("published");
    expect(row!.naturalKey).toBe(f.naturalKey);
    expect(row!.body).toBe("First paragraph.\n\nSecond paragraph.");
    expect(row!.bodyBlocks).toHaveLength(3);
    expect(row!.slug).toMatch(/^standing-dead-nobody-has-seen-him-since-tuesday-/);
    expect(row!.attempts).toBe(1);
    expect(row!.tags).toContain("The Standing Dead");
    expect(row!.deathAt).toBeNull();          // a Standing Dead subject has not died
    expect(row!.promptVersion).toBe("news-v1");
  });

  it("freezes the whole facts object into jsonb", async () => {
    const row = await rowFor(facts().naturalKey);
    const stored = row!.facts as Record<string, unknown>;
    expect(stored.trigger).toBe("standing_dead");
    expect(stored.hitsAbsorbed).toBe(137);
    expect(Array.isArray(stored.subjects)).toBe(true);
  });

  it("is idempotent on the natural key — a second publish UPDATES and bumps attempts", async () => {
    const f = facts();
    await publishNews(db, {
      facts: f, article: article({ headline: "A Revised Headline" }),
      promptVersion: "news-v1", model: "test", now: NOW,
    });
    const rows = await db.select().from(articles).where(eq(articles.naturalKey, f.naturalKey));
    expect(rows).toHaveLength(1);                          // NOT a second row
    expect(rows[0]!.attempts).toBe(2);
    expect(rows[0]!.headline).toBe("A Revised Headline");
  });

  it("sets death_at from the primary for a Long Form cluster", async () => {
    const key = `long_form:${serverId}:2026-07-11T01:00:00.000Z:np-a-${svc}+np-b-${svc}`;
    const f = facts({
      trigger: "long_form", naturalKey: key, primaryGamertag: `np-a-${svc}`,
      subjectCount: 2, earliestDeathAt: "2026-07-11T01:00:00.000Z", spanSeconds: 27,
      idleHours: null, idleSeconds: null, lastSeenAt: null, eligibleAt: null, hitsAbsorbed: 0,
      subjects: [
        subject({ gamertag: `np-a-${svc}`, lifeNumber: 1, endedAt: "2026-07-11T01:00:00.000Z", deathCause: "infected" }),
        subject({ gamertag: `np-b-${svc}`, lifeNumber: 1, endedAt: "2026-07-11T01:00:27.000Z", deathCause: "died" }),
      ],
    });
    await publishNews(db, { facts: f, article: article(), promptVersion: "news-v1", model: "test", now: NOW });
    const row = await rowFor(key);
    expect(row!.deathAt?.toISOString()).toBe("2026-07-11T01:00:00.000Z");
    expect(row!.gamertag).toBe(`np-a-${svc}`);
    expect(row!.cause).toBe("infected");
    expect(row!.slug).toMatch(/^long-form-/);
  });

  it("throws rather than publish a facts object whose primary is not among its subjects", async () => {
    await expect(publishNews(db, {
      facts: facts({ primaryGamertag: "nobody-at-all", naturalKey: `standing_dead:${serverId}:nobody:x` }),
      article: article(), promptVersion: "news-v1", model: "test", now: NOW,
    })).rejects.toThrow(/nobody-at-all/);
  });
});

describe("recordNewsFailure", () => {
  it("writes a stub CARRYING the natural key, so the retry updates instead of inserting", async () => {
    const key = `standing_dead:${serverId}:np-fail-${svc}:2026-07-11T00:00:00.000Z`;
    const f = facts({ naturalKey: key, primaryGamertag: `np-fail-${svc}`,
      subjects: [subject({ gamertag: `np-fail-${svc}` })] });
    await recordNewsFailure(db, { facts: f, error: "api boom" });
    const first = await rowFor(key);
    expect(first!.status).toBe("failed");
    expect(first!.naturalKey).toBe(key);      // NOT null — the whole point
    expect(first!.attempts).toBe(1);

    await recordNewsFailure(db, { facts: f, error: "api boom again" });
    const rows = await db.select().from(articles).where(eq(articles.naturalKey, key));
    expect(rows).toHaveLength(1);             // spec §12.4: one row, not two
    expect(rows[0]!.attempts).toBe(2);
    expect(rows[0]!.lastError).toBe("api boom again");
  });

  it("a later success publishes over the stub on the same row and clears the error", async () => {
    const key = `standing_dead:${serverId}:np-recover-${svc}:2026-07-11T00:00:00.000Z`;
    const f = facts({ naturalKey: key, primaryGamertag: `np-recover-${svc}`,
      subjects: [subject({ gamertag: `np-recover-${svc}` })] });
    await recordNewsFailure(db, { facts: f, error: "transient" });
    await publishNews(db, { facts: f, article: article(), promptVersion: "news-v1", model: "test", now: NOW });
    const rows = await db.select().from(articles).where(eq(articles.naturalKey, key));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("published");
    expect(rows[0]!.lastError).toBeNull();
    expect(rows[0]!.attempts).toBe(2);
  });
});
