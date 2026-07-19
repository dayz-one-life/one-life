import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, sessions, hitEvents, articles } from "@onelife/db";
import { inArray } from "drizzle-orm";
import { findStandingDeadTargets, type StandingDeadOpts } from "../src/standing-dead-targets.js";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 53e7;
const t0 = new Date("2026-07-01T00:00:00.000Z");
const hrs = (h: number) => new Date(t0.getTime() + h * 3_600_000);
const NOW = hrs(200);
const tag = (n: string) => `sd-${n}-${svc}`;
let serverId: number;
const pids: number[] = [];
const lifeIds = new Map<string, number>();

async function seed(name: string, o: {
  playtime: number; connectedAt: Date; disconnectedAt: Date | null;
  priorLife?: boolean; hits?: number; startedAt?: Date;
}) {
  const [p] = await db.insert(players).values({ gamertag: tag(name), lastSeenAt: o.connectedAt }).returning();
  pids.push(p!.id);
  const started = o.startedAt ?? hrs(1);
  if (o.priorLife) {
    await db.insert(lives).values({
      serverId, playerId: p!.id, lifeNumber: 1, startedAt: hrs(0),
      endedAt: hrs(0.5), deathCause: "pvp", playtimeSeconds: 1800,
    });
  }
  const [l] = await db.insert(lives).values({
    serverId, playerId: p!.id, lifeNumber: o.priorLife ? 2 : 1,
    startedAt: started, endedAt: null, deathCause: null, playtimeSeconds: o.playtime,
  }).returning();
  lifeIds.set(name, l!.id);
  await db.insert(sessions).values({
    serverId, playerId: p!.id, lifeId: l!.id,
    connectedAt: o.connectedAt, disconnectedAt: o.disconnectedAt,
    durationSeconds: o.playtime, closeReason: o.disconnectedAt ? "disconnect" : null,
  });
  for (let i = 0; i < (o.hits ?? 0); i++) {
    await db.insert(hitEvents).values({
      serverId, victimGamertag: tag(name), attackerGamertag: `zed-${i}`,
      attackerType: "infected", bodyPart: `part-${i}`,
      occurredAt: new Date(started.getTime() + i * 1000),
    });
  }
  return p!.id;
}

beforeAll(async () => {
  const [s] = await db.insert(servers).values({
    nitradoServiceId: svc, name: "sd", map: "sakhal", slug: `sd-${svc}`, active: true,
  }).returning();
  serverId = s!.id;

  // idle 80h, 2h playtime, has a prior life -> the canonical subject
  await seed("veteran", { playtime: 7200, connectedAt: hrs(118), disconnectedAt: hrs(120), priorLife: true });
  // exactly 72h idle as of NOW (200h): last seen 128h -> eligibleAt == NOW -> IN (inclusive)
  await seed("edge-in", { playtime: 7200, connectedAt: hrs(126), disconnectedAt: hrs(128), priorLife: true });
  // 71.99h idle: last seen 128.01h -> eligibleAt > NOW -> OUT
  await seed("edge-out", { playtime: 7200, connectedAt: hrs(126), disconnectedAt: hrs(128.01), priorLife: true });
  // crashed and never returned: disconnected_at IS NULL, connected 100h ago
  await seed("crashed", { playtime: 7200, connectedAt: hrs(100), disconnectedAt: null, priorLife: true });
  // idle but only 25 min of playtime -> below the 1800s gate
  await seed("brief", { playtime: 1500, connectedAt: hrs(98), disconnectedAt: hrs(100), priorLife: true });
  // first life, no prior, 5 hits -> FAILS earned coverage (the "low-contact bounce" case)
  await seed("bounce", { playtime: 7200, connectedAt: hrs(98), disconnectedAt: hrs(100), hits: 5 });
  // first life, no prior, exactly 100 hits -> PASSES on the hits arm (inclusive boundary)
  await seed("battered", { playtime: 7200, connectedAt: hrs(98), disconnectedAt: hrs(100), hits: 100 });
  // first life, no prior, 99 hits -> FAILS (one short)
  await seed("bruised", { playtime: 7200, connectedAt: hrs(98), disconnectedAt: hrs(100), hits: 99 });
});

afterAll(async () => {
  await db.delete(articles).where(inArray(articles.serverId, [serverId]));
  await db.delete(hitEvents).where(inArray(hitEvents.serverId, [serverId]));
  await db.delete(sessions).where(inArray(sessions.serverId, [serverId]));
  await db.delete(lives).where(inArray(lives.serverId, [serverId]));
  await db.delete(players).where(inArray(players.id, pids));
  await db.delete(servers).where(inArray(servers.id, [serverId]));
  await sql.end();
});

