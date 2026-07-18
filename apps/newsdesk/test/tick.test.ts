import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, articles } from "@onelife/db";
import { eq, inArray, and } from "drizzle-orm";
import { newsdeskTick } from "../src/tick.js";
import type { CompletionClient } from "../src/generate.js";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 52e7;
const t0 = new Date("2026-07-14T00:00:00Z");
const hrs = (h: number) => new Date(t0.getTime() + h * 3600_000);
let serverId: number;
const pids: number[] = [];
const lifeIds: number[] = [];
const log = { info: () => {}, error: () => {} };

async function seedQualifiedDeath(tag: string, endH: number) {
  const [p] = await db.insert(players).values({ gamertag: tag }).returning();
  pids.push(p!.id);
  const [l] = await db.insert(lives).values({ serverId, playerId: p!.id, lifeNumber: 1, startedAt: hrs(endH - 2), endedAt: hrs(endH), deathCause: "pvp", deathByGamertag: "Killer", deathWeapon: "M4", deathDistance: 100, playtimeSeconds: 7200 }).returning();
  lifeIds.push(l!.id);
  return l!.id;
}

function okClient(): CompletionClient {
  return { complete: async () => JSON.stringify({ headline: "A Death On The Coast", lede: "L", body: "B", pullQuote: { text: "q", attribution: "a rival" }, tags: ["Obituaries", "Chernarus"] }) };
}
function failClient(): CompletionClient {
  return { complete: async () => { throw new Error("api boom"); } };
}
function calls(client: CompletionClient) {
  let n = 0;
  return { client: { complete: (r: { system: string; user: string }) => { n++; return client.complete(r); } }, count: () => n };
}

