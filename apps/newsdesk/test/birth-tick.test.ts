import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, articles } from "@onelife/db";
import { and, eq, inArray } from "drizzle-orm";
import { birthNoticeTick } from "../src/birth-tick.js";
import type { CompletionClient } from "../src/generate.js";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 54e7;
const t0 = new Date("2026-07-17T00:00:00Z");
const hrs = (h: number) => new Date(t0.getTime() + h * 3600_000);
const since0 = new Date("2026-07-16T00:00:00Z"); // before every seeded life
let serverId: number;
const pids: number[] = [];
const lifeIds: number[] = [];
const log = { info: () => {}, error: () => {} };

async function seedQualifiedAlive(tag: string, startH: number) {
  const [p] = await db.insert(players).values({ gamertag: tag }).returning();
  pids.push(p!.id);
  const [l] = await db.insert(lives).values({ serverId, playerId: p!.id, lifeNumber: 1, startedAt: hrs(startH), playtimeSeconds: 7200 }).returning();
  lifeIds.push(l!.id);
  return l!.id;
}

function okClient(): CompletionClient {
  return { complete: async () => JSON.stringify({ headline: "Fresh Meat On The Coast", lede: "L", body: "B", pullQuote: { text: "q", attribution: "a voice on the coast" }, tags: ["Fresh Spawns", "Elektro"] }) };
}
function failClient(): CompletionClient {
  return { complete: async () => { throw new Error("api boom"); } };
}
function calls(client: CompletionClient) {
  let n = 0;
  return { client: { complete: (r: { system: string; user: string }) => { n++; return client.complete(r); } }, count: () => n };
}

const deps = (over: Partial<Parameters<typeof birthNoticeTick>[1]>) => ({
  client: okClient(), dryRun: false, batchCap: 10, maxAttempts: 3,
  promptVersion: "birth-v1", model: "test", now: hrs(24), log, since: since0, ...over,
});

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "bt", map: "chernarusplus", slug: `bt-${svc}`, active: true }).returning();
  serverId = s!.id;
});
afterAll(async () => {
  await db.delete(articles).where(eq(articles.serverId, serverId));
  await db.delete(lives).where(inArray(lives.id, lifeIds));
  await db.delete(players).where(inArray(players.id, pids));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

describe("birthNoticeTick", () => {
  it("since=null: short-circuits to zeros without querying or calling the client", async () => {
    await seedQualifiedAlive(`bt-null-${svc}`, 2);
    const c = calls(okClient());
    const r = await birthNoticeTick(db, deps({ client: c.client, since: null }));
    expect(r).toEqual({ generated: 0, failed: 0, skipped: 0, dryRun: false });
    expect(c.count()).toBe(0);
    const rows = await db.select().from(articles).where(and(eq(articles.gamertag, `bt-null-${svc}`), eq(articles.kind, "birth_notice")));
    expect(rows).toHaveLength(0);
  });

  it("dry-run: never calls the client and writes nothing", async () => {
    await seedQualifiedAlive(`bt-dry-${svc}`, 3);
    const c = calls(okClient());
    const r = await birthNoticeTick(db, deps({ client: c.client, dryRun: true }));
    expect(r.dryRun).toBe(true);
    expect(c.count()).toBe(0);
    const rows = await db.select().from(articles).where(and(eq(articles.gamertag, `bt-dry-${svc}`), eq(articles.kind, "birth_notice")));
    expect(rows).toHaveLength(0);
  });

  it("live: generates and publishes a birth notice (First Life, death_at NULL), idempotent on re-run", async () => {
    await seedQualifiedAlive(`bt-live-${svc}`, 4);
    const r1 = await birthNoticeTick(db, deps({ batchCap: 50 }));
    expect(r1.generated).toBeGreaterThanOrEqual(1);
    const [row] = await db.select().from(articles).where(and(eq(articles.gamertag, `bt-live-${svc}`), eq(articles.kind, "birth_notice")));
    expect(row!.status).toBe("published");
    expect(row!.kind).toBe("birth_notice");
    expect(row!.deathAt).toBeNull();
    expect(row!.headline).toBe("Fresh Meat On The Coast");
    expect(row!.slug).toMatch(/^fresh-meat-on-the-coast-bt-live-/);
    expect(row!.tags).toContain("Fresh Spawns");
    expect(row!.tags).toContain("First Life"); // no priors -> First Life
    const before = (await db.select().from(articles).where(eq(articles.serverId, serverId))).length;
    await birthNoticeTick(db, deps({ batchCap: 50 }));
    const after = (await db.select().from(articles).where(eq(articles.serverId, serverId))).length;
    expect(after).toBe(before); // published lives are skipped
  });

  it("failure: records a failed stub with an incremented attempt", async () => {
    await seedQualifiedAlive(`bt-fail-${svc}`, 6);
    const r = await birthNoticeTick(db, deps({ client: failClient(), batchCap: 50 }));
    expect(r.failed).toBeGreaterThanOrEqual(1);
    const [row] = await db.select().from(articles).where(and(eq(articles.gamertag, `bt-fail-${svc}`), eq(articles.kind, "birth_notice")));
    expect(row!.status).toBe("failed");
    expect(row!.attempts).toBe(1);
    expect(row!.lastError).toMatch(/boom/);
  });
});
