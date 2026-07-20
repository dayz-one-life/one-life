import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, articles } from "@onelife/db";
import { eq } from "drizzle-orm";
import { getPublishedBirthNotices, getBirthNoticeBySlug } from "../src/birth-notice-articles.js";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 52e7;
const t0 = new Date("2026-07-12T00:00:00Z");
const hrs = (h: number) => new Date(t0.getTime() + h * 3600_000);
let serverId: number;

const knownPriors = {
  livesLived: 4, longestLifeSeconds: 12000, totalKills: 7,
  usualDeathCause: "pvp", lastDeathCause: "starvation", bestLifeMap: "sakhal",
};
const noPriors = {
  livesLived: 0, longestLifeSeconds: 0, totalKills: 0,
  usualDeathCause: null, lastDeathCause: null, bestLifeMap: null,
};

const base = (over: Partial<typeof articles.$inferInsert>): typeof articles.$inferInsert =>
  ({
    kind: "birth_notice", serverId, gamertag: `bn-${svc}`, map: "chernarusplus", mapSlug: `bn-${svc}`, lifeNumber: 1, ...over,
  }) as typeof articles.$inferInsert;

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "bn", map: "chernarusplus", slug: `bn-${svc}`, active: true }).returning();
  serverId = s!.id;
  await db.insert(articles).values([
    // freshest spawn — alive (death_at null), known quantity
    base({ status: "published", slug: `fresh-${svc}`, gamertag: `bn-a-${svc}`, lifeNumber: 5, lifeStartedAt: hrs(6), deathAt: null,
      headline: "Fresh Fool", lede: "f-lede", body: "f-body", tags: ["Fresh Spawns", "Chernarus", "Repeat Offender"],
      pullQuoteText: "again?", pullQuoteAttribution: "a weary coast", bodyBlocks: [{ type: "list", items: ["A rag", "A can", "No plan"] }],
      facts: { minutesToQualify: 8, priors: knownPriors, isKnownQuantity: true }, generatedAt: hrs(6),
      imageUrl: "/media/heroes/x.png", imageCaption: "LAST KNOWN PHOTO" }),
    // older spawn — died before the sweep (death_at set), first-lifer
    base({ status: "published", slug: `stale-${svc}`, gamertag: `bn-b-${svc}`, lifeNumber: 1, lifeStartedAt: hrs(2), deathAt: hrs(3),
      headline: "Stranger Ashore", lede: "s-lede", body: "s-body", tags: ["Fresh Spawns", "Chernarus", "First Life"],
      facts: { minutesToQualify: null, priors: noPriors, isKnownQuantity: false }, generatedAt: hrs(3) }),
    // failed stub — excluded
    base({ status: "failed", slug: null, gamertag: `bn-c-${svc}`, lifeNumber: 9, lifeStartedAt: hrs(9), deathAt: null, attempts: 3, lastError: "boom" }),
  ]);
});
afterAll(async () => {
  await db.delete(articles).where(eq(articles.serverId, serverId));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

describe("getPublishedBirthNotices", () => {
  it("returns published birth notices freshest spawn first, excluding failed stubs", async () => {
    const res = await getPublishedBirthNotices(db, { page: 1, pageSize: 50 });
    const ours = res.rows.filter((r) => r.slug === `fresh-${svc}` || r.slug === `stale-${svc}`);
    expect(ours.map((r) => r.headline)).toEqual(["Fresh Fool", "Stranger Ashore"]);
    expect(ours.every((r) => typeof r.slug === "string")).toBe(true);
    // the failed stub (slug null) is never returned
    expect(res.rows.some((r) => r.gamertag === `bn-c-${svc}`)).toBe(false);
  });
  it("surfaces minutesToQualify + priorLives from the facts snapshot", async () => {
    const res = await getPublishedBirthNotices(db, { page: 1, pageSize: 50 });
    const fresh = res.rows.find((r) => r.slug === `fresh-${svc}`)!;
    expect(fresh.minutesToQualify).toBe(8);
    expect(fresh.priorLives).toBe(4);
    expect(fresh.bornAt.getTime()).toBe(hrs(6).getTime());
    const stale = res.rows.find((r) => r.slug === `stale-${svc}`)!;
    expect(stale.minutesToQualify).toBeNull();
    expect(stale.priorLives).toBe(0);
  });
  it("paginates", async () => {
    const res = await getPublishedBirthNotices(db, { page: 1, pageSize: 1 });
    expect(res.pageSize).toBe(1);
    expect(res.rows).toHaveLength(1);
    expect(res.total).toBeGreaterThanOrEqual(2);
  });
});

describe("getBirthNoticeBySlug", () => {
  it("hydrates body, pull quote, priors, and a null endedAt while alive", async () => {
    const a = await getBirthNoticeBySlug(db, `fresh-${svc}`);
    expect(a).not.toBeNull();
    expect(a!.body).toBe("f-body");
    expect(a!.pullQuote).toEqual({ text: "again?", attribution: "a weary coast" });
    expect(a!.priors.livesLived).toBe(4);
    expect(a!.priors.bestLifeMap).toBe("sakhal");
    expect(a!.minutesToQualify).toBe(8);
    expect(a!.endedAt).toBeNull();
  });
  it("returns a non-null endedAt + empty priors when the spawn has since died as a first-lifer", async () => {
    const a = await getBirthNoticeBySlug(db, `stale-${svc}`);
    expect(a!.endedAt).not.toBeNull();
    expect(a!.priors.livesLived).toBe(0);
    expect(a!.priors.usualDeathCause).toBeNull();
    expect(a!.pullQuote).toBeNull();
  });
  it("returns null for an unknown or failed slug", async () => {
    expect(await getBirthNoticeBySlug(db, "no-such-slug")).toBeNull();
  });
  it("returns bodyBlocks when the row stores them", async () => {
    const a = await getBirthNoticeBySlug(db, `fresh-${svc}`);
    expect(a!.bodyBlocks).toEqual([{ type: "list", items: ["A rag", "A can", "No plan"] }]);
  });
  it("returns null bodyBlocks for a pre-R5d row", async () => {
    const a = await getBirthNoticeBySlug(db, `stale-${svc}`);
    expect(a!.bodyBlocks).toBeNull();
  });
});

// The guard's whole job is to fail loudly on a corrupt row rather than render an article about
// nobody — exercised here through the real read-model call (not a bare unit call on the guard
// function), since the point is that corruption can't reach a page. Rows use the same shared
// serverId as the rest of this file's fixtures, so the file's existing afterAll cleans them up too.
describe("assertSubjectful guard", () => {
  it("rejects a published birth notice with a null gamertag (corrupt row)", async () => {
    const slug = `corrupt-gamertag-${svc}`;
    await db.insert(articles).values(
      base({ status: "published", slug, gamertag: null, lifeStartedAt: hrs(20), headline: "Corrupt", lede: "corrupt-lede", body: "corrupt-body" }),
    );
    await expect(getBirthNoticeBySlug(db, slug)).rejects.toThrow(/has a null gamertag/);
  });

  it("rejects a published birth notice with a null map — the OTHER subject column the guard now covers (corrupt row)", async () => {
    const slug = `corrupt-map-${svc}`;
    await db.insert(articles).values(
      base({ status: "published", slug, map: null, lifeStartedAt: hrs(22), headline: "Corrupt", lede: "corrupt-lede", body: "corrupt-body" }),
    );
    await expect(getBirthNoticeBySlug(db, slug)).rejects.toThrow(/has a null map/);
  });

  it("rejects a published birth notice with a null lifeStartedAt — selected as bornAt, an aliased column name (corrupt row)", async () => {
    const slug = `corrupt-bornat-${svc}`;
    await db.insert(articles).values(
      base({ status: "published", slug, lifeStartedAt: null, headline: "Corrupt", lede: "corrupt-lede", body: "corrupt-body" }),
    );
    await expect(getBirthNoticeBySlug(db, slug)).rejects.toThrow(/has a null bornAt/);
  });
});
