import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { inArray, eq } from "drizzle-orm";
import { servers, players, lives, articles, deathVerdicts, playerGamertags } from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { PUBLIC_INFERRED, toPublicDeath, type StoredVerdict } from "@onelife/death-verdict";
import { getObituaryBySlug, getPublishedObituaries, articleTags, frozenDeathOf } from "../src/obituary-articles.js";
import { seedVerdict } from "./support/verdicts.js";

/**
 * The tag an article shows follows its prose (spec 6.2 item 1), and its death is live-final, else
 * frozen, else null. ⚠️ Invented players and articles only.
 */
const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 53e7;
const T0 = new Date("2031-04-01T10:00:00Z");
const at = (h: number) => new Date(T0.getTime() + h * 3600_000);
const NAME = `Tagged One ${svc}`;
let sid: number, pid: number;
const lifeIds: number[] = [];
const slugs: string[] = [];

async function obituary(n: number, o: { promptVersion: string; storedTag: string; verdict?: Parameters<typeof seedVerdict>[1] extends infer V ? Omit<V & object, "lifeId"> : never; facts?: unknown; deathCause?: string }) {
  const [l] = await db.insert(lives).values({
    serverId: sid, playerId: pid, lifeNumber: n, startedAt: at(n * 10), endedAt: at(n * 10 + 5), playtimeSeconds: 4000,
    deathCause: o.deathCause ?? "died",
  }).returning();
  const lid = Number(l!.id);
  lifeIds.push(lid);
  if (o.verdict) await seedVerdict(db, { ...o.verdict, lifeId: lid } as Parameters<typeof seedVerdict>[1]);
  const slug = `tag-${svc}-${n}`;
  slugs.push(slug);
  await db.insert(articles).values({
    kind: "obituary", status: "published", slug, serverId: sid, gamertag: NAME, map: "chernarusplus", mapSlug: `tg-${svc}`,
    lifeNumber: n, lifeStartedAt: l!.startedAt, deathAt: l!.endedAt, headline: `H${n}`, lede: `L${n}`, body: "B",
    tags: ["Obituaries", "Chernarus", o.storedTag, "Flavour"], cause: "unknown", promptVersion: o.promptVersion,
    facts: o.facts ?? { sessions: 1 },
  });
  return slug;
}

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "tg", map: "chernarusplus", slug: `tg-${svc}` }).returning();
  sid = s!.id;
  const [p] = await db.insert(players).values({ gamertag: NAME }).returning();
  pid = Number(p!.id);
  await db.insert(playerGamertags).values({ playerId: pid, gamertag: NAME, firstSeenAt: T0, lastSeenAt: T0 });
});
afterEach(() => { PUBLIC_INFERRED.hunger_thirst = true; PUBLIC_INFERRED.exposure = true; });
afterAll(async () => {
  await db.delete(articles).where(inArray(articles.slug, slugs));
  await db.delete(deathVerdicts).where(inArray(deathVerdicts.lifeId, lifeIds));
  await db.delete(lives).where(eq(lives.serverId, sid));
  await db.delete(playerGamertags).where(eq(playerGamertags.playerId, pid));
  await db.delete(players).where(eq(players.id, pid));
  await db.delete(servers).where(eq(servers.id, sid));
  await sql.end();
});

