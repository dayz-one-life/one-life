import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, articles, playerGamertags, kills, deathVerdicts } from "@onelife/db";
import { CLASSIFIER_VERSION } from "@onelife/death-verdict";
import { eq, inArray, and } from "drizzle-orm";
import { newsdeskTick } from "../src/tick.js";
import type { CompletionClient } from "../src/generate.js";
import { seedVerdict } from "./verdict.js";

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
  // Mirrors the projector fold, which writes a player_gamertags row for every seen name — the
  // dedupe anti-join's alias-history match relies on this existing, same as production.
  await db.insert(playerGamertags).values({ playerId: p!.id, gamertag: tag, firstSeenAt: hrs(endH - 2), lastSeenAt: hrs(endH - 2) });
  const [l] = await db.insert(lives).values({ serverId, playerId: p!.id, lifeNumber: 1, startedAt: hrs(endH - 2), endedAt: hrs(endH), deathCause: "pvp", deathByGamertag: "Killer", deathWeapon: "M4", deathDistance: 100, playtimeSeconds: 7200 }).returning();
  lifeIds.push(l!.id);
  await seedVerdict(db, l!.id);
  return l!.id;
}

function okClient(): CompletionClient {
  return { complete: async () => JSON.stringify({ headline: "A Death Nobody Predicted", lede: "L", body: "B", pullQuote: { text: "q", attribution: "a rival" }, tags: ["Obituaries", "Chernarus"] }) };
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
  promptVersion: "obituary-v1", model: "test", now: hrs(24), log,
  since: new Date("2020-01-01T00:00:00Z"), ...over,
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
    expect(row!.headline).toBe("A Death Nobody Predicted");
    expect(row!.slug).toMatch(/^a-death-nobody-predicted-tk-live-/);
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
        return JSON.stringify({ headline: "Another Predictable Farce", lede: "L", body: "B", pullQuote: null, tags: ["Obituaries"] });
      },
    };
    await newsdeskTick(db, deps({ client, batchCap: 50 }));
    expect(seen.length).toBeGreaterThanOrEqual(1);
    // Order-independent: recentProse filters only on kind/status, so it sees every published
    // obituary in the test DB. Assert against the joined block, never against seen[0] alone.
    const block = seen.join("\n");
    expect(block).toMatch(/do NOT reuse/i);
    expect(block).toContain("A Death Nobody Predicted"); // published by the earlier live test
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
    await db.insert(playerGamertags).values({ playerId: p!.id, gamertag: tag, firstSeenAt: hrs(0), lastSeenAt: hrs(0) });
    for (const n of [1, 2]) {
      const [prior] = await db.insert(lives).values({
        serverId, playerId: p!.id, lifeNumber: n,
        startedAt: hrs(n * 2 - 2), endedAt: hrs(n * 2),
        deathCause: "bled_out", playtimeSeconds: 7200,
      }).returning();
      lifeIds.push(prior!.id);
      await seedVerdict(db, prior!.id);
    }
    const [cur] = await db.insert(lives).values({
      serverId, playerId: p!.id, lifeNumber: 3,
      startedAt: hrs(8), endedAt: hrs(10),
      deathCause: "pvp", deathByGamertag: "Killer", deathWeapon: "M4", deathDistance: 100,
      playtimeSeconds: 7200,
    }).returning();
    lifeIds.push(cur!.id);
    await seedVerdict(db, cur!.id);

    await newsdeskTick(db, deps({ batchCap: 50 }));

    // The two "prior" lives independently qualify (playtimeSeconds >= 300s) and get their own
    // obituary rows too, so scope down to lifeNumber 3 — the life this assertion is about — not
    // just gamertag+kind, which would match 3 rows non-deterministically.
    const [row] = await db.select().from(articles).where(and(eq(articles.gamertag, tag), eq(articles.kind, "obituary"), eq(articles.lifeNumber, 3)));
    const facts = row!.facts as { priors?: { livesLived?: number }; isKnownQuantity?: boolean };
    expect(facts.priors?.livesLived).toBe(2);
    expect(facts.isKnownQuantity).toBe(true);
  });

  it("since: null short-circuits to zeros — no targets queried, no client call", async () => {
    const client = { complete: async () => { throw new Error("must not be called"); } };
    const r = await newsdeskTick(db, { ...deps({}), client, since: null });
    expect(r).toEqual({ generated: 0, failed: 0, skipped: 0, dryRun: false });
  });

  it("a death before the cutoff is never a target", async () => {
    const cutoff = hrs(20.5);
    const beforeTag = `tk-before-${svc}`;
    const afterTag = `tk-after-${svc}`;
    await seedQualifiedDeath(beforeTag, 20); // endedAt before cutoff
    await seedQualifiedDeath(afterTag, 21); // endedAt after cutoff

    await newsdeskTick(db, deps({ batchCap: 50, since: cutoff }));

    const beforeRows = await db.select().from(articles).where(eq(articles.gamertag, beforeTag));
    expect(beforeRows).toHaveLength(0);

    const afterRows = await db.select().from(articles).where(eq(articles.gamertag, afterTag));
    expect(afterRows).toHaveLength(1);
    expect(afterRows[0]!.status).toBe("published");
  });

  it("logs the qualified deaths waiting over 45 minutes for a reviewable verdict, at error level", async () => {
    const tag = `tk-overdue-${svc}`;
    const id = await seedQualifiedDeath(tag, 40);
    await sql`DELETE FROM death_verdicts WHERE life_id = ${id}`;
    const errors: [unknown, string | undefined][] = [];
    const spy = { info: () => {}, error: (o: unknown, m?: string) => { errors.push([o, m]); } };
    await newsdeskTick(db, deps({ log: spy, now: new Date(hrs(40).getTime() + 30 * 60_000), dryRun: true }));
    expect(errors.filter(([, m]) => m === "newsdesk.obituary_overdue")).toEqual([]);
    await newsdeskTick(db, deps({ log: spy, now: new Date(hrs(40).getTime() + 50 * 60_000), dryRun: true }));
    const alarm = errors.find(([, m]) => m === "newsdesk.obituary_overdue");
    expect(alarm).toBeDefined();
    expect((alarm![0] as { lifeIds: number[] }).lifeIds).toContain(id);
  });

  it("v4: stores the frozen death, the legacy cause and verdict_version, and never the credited name", async () => {
    const tag = `tk-trap-${svc}`;
    const id = await seedQualifiedDeath(tag, 50);
    await db.update(lives).set({ deathCause: "explosion", deathByGamertag: null, deathWeapon: null }).where(eq(lives.id, id));
    await db.delete(deathVerdicts).where(eq(deathVerdicts.lifeId, id));
    await seedVerdict(db, id, { cause: "explosive_trap", objectKey: "m67_grenade", attrBasis: "placement", rule: "A07" });
    const [placer] = await db.insert(players).values({ gamertag: `Placer Person ${svc}` }).returning();
    pids.push(placer!.id);
    await db.insert(kills).values({
      serverId, killerGamertag: `Placer Person ${svc}`, killerPlayerId: placer!.id, victimGamertag: tag, victimLifeId: id,
      weapon: "Tripwire", occurredAt: hrs(50), basis: "trap_placement", creditSource: "classifier",
    });
    const seen: string[] = [];
    const client: CompletionClient = { complete: async ({ user }) => { seen.push(user); return JSON.stringify({ headline: "A Wire Too Far", lede: "L", body: "B", pullQuote: null, tags: [] }); } };
    await newsdeskTick(db, deps({ client, batchCap: 50, promptVersion: "obituary-v4" }));
    const prompt = seen.find((u) => u.includes(tag))!;
    expect(prompt).toContain(`credited with the kill`);
    expect(prompt).toContain(`Placer Person ${svc}`);
    const [row] = await db.select().from(articles).where(eq(articles.gamertag, tag));
    expect(row!.status).toBe("published");
    expect(row!.cause).toBe("explosion");
    expect(row!.verdictVersion).toBe(CLASSIFIER_VERSION);
    expect(row!.tags).toEqual(["Obituaries", "Chernarus", "Trap"]);
    const facts = row!.facts as { death: { key: string; sentence: string }; creditSent: boolean };
    expect(facts.death.key).toBe("tripwire");
    expect(facts.creditSent).toBe(true);
    expect(JSON.stringify(row!.facts)).not.toContain("Placer Person");
    await db.delete(kills).where(eq(kills.victimLifeId, id));
  });

  it("v4: a logout-family death fails the check on a logout word anywhere in the article", async () => {
    const tag = `tk-ko-${svc}`;
    const id = await seedQualifiedDeath(tag, 52);
    await db.update(lives).set({ deathCause: "died", deathByGamertag: null }).where(eq(lives.id, id));
    await db.delete(deathVerdicts).where(eq(deathVerdicts.lifeId, id));
    await seedVerdict(db, id, { cause: "unconscious_logout", upstreamCause: "infected", upstreamConfidence: "definitive", rule: "B01" });
    const client: CompletionClient = { complete: async () => JSON.stringify({ headline: "H", lede: "L", body: "He never respawned.", pullQuote: null, tags: [] }) };
    await newsdeskTick(db, deps({ client, batchCap: 50 }));
    const [row] = await db.select().from(articles).where(eq(articles.gamertag, tag));
    expect(row!.status).toBe("failed");
    expect(row!.lastError).toMatch(/cause-check/);
  });
});