// Explicitly typed as StandingDeadOpts (not inferred): an un-annotated `suppressedGamertags: []`
// infers as `never[]`, which then narrows `tagsOf`'s default-parameter type and rejects any
// `{ ...OPTS, suppressedGamertags: string[] }` override at the call site below.
const OPTS: StandingDeadOpts = {
  now: NOW, since: t0, standingDeadHours: 72, minPlaytimeSeconds: 1800,
  minHitsAbsorbed: 100, suppressedGamertags: [], maxAttempts: 3, limit: 50,
};
const tagsOf = async (o = OPTS) =>
  (await findStandingDeadTargets(db, o)).filter((r) => r.gamertag.endsWith(`-${svc}`)).map((r) => r.gamertag);

describe("findStandingDeadTargets", () => {
  it("returns idle, qualified, long-enough open lives", async () => {
    const t = await tagsOf();
    expect(t).toContain(tag("veteran"));
    expect(t).not.toContain(tag("brief"));
  });

  it("includes a life idle by exactly the threshold and excludes one a hair under", async () => {
    const t = await tagsOf();
    expect(t).toContain(tag("edge-in"));
    expect(t).not.toContain(tag("edge-out"));
  });

  it("treats an OPEN session (disconnected_at IS NULL) as last-seen = connected_at", async () => {
    // The COALESCE is load-bearing: a naive MAX(disconnected_at) evaluates NULL and silently
    // excludes exactly the crash-and-never-returned case this vertical exists for.
    expect(await tagsOf()).toContain(tag("crashed"));
  });

  it("orders oldest-idle first so the backlog drains stably across ticks", async () => {
    const rows = (await findStandingDeadTargets(db, OPTS)).filter((r) => r.gamertag.endsWith(`-${svc}`));
    const seen = rows.map((r) => r.lastSeenAt.getTime());
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
  });

  it("computes eligibleAt as lastSeen + standingDeadHours", async () => {
    const row = (await findStandingDeadTargets(db, OPTS)).find((r) => r.gamertag === tag("edge-in"))!;
    expect(row.eligibleAt.toISOString()).toBe(NOW.toISOString());
  });

  it("gates NEWS_SINCE on the ELIGIBILITY instant, not lives.started_at", async () => {
    // All subjects were born at hour 1; a `since` after that but before their eligibility instants
    // must still return them, and a `since` after every eligibility instant must return none.
    expect(await tagsOf({ ...OPTS, since: hrs(2) })).toContain(tag("veteran"));
    expect(await tagsOf({ ...OPTS, since: hrs(199) })).not.toContain(tag("veteran"));
  });

  it("excludes an ended life", async () => {
    await db.update(lives).set({ endedAt: hrs(130), deathCause: "pvp" })
      .where(inArray(lives.id, [lifeIds.get("veteran")!]));
    expect(await tagsOf()).not.toContain(tag("veteran"));
    await db.update(lives).set({ endedAt: null, deathCause: null })
      .where(inArray(lives.id, [lifeIds.get("veteran")!]));
  });

  it("honours the limit", async () => {
    const rows = await findStandingDeadTargets(db, { ...OPTS, limit: 1 });
    expect(rows).toHaveLength(1);
  });

  it("drops a suppressed gamertag case-insensitively without breaking the array param", async () => {
    // Regression coverage for the driver gotcha documented in long-form-targets.ts: a bare
    // interpolated JS array collapses to a parenthesized scalar list, and for a SINGLE-element
    // array that becomes a bare scalar whose `::text[]` cast Postgres rejects as a malformed
    // array literal. One element is deliberately the minimal reproduction.
    const t = await tagsOf({ ...OPTS, suppressedGamertags: [tag("veteran").toUpperCase()] });
    expect(t).not.toContain(tag("veteran"));
    expect(t).toContain(tag("edge-in"));
  });
});