describe("the reserved cause tag (spec 6.2, the five rows)", () => {
  it("definitive or strong: the live family tag under any prompt version", async () => {
    const slug = await obituary(1, { promptVersion: "obituary-v3", storedTag: "Unknown", verdict: { cause: "fall", confidence: "definitive" } });
    const a = (await getObituaryBySlug(db, slug))!;
    expect(a.tags).toEqual(["Obituaries", "Chernarus", "Fall", "Flavour"]);
    expect(a.death).toMatchObject({ status: "final", label: "Fell" });
  });

  it("inferred, family on, a v4 article: the family tag", async () => {
    const slug = await obituary(2, { promptVersion: "obituary-v4", storedTag: "Unknown", verdict: { cause: "starvation", confidence: "inferred", mechanismStated: false } });
    expect((await getObituaryBySlug(db, slug))!.tags[2]).toBe("Hunger and Thirst");
  });

  it("a v3 article with an inferred verdict keeps \"Unknown\"", async () => {
    const slug = await obituary(3, { promptVersion: "obituary-v3.1", storedTag: "Environment", verdict: { cause: "starvation", confidence: "inferred", mechanismStated: false } });
    const a = (await getObituaryBySlug(db, slug))!;
    expect(a.tags[2]).toBe("Unknown");
    // the death itself is still the live reading: only the tag follows the prose
    expect(a.death).toMatchObject({ status: "final", label: "Likely starvation" });
  });

  it("switching the family off turns a v4 article's tag to \"Unknown\" in the API response", async () => {
    const slug = await obituary(4, { promptVersion: "obituary-v4", storedTag: "Hunger and Thirst", verdict: { cause: "dehydration", confidence: "inferred", mechanismStated: false } });
    expect((await getObituaryBySlug(db, slug))!.tags[2]).toBe("Hunger and Thirst");
    PUBLIC_INFERRED.hunger_thirst = false;
    const a = (await getObituaryBySlug(db, slug))!;
    expect(a.tags[2]).toBe("Unknown");
    expect(a.death).toMatchObject({ label: "Not recorded" });
    const feed = await getPublishedObituaries(db, { page: 1, pageSize: 200 });
    expect(feed.rows.find((r) => r.slug === slug)!.tags[2]).toBe("Unknown");
  });

  it("withheld or unknown: \"Unknown\"", async () => {
    const slug = await obituary(5, { promptVersion: "obituary-v4", storedTag: "Infected", verdict: { cause: "restrained_logout", confidence: "definitive" } });
    expect((await getObituaryBySlug(db, slug))!.tags[2]).toBe("Unknown");
  });

  it("pending or missing: the stored tag, and the frozen death when there is one", async () => {
    const frozen = { key: "fall", tag: "Fall", certainty: "definitive", label: "Fell", detail: null, sentence: "Fell to their death.", caption: null };
    const slug = await obituary(6, { promptVersion: "obituary-v4", storedTag: "Fall", facts: { death: frozen } });
    const a = (await getObituaryBySlug(db, slug))!;
    expect(a.tags).toEqual(["Obituaries", "Chernarus", "Fall", "Flavour"]);
    expect(a.death).toEqual({ status: "frozen", ...frozen });
    const held = await obituary(7, { promptVersion: "obituary-v4", storedTag: "Fall", facts: { death: frozen }, verdict: { cause: "drowned", confidence: "definitive", needsReview: true } });
    expect((await getObituaryBySlug(db, held))!.death).toMatchObject({ status: "frozen", label: "Fell" });
  });

  it("a switched-off family retracts a frozen inferred death too, in the article, the feed and while the verdict is held", async () => {
    const frozen = { key: "exposure", tag: "Exposure", certainty: "inferred", label: "Likely exposure", detail: null,
      sentence: "Likely died of exposure.", caption: "Best reading of the log. The server recorded no cause." };
    const held = await obituary(9, { promptVersion: "obituary-v4", storedTag: "Exposure", facts: { death: frozen },
      verdict: { cause: "cold_exposure", confidence: "inferred", mechanismStated: false, needsReview: true } });
    expect((await getObituaryBySlug(db, held))!.death).toMatchObject({ status: "frozen", label: "Likely exposure" });
    PUBLIC_INFERRED.exposure = false;
    const a = (await getObituaryBySlug(db, held))!;
    expect(a.death).toBeNull();
    const feed = await getPublishedObituaries(db, { page: 1, pageSize: 200 });
    expect(feed.rows.find((r) => r.slug === held)!.death).toBeNull();
  });

  it("a v3 article with nothing frozen and no verdict has no death: the reader uses its legacy fields", async () => {
    const slug = await obituary(8, { promptVersion: "obituary-v3", storedTag: "Unknown" });
    const a = (await getObituaryBySlug(db, slug))!;
    expect(a.death).toBeNull();
    expect(a.tags[2]).toBe("Unknown");
  });
});

