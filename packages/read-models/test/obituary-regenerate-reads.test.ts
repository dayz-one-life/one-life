import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { servers, players, lives, deathVerdicts, deathVerdictQueue, playerGamertags, articles, articleRevisions } from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { CLASSIFIER_VERSION, type StoredVerdict } from "@onelife/death-verdict";
import {
  articleKey, getArticleLives, getInferredFamilies, inferredFamilyOfStored, verdictSweepBacklog, sweepCaughtUp, writerDeathOf,
} from "../src/death-verdicts.js";
import { correctedAtOf, getObituaryBySlug } from "../src/obituary-articles.js";
import { seedVerdict } from "./support/verdicts.js";

/**
 * The reads behind the newsdesk's `regenerate` (death-verdict plan step 9).
 * ⚠️ Invented players, lives and verdicts only.
 */
const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 56e7;
const T0 = new Date("2031-05-01T10:00:00Z");
const at = (m: number) => new Date(T0.getTime() + m * 60_000);
let sid: number, pid: number;
const lifeIds: number[] = [];

async function life(n: number, o: Partial<typeof lives.$inferInsert> = {}) {
  const [l] = await db.insert(lives).values({
    serverId: sid, playerId: pid, lifeNumber: n, startedAt: at(n * 100), endedAt: at(n * 100 + 50), playtimeSeconds: 3000, deathCause: "died", ...o,
  }).returning();
  lifeIds.push(Number(l!.id));
  return { ...l!, id: Number(l!.id) };
}

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "rr", map: "chernarusplus", slug: `rr-${svc}` }).returning();
  sid = s!.id;
  const [p] = await db.insert(players).values({ gamertag: `Current Name ${svc}` }).returning();
  pid = Number(p!.id);
  await db.insert(playerGamertags).values([
    { playerId: pid, gamertag: `Old Name ${svc}`, firstSeenAt: T0, lastSeenAt: T0 },
    { playerId: pid, gamertag: `Current Name ${svc}`, firstSeenAt: T0, lastSeenAt: T0 },
  ]);
});
afterAll(async () => {
  const ids = (await db.select({ id: articles.id }).from(articles).where(eq(articles.serverId, sid))).map((r) => Number(r.id));
  if (ids.length) await db.delete(articleRevisions).where(inArray(articleRevisions.articleId, ids));
  await db.delete(articles).where(eq(articles.serverId, sid));
  await db.delete(deathVerdicts).where(inArray(deathVerdicts.lifeId, lifeIds));
  await db.delete(lives).where(eq(lives.serverId, sid));
  await db.delete(playerGamertags).where(eq(playerGamertags.playerId, pid));
  await db.delete(players).where(eq(players.id, pid));
  await db.delete(servers).where(eq(servers.id, sid));
  await sql.end();
});

const base: StoredVerdict = {
  cause: "starvation", confidence: "inferred", mechanismStated: false, objectKey: null, upstream: null, attrBasis: null,
  ownerlessFirearm: false, conditions: [],
};
const deadLife = { deathCause: "died", deathByGamertag: null, deathWeapon: null, deathDistance: null };

describe("inferredFamilyOfStored", () => {
  it("is the family of an inferred verdict, whatever the switches say, and null otherwise", () => {
    expect(inferredFamilyOfStored(base)).toBe("hunger_thirst");
    expect(inferredFamilyOfStored({ ...base, cause: "cold_exposure" })).toBe("exposure");
    expect(inferredFamilyOfStored({ ...base, confidence: "definitive" })).toBeNull();
    expect(inferredFamilyOfStored({ ...base, cause: "fall" })).toBeNull(); // a row with no family
    expect(inferredFamilyOfStored({ ...base, cause: "pvp", ownerlessFirearm: true, mechanismStated: true })).toBeNull(); // "Shot"
    expect(inferredFamilyOfStored({ ...base, cause: "pvp" })).toBe("pvp");
    expect(inferredFamilyOfStored({ ...base, cause: "not-a-cause" as never })).toBeNull();
  });

  it("of a logout-family death is its inferred upstream's", () => {
    const ko = { ...base, cause: "unconscious_logout" as const, confidence: "definitive" as const };
    expect(inferredFamilyOfStored({ ...ko, upstream: { cause: "infected", confidence: "inferred" } })).toBe("infected");
    expect(inferredFamilyOfStored({ ...ko, upstream: { cause: "infected", confidence: "definitive" } })).toBeNull();
    expect(inferredFamilyOfStored({ ...ko, upstream: null })).toBeNull();
  });
});

describe("writerDeathOf with withdrawFamily", () => {
  it("gives the writer a withdrawn family's death as not recorded, with no cause line", () => {
    const on = writerDeathOf(base, deadLife, null, CLASSIFIER_VERSION);
    expect(on.death).toMatchObject({ key: "starvation", certainty: "inferred" });
    expect(on.brief.line).toMatch(/most likely/);
    const off = writerDeathOf(base, deadLife, null, CLASSIFIER_VERSION, { withdrawFamily: "hunger_thirst" });
    expect(off.death).toMatchObject({ key: "unknown", tag: "Unknown", certainty: "unknown", cause: "unknown" });
    expect(off.brief).toEqual({ line: null, creditLine: null, directives: [] });
  });

  it("leaves a verdict of another family, or a stated one, alone", () => {
    expect(writerDeathOf(base, deadLife, null, 2, { withdrawFamily: "exposure" }).death.key).toBe("starvation");
    const stated = { ...base, confidence: "definitive" as const };
    expect(writerDeathOf(stated, deadLife, null, 2, { withdrawFamily: "hunger_thirst" }).death).toMatchObject({ key: "starvation", certainty: "definitive" });
  });

  it("withdraws a logout-family death whose upstream is inferred in that family", () => {
    const ko: StoredVerdict = { ...base, cause: "unconscious_logout", confidence: "definitive", upstream: { cause: "infected", confidence: "inferred" } };
    expect(writerDeathOf(ko, deadLife, null, 2).death.certainty).toBe("inferred");
    expect(writerDeathOf(ko, deadLife, null, 2, { withdrawFamily: "infected" }).death.key).toBe("unknown");
  });
});