const deps = (over: Partial<Parameters<typeof newsdeskTick>[1]>) => ({
  client: okClient(), dryRun: false, batchCap: 10, maxAttempts: 3,
  promptVersion: "obituary-v1", model: "test", now: hrs(24), log, ...over,
});

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "tk", map: "chernarusplus", slug: `tk-${svc}`, active: true }).returning();
  serverId = s!.id;
});
afterAll(async () => {
  await db.delete(articles).where(eq(articles.serverId, serverId));
  await db.delete(lives).where(inArray(lives.id, lifeIds));
  await db.delete(players).where(inArray(players.id, pids));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

describe("newsdeskTick", () => {
  it("dry-run: never calls the client and writes nothing", async () => {
    await seedQualifiedDeath(`tk-dry-${svc}`, 2);
    const c = calls(okClient());
    const r = await newsdeskTick(db, deps({ client: c.client, dryRun: true }));
    expect(r.dryRun).toBe(true);
    expect(c.count()).toBe(0);
    const rows = await db.select().from(articles).where(eq(articles.gamertag, `tk-dry-${svc}`));
    expect(rows).toHaveLength(0);
  });

  it("live: generates and publishes an obituary, and is idempotent on re-run", async () => {
    await seedQualifiedDeath(`tk-live-${svc}`, 3);
    const r1 = await newsdeskTick(db, deps({ batchCap: 50 }));
    expect(r1.generated).toBeGreaterThanOrEqual(1);
    const [row] = await db.select().from(articles).where(eq(articles.gamertag, `tk-live-${svc}`));
    expect(row!.status).toBe("published");
    expect(row!.headline).toBe("A Death On The Coast");
    expect(row!.slug).toMatch(/^a-death-on-the-coast-tk-live-/);
    expect(row!.slug!.endsWith(`-${serverId}-1`)).toBe(true);
    const before = (await db.select().from(articles).where(eq(articles.serverId, serverId))).length;
    await newsdeskTick(db, deps({ batchCap: 50 }));
    const after = (await db.select().from(articles).where(eq(articles.serverId, serverId))).length;
    expect(after).toBe(before); // nothing new — published lives are skipped
  });

  it("failure: records a failed stub with an incremented attempt", async () => {
    await seedQualifiedDeath(`tk-fail-${svc}`, 5);
    const r = await newsdeskTick(db, deps({ client: failClient(), batchCap: 50 }));
    expect(r.failed).toBeGreaterThanOrEqual(1);
    const [row] = await db.select().from(articles).where(eq(articles.gamertag, `tk-fail-${svc}`));
    expect(row!.status).toBe("failed");
    expect(row!.attempts).toBe(1);
    expect(row!.lastError).toMatch(/boom/);
  });

  it("shows the model the desk's recent prose, fetched once for the whole tick", async () => {
    // A previously published obituary exists from the earlier live test — its headline must show
    // up in the do-not-reuse block of the next generation.
    await seedQualifiedDeath(`tk-recent-${svc}`, 7);
    const seen: string[] = [];
    const client: CompletionClient = {
      complete: async ({ user }) => {
        seen.push(user);
        return JSON.stringify({ headline: "Another Coastal Farce", lede: "L", body: "B", pullQuote: null, tags: ["Obituaries"] });
      },
    };
    await newsdeskTick(db, deps({ client, batchCap: 50 }));
    expect(seen.length).toBeGreaterThanOrEqual(1);
    // Order-independent: recentProse filters only on kind/status, so it sees every published
    // obituary in the test DB. Assert against the joined block, never against seen[0] alone.
    const block = seen.join("\n");
    expect(block).toMatch(/do NOT reuse/i);
    expect(block).toContain("A Death On The Coast"); // published by the earlier live test
  });

  it("dry-run does not fetch recent prose or call the client", async () => {
    const c = calls(okClient());
    const r = await newsdeskTick(db, deps({ client: c.client, dryRun: true }));
    expect(r.dryRun).toBe(true);
    expect(c.count()).toBe(0);
  });

  it("backstop: a repeated attribution is dropped, a fresh one is kept", async () => {
    // The earlier live test published an obituary attributed to "a rival".
    await seedQualifiedDeath(`tk-dup-${svc}`, 8);
    const dupClient: CompletionClient = {
      complete: async () => JSON.stringify({ headline: "The Same Old Line", lede: "L", body: "B", pullQuote: { text: "q", attribution: "A RIVAL" }, tags: ["Obituaries"] }),
    };
    await newsdeskTick(db, deps({ client: dupClient, batchCap: 50 }));
    const [dup] = await db.select().from(articles).where(eq(articles.gamertag, `tk-dup-${svc}`));
    expect(dup!.pullQuoteAttribution).toBeNull();
    expect(dup!.pullQuoteText).toBeNull();

    await seedQualifiedDeath(`tk-fresh-${svc}`, 9);
    const freshClient: CompletionClient = {
      complete: async () => JSON.stringify({ headline: "A Brand New Line", lede: "L", body: "B", pullQuote: { text: "q", attribution: "a bored coroner" }, tags: ["Obituaries"] }),
    };
    await newsdeskTick(db, deps({ client: freshClient, batchCap: 50 }));
    const [fresh] = await db.select().from(articles).where(eq(articles.gamertag, `tk-fresh-${svc}`));
    expect(fresh!.pullQuoteAttribution).toBe("a bored coroner");
  });

  it("folds the player's global priors into the stored facts", async () => {
    const tag = `tk-priors-${svc}`;
    // Two prior dead lives on this server, then the life the obituary is written for.
    const [p] = await db.insert(players).values({ gamertag: tag }).returning();
    pids.push(p!.id);
    for (const n of [1, 2]) {
      const [prior] = await db.insert(lives).values({
        serverId, playerId: p!.id, lifeNumber: n,
        startedAt: hrs(n * 2 - 2), endedAt: hrs(n * 2),
        deathCause: "bled_out", playtimeSeconds: 7200,
      }).returning();
      lifeIds.push(prior!.id);
    }
    const [cur] = await db.insert(lives).values({
      serverId, playerId: p!.id, lifeNumber: 3,
      startedAt: hrs(8), endedAt: hrs(10),
      deathCause: "pvp", deathByGamertag: "Killer", deathWeapon: "M4", deathDistance: 100,
      playtimeSeconds: 7200,
    }).returning();
    lifeIds.push(cur!.id);

    await newsdeskTick(db, deps({ batchCap: 50 }));

    // The two "prior" lives independently qualify (playtimeSeconds >= 300s) and get their own
    // obituary rows too, so scope down to lifeNumber 3 — the life this assertion is about — not
    // just gamertag+kind, which would match 3 rows non-deterministically.
    const [row] = await db.select().from(articles).where(and(eq(articles.gamertag, tag), eq(articles.kind, "obituary"), eq(articles.lifeNumber, 3)));
    const facts = row!.facts as { priors?: { livesLived?: number }; isKnownQuantity?: boolean };
    expect(facts.priors?.livesLived).toBe(2);
    expect(facts.isKnownQuantity).toBe(true);
  });
});