describe("pure parts", () => {
  it("the live tag replaces a flavour tag that would duplicate it", () => {
    const live = { status: "final", certainty: "definitive", tag: "Fall" } as never;
    expect(articleTags(["Obituaries", "Sakhal", "Unknown", "fall"], live, "obituary-v3")).toEqual(["Obituaries", "Sakhal", "Fall"]);
  });
  it("tags newsdesk did not compose are left alone", () => {
    const live = { status: "final", certainty: "definitive", tag: "Fall" } as never;
    expect(articleTags(["Editorial"], live, null)).toEqual(["Editorial"]);
  });
  it("a frozen trap death never carries a name: its sentence and caption are the plain row", () => {
    const f = frozenDeathOf({ key: "tripwire", tag: "Trap", certainty: "definitive", label: "Tripwire", detail: "M67 frag grenade",
      sentence: "Killed by a tripwire rigged with an M67 frag grenade. Kill credited to Placer Person.", caption: "Placer Person placed the only tripwire." })!;
    expect(JSON.stringify(f)).not.toContain("Placer Person");
    expect(f).toMatchObject({ label: "Tripwire", detail: "M67 frag grenade", caption: null });
  });
  it("a frozen trap death's label and detail are rebuilt too: a name written into any field never comes back", () => {
    const f = frozenDeathOf({ key: "tripwire", tag: "Trap", certainty: "definitive", label: "Tripwire by Placer Person",
      detail: "set by Placer Person", sentence: "Killed by Placer Person's tripwire.", caption: "Placer Person set it." })!;
    expect(JSON.stringify(f)).not.toContain("Placer Person");
    expect(f).toMatchObject({ key: "tripwire", tag: "Trap", label: "Tripwire", detail: null, sentence: "Killed by a tripwire.", caption: null });
    const mine = frozenDeathOf({ key: "land_mine", tag: "Trap", certainty: "definitive", label: "Placer Person's mine",
      detail: "Placer Person", sentence: "Placer Person.", caption: null })!;
    expect(mine).toMatchObject({ label: "Land mine", detail: null, sentence: "Killed by a land mine.", caption: null });
  });
  it("a frozen trap death keeps what the live read would print without the credit: object, strong caption", () => {
    const v: StoredVerdict = { cause: "explosive_trap", confidence: "strong", mechanismStated: true, objectKey: "m67_grenade",
      upstream: null, attrBasis: null, ownerlessFirearm: false, conditions: [] };
    const life = { deathCause: "explosion", deathByGamertag: null, deathWeapon: null, deathDistance: null };
    const plain = toPublicDeath(v, life);
    const credited = toPublicDeath(v, life, { gamertag: "Placer Person", device: "tripwire", byOperator: false });
    // frozen while the credit stood
    const f = frozenDeathOf({ key: credited.key, tag: credited.tag, certainty: credited.certainty, label: credited.label,
      detail: credited.detail, sentence: credited.sentence, caption: credited.caption })!;
    expect(JSON.stringify(f)).not.toContain("Placer Person");
    expect(f).toEqual({ status: "frozen", key: plain.key, tag: plain.tag, certainty: plain.certainty, label: plain.label,
      detail: plain.detail, sentence: plain.sentence, caption: plain.caption });
    expect(f).toMatchObject({ sentence: "Killed by a tripwire rigged with an M67 frag grenade.", caption: "Worked out from the log" });
  });
  it("a frozen inferred death is shown only while its family is switched on", () => {
    const frozen = { key: "exposure", tag: "Exposure", certainty: "inferred", label: "Likely exposure", detail: null,
      sentence: "Likely died of exposure.", caption: "Best reading of the log. The server recorded no cause." };
    expect(frozenDeathOf(frozen)).toMatchObject({ label: "Likely exposure" });
    PUBLIC_INFERRED.exposure = false;
    expect(frozenDeathOf(frozen)).toBeNull();
    // a row with no family has no switch, so it is never shown inferred; nor is a key this release does not know
    expect(frozenDeathOf({ ...frozen, key: "fall", label: "Likely fell" })).toBeNull();
    expect(frozenDeathOf({ ...frozen, key: "toString" })).toBeNull();
    expect(frozenDeathOf({ ...frozen, key: "no_such_key" })).toBeNull();
  });
  it("malformed frozen values are no frozen value", () => {
    expect(frozenDeathOf({ key: 3 })).toBeNull();
    expect(frozenDeathOf("x")).toBeNull();
    expect(frozenDeathOf(null)).toBeNull();
  });
});
