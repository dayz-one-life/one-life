import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, sessions, positions, articles } from "@onelife/db";
import { inArray } from "drizzle-orm";
import { findStandingDeadTargets, findLongFormTargets } from "../src/news-targets.js";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 59e7;
const t0 = new Date("2026-07-01T00:00:00.000Z");
const hrs = (h: number) => new Date(t0.getTime() + h * 3_600_000);
const NOW = hrs(200);
const SINCE = hrs(0);
const tag = (n: string) => `aj-${n}-${svc}`;
let serverId: number;
const pids: number[] = [];

const SD_OPTS = {
  now: NOW, since: SINCE, standingDeadHours: 72, minPlaytimeSeconds: 1800,
  minHitsAbsorbed: 100, suppressedGamertags: [] as string[], maxAttempts: 3, limit: 10,
};
const LF_OPTS = {
  since: SINCE, now: NOW, maxFixAgeSeconds: 120, suppressedGamertags: [] as string[],
  candidateLimit: 500, windowSeconds: 180, radiusMeters: 100, maxAttempts: 3, limit: 10,
};

const isMine = (g: string) => g.endsWith(`-${svc}`);

async function mkPlayer(name: string, lastSeenH: number) {
  const [p] = await db.insert(players).values({ gamertag: tag(name), lastSeenAt: hrs(lastSeenH) }).returning();
  pids.push(p!.id);
  return p!.id;
}

/** Exactly the row retractNewsArticles leaves behind: status='retracted', attempts BELOW
 *  maxAttempts, so the status is the only thing that can possibly block a re-publish. */
async function seedRetracted(naturalKey: string, gamertag: string) {
  await db.insert(articles).values({
    kind: "news", status: "retracted", naturalKey,
    serverId, gamertag, map: "chernarusplus", mapSlug: "chernarus",
    lifeNumber: 1, lifeStartedAt: hrs(1), deathAt: null,
    slug: `aj-${gamertag}`, headline: "H", lede: "L", body: "B",
    promptVersion: "news-v1", model: "test", attempts: 1, createdAt: hrs(150),
  });
}

beforeAll(async () => {
  const [s] = await db.insert(servers).values({
    nitradoServiceId: svc, name: "aj", map: "chernarusplus", slug: `aj-${svc}`, active: true,
  }).returning();
  serverId = s!.id;

  // ── One Standing Dead subject: a prior life earns coverage, the open life is qualified, and
  // the last session ended well over 72h before `now`. ──
  const sd = await mkPlayer("sd", 120);
  await db.insert(lives).values({
    serverId, playerId: sd, lifeNumber: 1, startedAt: hrs(0), endedAt: hrs(0.5),
    deathCause: "pvp", playtimeSeconds: 1800,
  });
  const [openLife] = await db.insert(lives).values({
    serverId, playerId: sd, lifeNumber: 2, startedAt: hrs(1), endedAt: null,
    deathCause: null, playtimeSeconds: 7200,
  }).returning();
  await db.insert(sessions).values({
    serverId, playerId: sd, lifeId: openLife!.id,
    connectedAt: hrs(100), disconnectedAt: hrs(120), durationSeconds: 7200, closeReason: "disconnect",
  });

  // ── One Long Form pair: two qualified deaths, same instant, same patch of ground. ──
  const la = await mkPlayer("lf-a", 60);
  const lb = await mkPlayer("lf-b", 60);
  await db.insert(lives).values([
    { serverId, playerId: la, lifeNumber: 1, startedAt: hrs(0), endedAt: hrs(60), deathCause: "infected", playtimeSeconds: 3600 },
    { serverId, playerId: lb, lifeNumber: 1, startedAt: hrs(0), endedAt: hrs(60), deathCause: "infected", playtimeSeconds: 3600 },
  ]);
  await db.insert(positions).values([
    { serverId, playerId: la, gamertag: tag("lf-a"), x: 7423.51, y: 9210.88, recordedAt: hrs(60) },
    { serverId, playerId: lb, gamertag: tag("lf-b"), x: 7443.19, y: 9245.02, recordedAt: hrs(60) },
  ]);
});

afterAll(async () => {
  await db.delete(articles).where(inArray(articles.serverId, [serverId]));
  await db.delete(positions).where(inArray(positions.serverId, [serverId]));
  await db.delete(sessions).where(inArray(sessions.serverId, [serverId]));
  await db.delete(lives).where(inArray(lives.serverId, [serverId]));
  await db.delete(players).where(inArray(players.id, pids));
  await db.delete(servers).where(inArray(servers.id, [serverId]));
  await sql.end();
});

// A retracted article must block re-selection in BOTH arms. Without this, the subject is still
// idle and the natural key is byte-identical, so every tick pays for a fresh model call to
// regenerate the identical feature and the sweep takes it straight back down — forever.
describe("the anti-join blocks a RETRACTED article — the Standing Dead arm", () => {
  let key = "";

  it("selects the subject while no article exists", async () => {
    const mine = (await findStandingDeadTargets(db, SD_OPTS)).filter((t) => isMine(t.gamertag));
    const found = mine.find((t) => t.gamertag === tag("sd"));
    expect(found).toBeDefined();
    key = found!.naturalKey;
  });

  it("stops selecting it once its article is retracted", async () => {
    await seedRetracted(key, tag("sd"));
    const mine = (await findStandingDeadTargets(db, SD_OPTS)).filter((t) => isMine(t.gamertag));
    expect(mine.map((t) => t.gamertag)).not.toContain(tag("sd"));
  });
});

describe("the anti-join blocks a RETRACTED article — the Long Form arm", () => {
  let key = "";
  const mineClusters = <T extends { subjects: { gamertag: string }[] }>(cs: T[]) =>
    cs.filter((c) => c.subjects.some((s) => isMine(s.gamertag)));

  it("builds the cluster while no article exists", async () => {
    const found = mineClusters((await findLongFormTargets(db, LF_OPTS)).clusters);
    expect(found).toHaveLength(1);
    key = found[0]!.naturalKey;
  });

  it("stops building it once its article is retracted", async () => {
    // Long Form subjects are dead and are never swept, so this row can only arrive by hand —
    // but the two predicates are kept identical on purpose, so that they cannot drift.
    await seedRetracted(key, tag("lf-a"));
    expect(mineClusters((await findLongFormTargets(db, LF_OPTS)).clusters)).toEqual([]);
  });
});
