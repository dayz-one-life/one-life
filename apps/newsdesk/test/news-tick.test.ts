import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, sessions, hitEvents, articles } from "@onelife/db";
import { and, eq, inArray } from "drizzle-orm";
import { newsTick, longFormSkipLog } from "../src/news-tick.js";
import type { CompletionClient } from "../src/generate.js";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 57e7;
const t0 = new Date("2026-07-01T00:00:00.000Z");
const hrs = (h: number) => new Date(t0.getTime() + h * 3_600_000);
const NOW = hrs(200);
const SINCE = hrs(0);
const tag = (n: string) => `nt-${n}-${svc}`;
let serverId: number;
const pids: number[] = [];
const log = { info: () => {}, error: () => {} };

/** An idle, qualified, earned-coverage open life — the canonical Standing Dead subject. */
async function seedStandingDead(name: string, connectedAtH: number, disconnectedAtH: number) {
  const [p] = await db.insert(players).values({ gamertag: tag(name), lastSeenAt: hrs(disconnectedAtH) }).returning();
  pids.push(p!.id);
  // a prior life satisfies the earned-coverage clause without needing 100 hit rows
  await db.insert(lives).values({
    serverId, playerId: p!.id, lifeNumber: 1, startedAt: hrs(0), endedAt: hrs(0.5),
    deathCause: "pvp", playtimeSeconds: 1800,
  });
  const [l] = await db.insert(lives).values({
    serverId, playerId: p!.id, lifeNumber: 2, startedAt: hrs(1), endedAt: null,
    deathCause: null, playtimeSeconds: 7200,
  }).returning();
  await db.insert(sessions).values({
    serverId, playerId: p!.id, lifeId: l!.id,
    connectedAt: hrs(connectedAtH), disconnectedAt: hrs(disconnectedAtH),
    durationSeconds: 7200, closeReason: "disconnect",
  });
  return l!.id;
}

const okBody = JSON.stringify({
  headline: "Nobody Has Seen Him Since Tuesday",
  lede: "The record simply stops.",
  blocks: [{ type: "para", text: "One." }, { type: "subhead", text: "S" }, { type: "para", text: "Two." }],
  pullQuote: { text: "q", attribution: "an unnamed witness" },
  tags: ["Fog"],
});
const okClient = (): CompletionClient => ({ complete: async () => okBody });
const failClient = (): CompletionClient => ({ complete: async () => { throw new Error("api boom"); } });
function counted(client: CompletionClient) {
  let n = 0;
  return { client: { complete: (r: { system: string; user: string }) => { n++; return client.complete(r); } }, count: () => n };
}

const deps = (over: Partial<Parameters<typeof newsTick>[1]> = {}) => ({
  client: okClient(), dryRun: false, batchCap: 10, maxAttempts: 3,
  promptVersion: "news-v1", model: "test", now: NOW, log,
  enabled: true, since: SINCE, maxPerTick: 2,
  standingDeadHours: 72, minPlaytimeSeconds: 1800, minHitsAbsorbed: 100,
  suppressedGamertags: [] as string[],
  windowSeconds: 180, radiusMeters: 100, maxFixAgeSeconds: 120,
  ...over,
});

const newsRows = () => db.select().from(articles).where(and(eq(articles.serverId, serverId), eq(articles.kind, "news")));

