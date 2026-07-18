import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, articles } from "@onelife/db";
import { eq, and, desc } from "drizzle-orm";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 52e7;
const startedAt = new Date("2026-07-10T00:00:00Z");
const bornEarly = new Date("2026-07-11T00:00:00Z");
const bornLate = new Date("2026-07-11T06:00:00Z");
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
    const [row] = await db.select().from(articles).where(and(eq(articles.serverId, serverId), eq(articles.kind, "obituary")));
    expect(row!.tags).toEqual(["Obituaries", "Chernarus"]);
    expect((row!.facts as { sessions: number }).sessions).toBe(2);
    expect(row!.deathAt).not.toBeNull(); // obituary rows keep a non-null death_at
    expect(row!.imageUrl).toBeNull(); // reserved R5c column present + nullable
  });
});

describe("articles birth notices (nullable death_at + born feed order)", () => {
  const priors = {
    livesLived: 3, longestLifeSeconds: 12000, totalKills: 5,
    usualDeathCause: "pvp", lastDeathCause: "starvation", bestLifeMap: "sakhal",
  };
  beforeAll(async () => {
    await db.insert(articles).values([
      // died before the sweep → death_at set
      { kind: "birth_notice", status: "published", slug: `bn-early-${svc}`, serverId, gamertag: `bn-${svc}`,
        map: "chernarusplus", mapSlug: `ar-${svc}`, lifeNumber: 1, lifeStartedAt: bornEarly,
        deathAt: new Date("2026-07-11T02:00:00Z"), headline: "Born Early", lede: "e-lede", body: "e-body",
        tags: ["Fresh Spawns", "Chernarus", "Repeat Offender"],
        facts: { minutesToQualify: 12, priors, isKnownQuantity: true }, generatedAt: bornEarly },
      // still alive → death_at NULL (the new nullability under test)
      { kind: "birth_notice", status: "published", slug: `bn-late-${svc}`, serverId, gamertag: `bn2-${svc}`,
        map: "chernarusplus", mapSlug: `ar-${svc}`, lifeNumber: 1, lifeStartedAt: bornLate,
        deathAt: null, headline: "Born Late", lede: "l-lede", body: "l-body",
        tags: ["Fresh Spawns", "Chernarus", "First Life"],
        facts: { minutesToQualify: 5, priors: { livesLived: 0, longestLifeSeconds: 0, totalKills: 0, usualDeathCause: null, lastDeathCause: null, bestLifeMap: null }, isKnownQuantity: false },
        generatedAt: bornLate },
    ]);
  });

  it("round-trips a birth_notice with a NULL death_at and its facts jsonb", async () => {
    const [row] = await db.select().from(articles).where(and(eq(articles.serverId, serverId), eq(articles.slug, `bn-late-${svc}`)));
    expect(row!.deathAt).toBeNull();
    expect((row!.facts as { minutesToQualify: number }).minutesToQualify).toBe(5);
    expect((row!.facts as { isKnownQuantity: boolean }).isKnownQuantity).toBe(false);
  });

  it("feeds birth notices newest spawn first (life_started_at desc)", async () => {
    const rows = await db
      .select({ slug: articles.slug, lifeStartedAt: articles.lifeStartedAt })
      .from(articles)
      .where(and(eq(articles.serverId, serverId), eq(articles.kind, "birth_notice")))
      .orderBy(desc(articles.lifeStartedAt));
    expect(rows.map((r) => r.slug)).toEqual([`bn-late-${svc}`, `bn-early-${svc}`]);
  });
});
