import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, articles, playerGamertags } from "@onelife/db";
import { eq, inArray } from "drizzle-orm";
import { findObituaryTargets, publishObituary, recordObituaryFailure, obituarySlug, type ObituaryTarget } from "../src/pg-store.js";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 52e7;
const t0 = new Date("2026-07-13T00:00:00Z");
const hrs = (h: number) => new Date(t0.getTime() + h * 3600_000);
let serverId: number;
const pids: number[] = [];
const lifeIds: number[] = [];

async function seedLife(tag: string, over: Record<string, unknown>) {
  const [p] = await db.insert(players).values({ gamertag: tag }).returning();
  pids.push(p!.id);
  // Mirrors the projector fold, which writes a player_gamertags row for every seen name — the
  // anti-join's alias-history match relies on this existing, same as production.
  await db.insert(playerGamertags).values({ playerId: p!.id, gamertag: tag, firstSeenAt: hrs(0), lastSeenAt: hrs(0) });
  const [l] = await db.insert(lives).values({ serverId, playerId: p!.id, lifeNumber: 1, startedAt: hrs(0), ...over }).returning();
  lifeIds.push(l!.id);
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
      facts: { sessions: 1, killerGamertag: "Killer", weapon: "M4", timeAliveSeconds: 7200, kills: 0, longestKillMeters: null, cause: "pvp" },
      obituary: { headline: "Gone", lede: "l", body: "b", pullQuote: null, tags: ["Obituaries"] },
      promptVersion: "obituary-v1", model: "test", now: hrs(4),
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
      facts: { sessions: 1, killerGamertag: "Killer", weapon: "M4", timeAliveSeconds: 7200, kills: 0, longestKillMeters: null, cause: "pvp" },
      obituary: { headline: "Renamed Later", lede: "l", body: "b", pullQuote: null, tags: ["Obituaries"] },
      promptVersion: "obituary-v1", model: "test", now: hrs(7),
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