describe("earned coverage", () => {
  it("admits a subject with a prior life and no hits", async () => {
    expect(await tagsOf()).toContain(tag("veteran"));
  });

  it("rejects a first-life, low-contact bounce — a hard predicate clause, not prompt guidance", async () => {
    expect(await tagsOf()).not.toContain(tag("bounce"));
  });

  it("admits on the hits arm at exactly the threshold and rejects one short", async () => {
    const t = await tagsOf();
    expect(t).toContain(tag("battered"));
    expect(t).not.toContain(tag("bruised"));
  });

  it("reports priorLives and hitsAbsorbed on the target", async () => {
    const rows = await findStandingDeadTargets(db, OPTS);
    const b = rows.find((r) => r.gamertag === tag("battered"))!;
    expect(b.priorLives).toBe(0);
    expect(b.hitsAbsorbed).toBe(100);
    const v = rows.find((r) => r.gamertag === tag("veteran"))!;
    expect(v.priorLives).toBeGreaterThanOrEqual(1);
  });

  it("does not count hits outside the life window", async () => {
    await db.insert(hitEvents).values({
      serverId, victimGamertag: tag("bruised"), attackerGamertag: "before",
      attackerType: "infected", bodyPart: "pre", occurredAt: hrs(0),   // before startedAt (hrs 1)
    });
    expect(await tagsOf()).not.toContain(tag("bruised"));
  });

  it("excludes a suppressed gamertag case-insensitively", async () => {
    expect(await tagsOf({ ...OPTS, suppressedGamertags: [tag("veteran").toUpperCase()] }))
      .not.toContain(tag("veteran"));
  });
});

describe("article anti-join", () => {
  const stub = (naturalKey: string, o: { status: string; attempts: number }) => db.insert(articles).values({
    kind: "news", status: o.status, naturalKey, attempts: o.attempts,
    serverId, gamertag: tag("veteran"), map: "sakhal", lifeNumber: 2,
    lifeStartedAt: hrs(1), deathAt: null,            // NULL for Standing Dead (spec §6)
    slug: `sd-${naturalKey.length}-${svc}`, headline: "H", lede: "L", body: "B",
    promptVersion: "news-v1", model: "test",
  });
  const keyFor = async () =>
    (await findStandingDeadTargets(db, OPTS)).find((r) => r.gamertag === tag("veteran"))!.naturalKey;

  it("suppresses a subject whose natural key is already published", async () => {
    const k = await keyFor();
    await stub(k, { status: "published", attempts: 1 });
    expect(await tagsOf()).not.toContain(tag("veteran"));
    await db.delete(articles).where(inArray(articles.naturalKey, [k]));
  });

  it("keeps retrying a failed subject until attempts reach maxAttempts", async () => {
    const k = await keyFor();
    await stub(k, { status: "failed", attempts: 2 });
    expect(await tagsOf()).toContain(tag("veteran"));           // 2 < 3
    await db.update(articles).set({ attempts: 3 }).where(inArray(articles.naturalKey, [k]));
    expect(await tagsOf()).not.toContain(tag("veteran"));       // exhausted
    await db.delete(articles).where(inArray(articles.naturalKey, [k]));
  });

  it("applies the limit AFTER the anti-join so a blocked subject never consumes a slot", async () => {
    const rows = await findStandingDeadTargets(db, OPTS);
    const first = rows[0]!;
    await stub(first.naturalKey, { status: "published", attempts: 1 });
    const capped = await findStandingDeadTargets(db, { ...OPTS, limit: 1 });
    expect(capped.map((r) => r.naturalKey)).not.toContain(first.naturalKey);
    expect(capped).toHaveLength(1);
    await db.delete(articles).where(inArray(articles.naturalKey, [first.naturalKey]));
  });
});

describe("population funnel (§4.1.2 shape)", () => {
  it("each successive gate is a strict subset of the looser one", async () => {
    const loose = { ...OPTS, minPlaytimeSeconds: 0, minHitsAbsorbed: 0, standingDeadHours: 0 };
    const setOf = async (o: typeof OPTS) =>
      new Set((await findStandingDeadTargets(db, { ...o, limit: 500 }))
        .filter((r) => r.gamertag.endsWith(`-${svc}`)).map((r) => r.gamertag));

    const all = await setOf(loose);
    const idle = await setOf({ ...loose, standingDeadHours: 72 });
    const played = await setOf({ ...loose, standingDeadHours: 72, minPlaytimeSeconds: 1800 });
    const earned = await setOf(OPTS);

    for (const g of idle) expect(all.has(g)).toBe(true);
    for (const g of played) expect(idle.has(g)).toBe(true);
    for (const g of earned) expect(played.has(g)).toBe(true);
    expect(earned.size).toBeLessThan(played.size);   // the earned-coverage clause bites
  });

  it("returns no coordinate-shaped number — a Standing Dead target carries no fix at all", async () => {
    const rows = await findStandingDeadTargets(db, OPTS);
    expect(JSON.stringify(rows)).not.toMatch(/\d{4}\.\d/);
    expect(Object.keys(rows[0] ?? {})).not.toContain("x");
    expect(Object.keys(rows[0] ?? {})).not.toContain("y");
  });
});
