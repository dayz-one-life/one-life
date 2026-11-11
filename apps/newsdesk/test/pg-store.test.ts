import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, articles, playerGamertags } from "@onelife/db";
import { eq, inArray } from "drizzle-orm";
import { CLASSIFIER_VERSION } from "@onelife/death-verdict";
import { overdueObituaryLives, findObituaryTargets, publishObituary, recordObituaryFailure, obituarySlug, type ObituaryTarget } from "../src/pg-store.js";
import { seedVerdict } from "./verdict.js";
import { storedFacts } from "../src/facts.js";
import { factsFor } from "./facts-fixture.js";
import { INTERNAL_CAUSES, type Confidence } from "@onelife/death-verdict";

const { db, sql } = getTestDb();
const PVP_LEGACY = { cause: "pvp", confidence: "high" as const, conditions: [] };
const svc = Math.floor(Math.random() * 1e8) + 52e7;
const t0 = new Date("2026-07-13T00:00:00Z");
const hrs = (h: number) => new Date(t0.getTime() + h * 3600_000);
let serverId: number;
const pids: number[] = [];
const lifeIds: number[] = [];

async function seedLife(tag: string, over: Record<string, unknown>, verdict = true) {
  const [p] = await db.insert(players).values({ gamertag: tag }).returning();
  pids.push(p!.id);
  // Mirrors the projector fold, which writes a player_gamertags row for every seen name — the
  // anti-join's alias-history match relies on this existing, same as production.
  await db.insert(playerGamertags).values({ playerId: p!.id, gamertag: tag, firstSeenAt: hrs(0), lastSeenAt: hrs(0) });
  const [l] = await db.insert(lives).values({ serverId, playerId: p!.id, lifeNumber: 1, startedAt: hrs(0), ...over }).returning();
  lifeIds.push(l!.id);
  if (verdict && l!.endedAt) await seedVerdict(db, l!.id);
  return { lifeId: l!.id, playerId: p!.id, gamertag: tag, lifeStartedAt: hrs(0) };
}