describe("getArticleLives and getInferredFamilies", () => {
  it("finds an article's life under a former name, with the player's current name", async () => {
    const l = await life(1);
    const key = { serverId: sid, gamertag: `old name ${svc}`, lifeStartedAt: l.startedAt };
    const found = await getArticleLives(db, [key, { ...key, gamertag: `Nobody ${svc}` }]);
    expect(found.size).toBe(1);
    expect(found.get(articleKey(key))).toMatchObject({ id: l.id, playerId: pid, currentGamertag: `Current Name ${svc}`, lifeNumber: 1 });
  });

  it("reads the inferred family of each stored row, held-for-review rows included", async () => {
    const a = await life(2);
    const b = await life(3);
    const c = await life(4);
    await seedVerdict(db, { lifeId: a.id, cause: "cold_exposure", confidence: "inferred", needsReview: true });
    await seedVerdict(db, { lifeId: b.id, cause: "cold_exposure", confidence: "definitive" });
    const m = await getInferredFamilies(db, [a.id, b.id, c.id]);
    expect([...m.entries()]).toEqual([[a.id, "exposure"]]);
  });
});

describe("verdictSweepBacklog", () => {
  it("counts the queue, the lives without a current verdict, and a fold that is behind", async () => {
    const before = await verdictSweepBacklog(db);
    const l = await life(5);
    let now = await verdictSweepBacklog(db);
    expect(now.unswept).toBe(before.unswept + 1);
    await seedVerdict(db, { lifeId: l.id, cause: "fall", confidence: "definitive", classifierVersion: CLASSIFIER_VERSION - 1 });
    expect((await verdictSweepBacklog(db)).unswept).toBe(before.unswept + 1); // an older version is not current
    await db.update(deathVerdicts).set({ classifierVersion: CLASSIFIER_VERSION }).where(eq(deathVerdicts.lifeId, l.id));
    expect((await verdictSweepBacklog(db)).unswept).toBe(before.unswept);
    await db.insert(deathVerdictQueue).values({ lifeId: l.id });
    now = await verdictSweepBacklog(db);
    expect(now.queued).toBe(before.queued + 1);
    expect(sweepCaughtUp(now)).toBe(false);
    await db.delete(deathVerdictQueue).where(eq(deathVerdictQueue.lifeId, l.id));
  });

  it("is caught up only when all three are clear", () => {
    expect(sweepCaughtUp({ queued: 0, unswept: 0, foldBehind: false })).toBe(true);
    expect(sweepCaughtUp({ queued: 0, unswept: 0, foldBehind: true })).toBe(false);
    expect(sweepCaughtUp({ queued: 0, unswept: 1, foldBehind: false })).toBe(false);
  });
});

describe("correctedAt", () => {
  const t = new Date("2031-06-01T00:00:00Z");
  it("follows the newest revision only", () => {
    expect(correctedAtOf(null)).toBeNull();
    expect(correctedAtOf({ reason: "cause-corrected", replacedAt: t, snapshot: {} })).toEqual(t);
    expect(correctedAtOf({ reason: "kills-corrected", replacedAt: t, snapshot: {} })).toBeNull();
    expect(correctedAtOf({ reason: "retracted", replacedAt: t, snapshot: {} })).toBeNull();
    expect(correctedAtOf({ reason: "restored", replacedAt: t, snapshot: { restoredCorrectedAt: null } })).toBeNull();
    expect(correctedAtOf({ reason: "restored", replacedAt: t, snapshot: { restoredCorrectedAt: "2031-05-01T00:00:00.000Z" } }))
      .toEqual(new Date("2031-05-01T00:00:00.000Z"));
    expect(correctedAtOf({ reason: "restored", replacedAt: t, snapshot: { restoredCorrectedAt: "garbage" } })).toBeNull();
  });

  it("is on the article read: the latest cause-corrected revision's time, null without one", async () => {
    const slug = `rr-art-${svc}`;
    const [a] = await db.insert(articles).values({
      kind: "obituary", status: "published", slug, serverId: sid, gamertag: `Current Name ${svc}`, map: "chernarusplus",
      lifeNumber: 9, lifeStartedAt: at(9000), deathAt: at(9050), headline: "H", lede: "L", body: "B", tags: [],
    }).returning();
    expect((await getObituaryBySlug(db, slug))!.correctedAt).toBeNull();
    await db.insert(articleRevisions).values({ articleId: a!.id, replacedAt: t, reason: "cause-corrected", snapshot: { headline: "old" } });
    expect((await getObituaryBySlug(db, slug))!.correctedAt).toEqual(t);
  });
});