beforeAll(async () => {
  const [s] = await db.insert(servers).values({
    nitradoServiceId: svc, name: "nt", map: "chernarusplus", slug: `nt-${svc}`, active: true,
  }).returning();
  serverId = s!.id;
});
afterAll(async () => {
  await db.delete(articles).where(eq(articles.serverId, serverId));
  await db.delete(hitEvents).where(eq(hitEvents.serverId, serverId));
  await db.delete(sessions).where(eq(sessions.serverId, serverId));
  await db.delete(lives).where(eq(lives.serverId, serverId));
  await db.delete(players).where(inArray(players.id, pids));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

describe("newsTick — the two off-states", () => {
  it("enabled=false: zeros, no model call, no write", async () => {
    await seedStandingDead("off-a", 100, 120);
    const c = counted(okClient());
    const r = await newsTick(db, deps({ client: c.client, enabled: false }));
    expect(r.generated).toBe(0);
    expect(r.failed).toBe(0);
    expect(r.standingDeadFound).toBe(0);
    expect(r.longFormFound).toBe(0);
    expect(r.retracted).toBe(0);
    expect(c.count()).toBe(0);
    expect(await newsRows()).toHaveLength(0);
  });

  it("since=null: zeros, no model call, no write", async () => {
    const c = counted(okClient());
    const r = await newsTick(db, deps({ client: c.client, since: null }));
    expect(r.generated).toBe(0);
    expect(r.standingDeadFound).toBe(0);
    expect(c.count()).toBe(0);
    expect(await newsRows()).toHaveLength(0);
  });

  it("reports a zeroed skip record in both off-states rather than an absent one", async () => {
    // BOTH, literally: `!deps.enabled || deps.since === null` is two disjuncts, and a test that
    // exercised one of them would pass against a guard that had lost the other.
    const off = await newsTick(db, deps({ enabled: false }));
    expect(off.longFormSkipped).toEqual({ self_cluster: 0, suicide_subject: 0, suppressed_gamertag: 0 });
    const noCutoff = await newsTick(db, deps({ since: null }));
    expect(noCutoff.longFormSkipped).toEqual({ self_cluster: 0, suicide_subject: 0, suppressed_gamertag: 0 });
  });
});

describe("newsTick — dry run", () => {
  it("finds targets but never calls the model and never writes", async () => {
    const c = counted(okClient());
    const r = await newsTick(db, deps({ client: c.client, dryRun: true }));
    expect(r.dryRun).toBe(true);
    expect(r.standingDeadFound).toBeGreaterThanOrEqual(1);
    expect(r.generated).toBe(0);
    expect(c.count()).toBe(0);
    expect(await newsRows()).toHaveLength(0);
  });
});

describe("newsTick — the Standing Dead arm", () => {
  it("publishes a news article and is idempotent on re-run", async () => {
    const r1 = await newsTick(db, deps());
    expect(r1.generated).toBeGreaterThanOrEqual(1);
    const [row] = await db.select().from(articles)
      .where(and(eq(articles.serverId, serverId), eq(articles.gamertag, tag("off-a"))));
    expect(row!.kind).toBe("news");
    expect(row!.status).toBe("published");
    expect(row!.naturalKey).toMatch(/^standing_dead:/);
    expect(row!.body).toBe("One.\n\nTwo.");
    expect(row!.bodyBlocks).toHaveLength(3);
    expect(row!.tags).toEqual(["News", "Chernarus", "The Standing Dead", "Fog"]);
    expect(row!.deathAt).toBeNull();

    const before = (await newsRows()).length;
    await newsTick(db, deps());
    expect((await newsRows()).length).toBe(before);   // the anti-join blocks a republish
  });

  it("honours maxPerTick", async () => {
    await seedStandingDead("cap-a", 100, 120);
    await seedStandingDead("cap-b", 101, 121);
    await seedStandingDead("cap-c", 102, 122);
    const r = await newsTick(db, deps({ maxPerTick: 2 }));
    expect(r.generated).toBe(2);
  });

  it("isolates a failure into a stub and dedupes the stub across ticks", async () => {
    await seedStandingDead("fail", 103, 123);
    const key = `standing_dead:${serverId}:${tag("fail")}:${hrs(1).toISOString()}`;
    await newsTick(db, deps({ client: failClient(), maxPerTick: 10 }));
    const first = await db.select().from(articles).where(eq(articles.naturalKey, key));
    expect(first).toHaveLength(1);
    expect(first[0]!.status).toBe("failed");
    expect(first[0]!.attempts).toBe(1);
    expect(first[0]!.naturalKey).toBe(key);

    await newsTick(db, deps({ client: failClient(), maxPerTick: 10 }));
    const second = await db.select().from(articles).where(eq(articles.naturalKey, key));
    expect(second).toHaveLength(1);            // spec §12.4: ONE row, attempts = 2
    expect(second[0]!.attempts).toBe(2);
  });

  it("drops a suppressed gamertag before it reaches the model", async () => {
    // Asserted on THIS subject by name, never on a global count. Earlier tests in this file leave
    // `cap-c` and `fail` at attempts=2, which is below maxAttempts=3, so they are legitimately
    // still selectable — a `standingDeadFound === 0` assertion would be measuring their state,
    // not the suppression list. Do not "fix" a failure here by raising maxAttempts or reordering
    // the tests; both re-couple this test to its predecessor's leftovers.
    await seedStandingDead("suppressed", 104, 124);
    await newsTick(db, deps({ maxPerTick: 10, suppressedGamertags: [tag("suppressed").toUpperCase()] }));
    const rows = await db.select().from(articles).where(eq(articles.gamertag, tag("suppressed")));
    expect(rows).toHaveLength(0);
  });
});

describe("newsTick — retraction", () => {
  it("de-publishes an article whose subject came back, and never in dry run", async () => {
    const [row] = await db.select().from(articles)
      .where(and(eq(articles.serverId, serverId), eq(articles.gamertag, tag("off-a"))));
    const [p] = await db.select().from(players).where(eq(players.gamertag, tag("off-a")));
    const [l] = await db.select().from(lives).where(eq(lives.playerId, p!.id));
    await db.insert(sessions).values({
      serverId, playerId: p!.id, lifeId: l!.id,
      connectedAt: new Date(row!.createdAt.getTime() + 3_600_000), disconnectedAt: null,
      durationSeconds: 60, closeReason: null,
    });

    const dry = await newsTick(db, deps({ dryRun: true }));
    expect(dry.retracted).toBe(1);             // REPORTED
    const [stillUp] = await db.select().from(articles).where(eq(articles.id, row!.id));
    expect(stillUp!.status).toBe("published"); // but NOT written

    const live = await newsTick(db, deps());
    expect(live.retracted).toBe(1);
    const [down] = await db.select().from(articles).where(eq(articles.id, row!.id));
    expect(down!.status).toBe("retracted");
  });

  it("the retraction is DURABLE — a later tick never regenerates the feature", async () => {
    // The end-to-end form of the widened anti-join (Task 7 Steps 7-11). The subject is still idle
    // and their natural key is unchanged, so on a 'published'-only anti-join this tick would spend
    // a model call rewriting the identical article and the sweep would retract it again — one paid
    // call per tick, forever, and the piece never visible. Every other subject in this file is
    // published or retracted by now, so the correct model-call count for this tick is exactly 0.
    const [row] = await db.select().from(articles)
      .where(and(eq(articles.serverId, serverId), eq(articles.gamertag, tag("off-a"))));
    const c = counted(okClient());
    const again = await newsTick(db, deps({ client: c.client }));
    expect(c.count()).toBe(0);
    expect(again.generated).toBe(0);
    const [still] = await db.select().from(articles).where(eq(articles.id, row!.id));
    expect(still!.status).toBe("retracted");
    expect(still!.headline).toBe("Nobody Has Seen Him Since Tuesday");
  });
});

describe("longFormSkipLog", () => {
  it("renders exactly the three reasons that can be non-zero", () => {
    // `unqualified_subject` is dropped on purpose: the qualified gate lives in the candidate SQL,
    // so applyLongFormExclusions can never increment it. A permanently-zero counter in an
    // observability line is a lie the operator would act on.
    expect(Object.keys(longFormSkipLog({
      self_cluster: 4, suicide_subject: 1, unqualified_subject: 0, suppressed_gamertag: 2,
    })).sort()).toEqual(["self_cluster", "suicide_subject", "suppressed_gamertag"]);
  });

  it("preserves the counts it does render and defaults a missing one to 0", () => {
    expect(longFormSkipLog({ self_cluster: 4, suicide_subject: 1, unqualified_subject: 9, suppressed_gamertag: 2 }))
      .toEqual({ self_cluster: 4, suicide_subject: 1, suppressed_gamertag: 2 });
    expect(longFormSkipLog({})).toEqual({ self_cluster: 0, suicide_subject: 0, suppressed_gamertag: 0 });
  });
});
