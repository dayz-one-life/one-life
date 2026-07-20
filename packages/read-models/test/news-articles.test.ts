import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, articles, players, lives, sessions, positions } from "@onelife/db";
import { eq } from "drizzle-orm";
import { getPublishedNews, getNewsArticleBySlug, newsFormatOf } from "../src/news-articles.js";

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

/** Recursively collects every object key at any depth, including inside arrays. Proves the Fog
 *  Rule by SHAPE rather than by pattern-matching a coordinate-looking number — the same walk
 *  apps/newsdesk/test/news-facts.test.ts uses. */
function collectKeys(value: unknown, keys: Set<string> = new Set()): Set<string> {
  if (value instanceof Date) return keys;
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
  } else if (value !== null && typeof value === "object") {
    for (const [key, val] of Object.entries(value)) {
      keys.add(key);
      collectKeys(val, keys);
    }
  }
  return keys;
}

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

  it("never resolves an obituary through the news route", async () => {
    await db.insert(articles).values(base({
      kind: "obituary", status: "published", slug: `not-news-${svc}`,
      lifeStartedAt: hrs(40), deathAt: hrs(41), headline: "Not News", lede: "x", naturalKey: null,
    }));
    expect(await getNewsArticleBySlug(db, `not-news-${svc}`)).toBeNull();
  });
});

describe("getNewsSubjectStatus (the §4.1.3 live status line)", () => {
  // Three real subjects on real projections: one still gone, one who came back, one who died.
  // Their lives carry REAL `positions` rows — the §11 rail is only meaningful over source data
  // that actually contains coordinates.
  const IDLE = `sub-idle-${svc}`;
  const BACK = `sub-back-${svc}`;
  const DEAD = `sub-dead-${svc}`;
  const born = hrs(50);
  const published = hrs(60);

  const seedSubject = async (gamertag: string, opts: { endedAt: Date | null; lastConnectAt: Date }) => {
    const [p] = await db.insert(players).values({ gamertag }).returning();
    const [l] = await db.insert(lives).values({
      serverId, playerId: p!.id, lifeNumber: 1, startedAt: born,
      endedAt: opts.endedAt, playtimeSeconds: 5600,
    }).returning();
    await db.insert(sessions).values({
      serverId, playerId: p!.id, lifeId: l!.id,
      connectedAt: opts.lastConnectAt, disconnectedAt: null,
    });
    // Coordinates DO exist for this subject. Nothing the read-model returns may carry them.
    // `positions` is (serverId, playerId, gamertag, x, y, recordedAt) — there is no z column.
    await db.insert(positions).values({
      serverId, playerId: p!.id, gamertag, recordedAt: opts.lastConnectAt, x: 7423.51, y: 812.4,
    });
    await db.insert(articles).values(base({
      status: "published", slug: `status-${gamertag}`,
      naturalKey: `standing_dead:${serverId}:${gamertag}:${born.toISOString()}`,
      // `new Date(born.toISOString())`, NOT `born`. In production this value travels
      // Date → toISOString() → new Date() through IDENTITY in apps/newsdesk/src/news-pg-store.ts,
      // i.e. truncated to millisecond precision, while lives.started_at is timestamptz
      // (microsecond). getNewsSubjectStatus joins on exact equality, so inserting the SAME Date
      // object into both tables would make the join hold trivially and the fixture could never
      // detect a precision mismatch — which would not throw, it would fall into the "missing life
      // row" branch and silently pin every Standing Dead interior to `idle` forever.
      gamertag, lifeStartedAt: new Date(born.toISOString()),
      headline: `Status ${gamertag}`, lede: "s-lede",
      body: "B", createdAt: published, timeAliveSeconds: 5600, kills: 0,
      facts: {
        trigger: "standing_dead", subjectCount: 1, idleSeconds: 259200,
        subjects: [{ gamertag, mapSlug: `na-${svc}`, lifeNumber: 1 }],
      },
    }));
    return l!.id;
  };

  beforeAll(async () => {
    // Idle: last connect BEFORE publication, life still open.
    await seedSubject(IDLE, { endedAt: null, lastConnectAt: hrs(52) });
    // Returned: a session that CONNECTED after publication, life still open.
    await seedSubject(BACK, { endedAt: null, lastConnectAt: hrs(70) });
    // Died: the life closed after publication.
    await seedSubject(DEAD, { endedAt: hrs(75), lastConnectAt: hrs(72) });
    // …and the morgue desk filed for them.
    await db.insert(articles).values(base({
      kind: "obituary", status: "published", slug: `obit-for-${DEAD}`, naturalKey: null,
      gamertag: DEAD, lifeStartedAt: born, deathAt: hrs(75),
      headline: "He Did Not Outlast The Correction", lede: "o-lede", body: "B", createdAt: hrs(76),
    }));
  });

  afterAll(async () => {
    for (const g of [IDLE, BACK, DEAD]) {
      await db.delete(sessions).where(eq(sessions.serverId, serverId));
      await db.delete(positions).where(eq(positions.serverId, serverId));
      await db.delete(lives).where(eq(lives.serverId, serverId));
      await db.delete(players).where(eq(players.gamertag, g));
    }
  });

  it("still idle → the frozen idle figure, in whole days, as of publication", async () => {
    const a = await getNewsArticleBySlug(db, `status-${IDLE}`);
    expect(a!.subjectStatus).toEqual({ kind: "idle", idleDaysAtPublication: 3 });
  });

  it("returned → the connect instant of the session that falsified the piece", async () => {
    const a = await getNewsArticleBySlug(db, `status-${BACK}`);
    expect(a!.subjectStatus).toMatchObject({ kind: "returned" });
    expect((a!.subjectStatus as { seenAt: Date }).seenAt.toISOString()).toBe(hrs(70).toISOString());
  });

  it("died since → the death instant and the obituary slug, death outranking the return", async () => {
    const a = await getNewsArticleBySlug(db, `status-${DEAD}`);
    expect(a!.subjectStatus).toEqual({
      kind: "died", diedAt: hrs(75), obituarySlug: `obit-for-${DEAD}`,
    });
  });

  it("a Long Form article never carries a status line", async () => {
    const lf = await getNewsArticleBySlug(db, `detail-lf-${svc}`);
    expect(lf!.subjectStatus).toBeNull();
  });

  it("falls back to idle when no life row matches — a rebuild must not break the page", async () => {
    const orphan = await getNewsArticleBySlug(db, `detail-${svc}`);
    expect(orphan!.subjectStatus).toEqual({ kind: "idle", idleDaysAtPublication: 3 });
  });

  // ── THE §11 FOG RAIL, SOURCE HALF ──
  // Every subject above has real `positions` rows carrying 7423.51 / 812.4. Note 812.4:
  // it is a legitimate near-edge coordinate that does NOT match /\d{4}\.\d/, which is why the key
  // walk is the primary assertion and the regex is only a secondary signal.
  it("returns no coordinate key and no coordinate-shaped value, over fixtures that HAVE coordinates", async () => {
    const detail = await getNewsArticleBySlug(db, `status-${IDLE}`);
    const feed = await getPublishedNews(db, { page: 1, pageSize: 100 });
    for (const out of [detail, feed]) {
      const keys = collectKeys(out);
      // The SAME eight keys as COORDINATE_KEYS in apps/newsdesk/test/news-facts.test.ts and in the
      // three files Task 1 repairs. One canonical set across the repo — there is no `z` column in
      // `positions`, and a divergent list would confuse the next person porting the helper.
      for (const forbidden of ["x", "y", "posX", "posY", "coordX", "coordY", "lat", "lon"]) {
        expect(keys.has(forbidden)).toBe(false);
      }
      expect(JSON.stringify(out)).not.toContain("7423.51");
      expect(JSON.stringify(out)).not.toContain("812.4");
      expect(JSON.stringify(out)).not.toMatch(/\d{4}\.\d/);   // secondary signal only
    }
  });
});