let qualified: { lifeId: number; playerId: number; gamertag: string; lifeStartedAt: Date };
let unqualified: { lifeId: number; playerId: number; gamertag: string; lifeStartedAt: Date };

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "nd", map: "chernarusplus", slug: `nd-${svc}`, active: true }).returning();
  serverId = s!.id;
  // qualified: pvp death, 2h alive
  qualified = await seedLife(`nd-q-${svc}`, { lifeNumber: 1, endedAt: hrs(2), deathCause: "pvp", deathByGamertag: "Killer", deathWeapon: "M4", deathDistance: 90, playtimeSeconds: 7200 });
  // NOT qualified: 60s environment death, no kills
  unqualified = await seedLife(`nd-u-${svc}`, { lifeNumber: 1, endedAt: hrs(3), deathCause: "environment", playtimeSeconds: 60 });
});
afterAll(async () => {
  await db.delete(articles).where(eq(articles.serverId, serverId));
  await db.delete(lives).where(inArray(lives.id, lifeIds));
  await db.delete(players).where(inArray(players.id, pids));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

const targetFor = (o: { lifeId: number; gamertag: string; lifeStartedAt: Date }, endH: number): ObituaryTarget => ({
  lifeId: o.lifeId, serverId, gamertag: o.gamertag,
  map: "chernarusplus", mapSlug: `nd-${svc}`, lifeNumber: 1, lifeStartedAt: o.lifeStartedAt, endedAt: hrs(endH),
});

describe("obituarySlug", () => {
  it("composes a stable unique slug from headline + gamertag + server + life number", () => {
    expect(obituarySlug("The King Is Dead. A Chicken.", "xX_Sn1per_Xx", 7, 4)).toBe("the-king-is-dead-a-chicken-xx-sn1per-xx-7-4");
  });
});

describe("findObituaryTargets", () => {
  it("returns qualified ungenerated deaths, excludes unqualified", async () => {
    const targets = await findObituaryTargets(db, { limit: 50, maxAttempts: 3, since: new Date("2020-01-01T00:00:00Z") });
    const mine = targets.filter((t) => t.mapSlug === `nd-${svc}`);
    expect(mine.map((t) => t.gamertag)).toContain(qualified.gamertag);
    expect(mine.map((t) => t.gamertag)).not.toContain(unqualified.gamertag);
  });

  it("excludes a life that already has a published obituary", async () => {
    await publishObituary(db, {
      target: targetFor(qualified, 2),
      facts: { sessions: 1, killerGamertag: "Killer", weapon: "M4", timeAliveSeconds: 7200, kills: 0, longestKillMeters: null, cause: "pvp", verdict: PVP_LEGACY },
      obituary: { headline: "Gone", lede: "l", body: "b", pullQuote: null, tags: ["Obituaries"] },
      promptVersion: "obituary-v1", model: "test", now: hrs(4), verdictVersion: CLASSIFIER_VERSION,
    });
    const targets = await findObituaryTargets(db, { limit: 50, maxAttempts: 3, since: new Date("2020-01-01T00:00:00Z") });
    expect(targets.find((t) => t.lifeId === qualified.lifeId)).toBeUndefined();
    const [row] = await db.select().from(articles).where(eq(articles.gamertag, qualified.gamertag));
    expect(row!.status).toBe("published");
    expect(row!.slug).toMatch(/^gone-nd-q-/);
    expect(row!.slug!.endsWith(`-${serverId}-1`)).toBe(true);
    expect(row!.attempts).toBe(1);
  });

  it("REGRESSION: a gamertag rename does not reopen a dead life's dedupe", async () => {
    // A fresh qualified dead life, published under its original name.
    const renamed = await seedLife(`nd-old-${svc}`, { lifeNumber: 1, endedAt: hrs(6), deathCause: "pvp", playtimeSeconds: 7200 });
    await publishObituary(db, {
      target: targetFor(renamed, 6),
      facts: { sessions: 1, killerGamertag: "Killer", weapon: "M4", timeAliveSeconds: 7200, kills: 0, longestKillMeters: null, cause: "pvp", verdict: PVP_LEGACY },
      obituary: { headline: "Renamed Later", lede: "l", body: "b", pullQuote: null, tags: ["Obituaries"] },
      promptVersion: "obituary-v1", model: "test", now: hrs(7), verdictVersion: CLASSIFIER_VERSION,
    });

    // Simulate a rename: players.gamertag moves to the new name, and player_gamertags gains a
    // row for the new name alongside the surviving row for the old one (mirrors the projector
    // fold — it never deletes an old alias row).
    const newTag = `nd-new-${svc}`;
    await db.update(players).set({ gamertag: newTag }).where(eq(players.id, renamed.playerId));
    await db.insert(playerGamertags).values({ playerId: renamed.playerId, gamertag: newTag, firstSeenAt: hrs(7), lastSeenAt: hrs(7) });

    const targets = await findObituaryTargets(db, { limit: 50, maxAttempts: 3, since: new Date("2020-01-01T00:00:00Z") });
    expect(targets.find((t) => t.lifeId === renamed.lifeId)).toBeUndefined();
  });

  it("re-includes a failed life until maxAttempts, then drops it", async () => {
    const un = targetFor(unqualified, 3); // reuse row as a generic life; force qualification via a fresh qualified life
    const q2 = await seedLife(`nd-q2-${svc}`, { lifeNumber: 1, endedAt: hrs(5), deathCause: "pvp", playtimeSeconds: 7200 });
    await recordObituaryFailure(db, { target: targetFor(q2, 5), error: "boom-1" });
    let targets = await findObituaryTargets(db, { limit: 50, maxAttempts: 3, since: new Date("2020-01-01T00:00:00Z") });
    expect(targets.find((t) => t.lifeId === q2.lifeId)).toBeDefined(); // attempts 1 < 3
    await recordObituaryFailure(db, { target: targetFor(q2, 5), error: "boom-2" });
    await recordObituaryFailure(db, { target: targetFor(q2, 5), error: "boom-3" });
    targets = await findObituaryTargets(db, { limit: 50, maxAttempts: 3, since: new Date("2020-01-01T00:00:00Z") });
    expect(targets.find((t) => t.lifeId === q2.lifeId)).toBeUndefined(); // attempts 3 >= 3
    void un;
  });
});

describe("findObituaryTargets: the death-verdict gate", () => {
  const all = () => findObituaryTargets(db, { limit: 500, maxAttempts: 3, since: new Date("2020-01-01T00:00:00Z") });

  it("a life with no verdict row is not a target", async () => {
    const q = await seedLife(`nd-nv-${svc}`, { lifeNumber: 1, endedAt: hrs(8), deathCause: "pvp", playtimeSeconds: 7200 }, false);
    expect((await all()).find((t) => t.lifeId === q.lifeId)).toBeUndefined();
  });

  it("it becomes a target when the row appears", async () => {
    const q = await seedLife(`nd-late-${svc}`, { lifeNumber: 1, endedAt: hrs(9), deathCause: "pvp", playtimeSeconds: 7200 }, false);
    expect((await all()).find((t) => t.lifeId === q.lifeId)).toBeUndefined();
    await seedVerdict(db, q.lifeId);
    expect((await all()).find((t) => t.lifeId === q.lifeId)).toBeDefined();
  });

  it("a row at an older version or flagged needs_review does not count", async () => {
    const old = await seedLife(`nd-old-v-${svc}`, { lifeNumber: 1, endedAt: hrs(10), deathCause: "pvp", playtimeSeconds: 7200 }, false);
    await seedVerdict(db, old.lifeId, { classifierVersion: CLASSIFIER_VERSION - 1 });
    const review = await seedLife(`nd-rev-${svc}`, { lifeNumber: 1, endedAt: hrs(11), deathCause: "pvp", playtimeSeconds: 7200 }, false);
    await seedVerdict(db, review.lifeId, { needsReview: true });
    const targets = await all();
    expect(targets.find((t) => t.lifeId === old.lifeId)).toBeUndefined();
    expect(targets.find((t) => t.lifeId === review.lifeId)).toBeUndefined();
  });
});

describe("overdueObituaryLives: the overdue alarm (review of step 6)", () => {
  // Only this file's lives: the ids seeded in this describe.
  const mine: number[] = [];
  const overdue = async (now: Date) => (await overdueObituaryLives(db, {
    since: new Date("2020-01-01T00:00:00Z"), now, maxAttempts: 3,
  })).filter((l) => mine.includes(l));

  it("counts a qualified death waiting over 45 minutes for a reviewable verdict, and nothing else", async () => {
    const none = await seedLife(`nd-od-none-${svc}`, { lifeNumber: 1, endedAt: hrs(20), deathCause: "pvp", playtimeSeconds: 7200 }, false);
    const review = await seedLife(`nd-od-rev-${svc}`, { lifeNumber: 1, endedAt: hrs(20), deathCause: "pvp", playtimeSeconds: 7200 }, false);
    await seedVerdict(db, review.lifeId, { needsReview: true });
    const old = await seedLife(`nd-od-old-${svc}`, { lifeNumber: 1, endedAt: hrs(20), deathCause: "pvp", playtimeSeconds: 7200 }, false);
    await seedVerdict(db, old.lifeId, { classifierVersion: CLASSIFIER_VERSION - 1 });
    const fine = await seedLife(`nd-od-ok-${svc}`, { lifeNumber: 1, endedAt: hrs(20), deathCause: "pvp", playtimeSeconds: 7200 });
    const short = await seedLife(`nd-od-short-${svc}`, { lifeNumber: 1, endedAt: hrs(20), deathCause: "environment", playtimeSeconds: 60 }, false);
    mine.push(none.lifeId, review.lifeId, old.lifeId, fine.lifeId, short.lifeId);
    // 44 minutes after the deaths: not yet overdue
    expect(await overdue(new Date(hrs(20).getTime() + 44 * 60_000))).toEqual([]);
    const late = await overdue(new Date(hrs(20).getTime() + 46 * 60_000));
    expect(late.sort()).toEqual([none.lifeId, review.lifeId, old.lifeId].sort());
  });
});


describe("publishObituary (obituary-v4)", () => {
  const publish = (t: ObituaryTarget, headline: string, over: Partial<Parameters<typeof publishObituary>[1]> = {}) => publishObituary(db, {
    target: t,
    facts: { sessions: 1, killerGamertag: null, weapon: null, timeAliveSeconds: 7200, kills: 0, longestKillMeters: null, cause: "died", verdict: { cause: "starvation", confidence: "low", conditions: [] } },
    obituary: { headline, lede: "l", body: "b", pullQuote: null, tags: ["Obituaries"] },
    promptVersion: "obituary-v4", model: "test", now: hrs(30), verdictVersion: CLASSIFIER_VERSION, ...over,
  });

  it("a re-publish keeps the existing slug", async () => {
    const l = await seedLife(`nd-slug-${svc}`, { lifeNumber: 1, endedAt: hrs(29), deathCause: "died", playtimeSeconds: 7200 });
    await publish(targetFor(l, 29), "The First Headline");
    await publish(targetFor(l, 29), "A Rewritten Headline");
    const [row] = await db.select().from(articles).where(eq(articles.gamertag, l.gamertag));
    expect(row!.headline).toBe("A Rewritten Headline");
    expect(row!.slug).toMatch(/^the-first-headline-/);
  });

  it("a failed stub gets its slug on the first publish", async () => {
    const l = await seedLife(`nd-stub-${svc}`, { lifeNumber: 1, endedAt: hrs(29), deathCause: "died", playtimeSeconds: 7200 });
    await recordObituaryFailure(db, { target: targetFor(l, 29), error: "boom" });
    await publish(targetFor(l, 29), "After A Failure");
    const [row] = await db.select().from(articles).where(eq(articles.gamertag, l.gamertag));
    expect(row!.slug).toMatch(/^after-a-failure-/);
  });

  it("verdict_version is stamped, and articles.cause is the legacy token", async () => {
    const l = await seedLife(`nd-vv-${svc}`, { lifeNumber: 1, endedAt: hrs(29), deathCause: "died", playtimeSeconds: 7200 });
    await publish(targetFor(l, 29), "Stamped");
    const [row] = await db.select().from(articles).where(eq(articles.gamertag, l.gamertag));
    expect(row!.verdictVersion).toBe(CLASSIFIER_VERSION);
    expect(row!.cause).toBe("starvation");
  });

  it("articles.cause is a legacy token for every key", async () => {
    const LEGACY = new Set(["pvp", "suicide", "starvation", "dehydration", "bled_out", "mauled", "environmental", "unknown", "wolf", "bear", "animal", "infected", "fall", "vehicle", "explosion"]);
    const l = await seedLife(`nd-legacy-${svc}`, { lifeNumber: 1, endedAt: hrs(29), deathCause: "died", playtimeSeconds: 7200 });
    for (const cause of INTERNAL_CAUSES) {
      for (const confidence of ["definitive", "strong", "inferred", "unknown"] as Confidence[]) {
        const f = factsFor({ verdict: { cause, confidence, upstream: { cause: "infected", confidence } } });
        await publish(targetFor(l, 29), "Legacy", { facts: storedFacts(f) });
        const [row] = await db.select({ cause: articles.cause }).from(articles).where(eq(articles.gamertag, l.gamertag));
        expect(LEGACY.has(row!.cause!), `${cause}:${confidence} -> ${row!.cause}`).toBe(true);
        expect(row!.cause).toBe(f.verdict.cause);
      }
    }
  });

  it("never stores the credited name, even when handed the unstripped facts", async () => {
    const l = await seedLife(`nd-credit-${svc}`, { lifeNumber: 1, endedAt: hrs(29), deathCause: "explosion", playtimeSeconds: 7200 });
    const f = factsFor({
      verdict: { cause: "explosive_trap", objectKey: "m67_grenade", attrBasis: "placement" },
      credit: { gamertag: "Placer Person", device: "tripwire", byOperator: false },
    });
    await publish(targetFor(l, 29), "Credited", { facts: f });
    const [row] = await db.select().from(articles).where(eq(articles.gamertag, l.gamertag));
    expect(JSON.stringify(row!.facts)).not.toContain("Placer Person");
    expect((row!.facts as { creditSent: boolean }).creditSent).toBe(true);
  });
});