describe("newsFormatOf", () => {
  // The shipped classifier was binary: standing_dead, else long_form. Its "unreachable" fallback
  // becomes reachable the day an almanac: row publishes — and would render a census as a Long
  // Form, complete with a dossier and two timelines it has no subjects for.
  it("routes editorial prefixes away from the trigger formats", () => {
    expect(newsFormatOf("almanac:week:2026-W29")).toBe("editorial");
    expect(newsFormatOf("ledger:transfer:166e8e87-61df-4193-bc84-bd6c2f7c3846")).toBe("editorial");
    expect(newsFormatOf("editorial:one-off-thing")).toBe("editorial");
  });

  it("keeps both shipped triggers exactly as they were", () => {
    expect(newsFormatOf("standing_dead:2:Boots:2026-07-11T16:55:26.000Z")).toBe("standing_dead");
    expect(newsFormatOf("long_form:1:2026-07-13T18:48:58.000Z:A+B")).toBe("long_form");
  });

  // The shipped fallback must not change: a null or unrecognised key still reads long_form, which
  // turns the Standing-Dead-only status line OFF rather than on for a subject with no idle figure.
  it("leaves the unrecognised-key fallback alone", () => {
    expect(newsFormatOf(null)).toBe("long_form");
    expect(newsFormatOf("something_else:1")).toBe("long_form");
  });
});
