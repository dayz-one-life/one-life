import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, articles } from "@onelife/db";
import { and, eq, inArray } from "drizzle-orm";
import {
  findBirthNoticeTargets, publishBirthNotice, recordBirthNoticeFailure, birthNoticeSlug,
  type BirthNoticeTarget,
} from "../src/birth-pg-store.js";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 53e7;
const t0 = new Date("2026-07-17T00:00:00Z");
const hrs = (h: number) => new Date(t0.getTime() + h * 3600_000);
const since = hrs(1);
let serverId: number;
const pids: number[] = [];
const lifeIds: number[] = [];

const aliveTag = `nb-alive-${svc}`;
const deadTag = `nb-dead-${svc}`;
const unqTag = `nb-unq-${svc}`;
const beforeTag = `nb-before-${svc}`;

async function seedLife(tag: string, over: Record<string, unknown>) {
  const [p] = await db.insert(players).values({ gamertag: tag }).returning();
  pids.push(p!.id);
  const [l] = await db.insert(lives).values({ serverId, playerId: p!.id, lifeNumber: 1, startedAt: hrs(0), ...over }).returning();
  lifeIds.push(l!.id);
  return { lifeId: l!.id, gamertag: tag, lifeStartedAt: l!.startedAt };
}

let aliveObj: { lifeId: number; gamertag: string; lifeStartedAt: Date };

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "nb", map: "chernarusplus", slug: `nb-${svc}`, active: true }).returning();
  serverId = s!.id;
  // qualified + alive (playtime >= 5 min), born after the cutoff
  aliveObj = await seedLife(aliveTag, { lifeNumber: 1, startedAt: hrs(2), playtimeSeconds: 7200 });
  // qualified + already dead (pvp) before the sweep, born after the cutoff
  await seedLife(deadTag, { lifeNumber: 1, startedAt: hrs(2), endedAt: hrs(4), deathCause: "pvp", deathByGamertag: "Killer", deathWeapon: "M4", deathDistance: 90, playtimeSeconds: 7200 });
  // NOT qualified: 60s, no kills, alive
  await seedLife(unqTag, { lifeNumber: 1, startedAt: hrs(2), playtimeSeconds: 60 });
  // qualified but born BEFORE the cutoff -> excluded by `since`
  await seedLife(beforeTag, { lifeNumber: 1, startedAt: hrs(0), playtimeSeconds: 7200 });
});
afterAll(async () => {
  await db.delete(articles).where(eq(articles.serverId, serverId));
  await db.delete(lives).where(inArray(lives.id, lifeIds));
  await db.delete(players).where(inArray(players.id, pids));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

const targetFor = (
  o: { lifeId: number; gamertag: string; lifeStartedAt: Date },
  endedAt: Date | null,
): BirthNoticeTarget => ({
  lifeId: o.lifeId, serverId, gamertag: o.gamertag,
  map: "chernarusplus", mapSlug: `nb-${svc}`, lifeNumber: 1, lifeStartedAt: o.lifeStartedAt, endedAt,
});

describe("birthNoticeSlug", () => {
  it("composes a stable unique slug from headline + gamertag + server + life number", () => {
    expect(birthNoticeSlug("Another Fool Washes Ashore", "xX_Sn1per_Xx", 7, 4)).toBe("another-fool-washes-ashore-xx-sn1per-xx-7-4");
  });
});

describe("findBirthNoticeTargets", () => {
  it("returns qualified alive-or-dead lives since the cutoff, excludes unqualified and pre-cutoff", async () => {
    const targets = await findBirthNoticeTargets(db, { since, limit: 50, maxAttempts: 3 });
    const mine = targets.filter((t) => t.mapSlug === `nb-${svc}`).map((t) => t.gamertag);
    expect(mine).toContain(aliveTag);
    expect(mine).toContain(deadTag);
    expect(mine).not.toContain(unqTag);
    expect(mine).not.toContain(beforeTag);
  });

  it("carries a null endedAt for an alive spawn and the death time for one already dead", async () => {
    const targets = await findBirthNoticeTargets(db, { since, limit: 50, maxAttempts: 3 });
    const alive = targets.find((t) => t.gamertag === aliveTag);
    const dead = targets.find((t) => t.gamertag === deadTag);
    expect(alive!.endedAt).toBeNull();
    expect(dead!.endedAt?.toISOString()).toBe(hrs(4).toISOString());
  });

  it("excludes a life that already has a published birth notice (death_at NULL while alive)", async () => {
    await publishBirthNotice(db, {
      target: targetFor(aliveObj, null),
      facts: { minutesToQualify: 6, persona: "Lewis", isKnownQuantity: false },
      notice: { headline: "Washed Ashore", lede: "l", body: "b", pullQuote: null, tags: ["Fresh Spawns"] },
      promptVersion: "birth-v1", model: "test", now: hrs(5),
    });
    const targets = await findBirthNoticeTargets(db, { since, limit: 50, maxAttempts: 3 });
    expect(targets.find((t) => t.gamertag === aliveTag)).toBeUndefined();
    const [row] = await db.select().from(articles).where(and(eq(articles.gamertag, aliveTag), eq(articles.kind, "birth_notice")));
    expect(row!.status).toBe("published");
    expect(row!.kind).toBe("birth_notice");
    expect(row!.deathAt).toBeNull();
    expect(row!.slug).toMatch(/^washed-ashore-nb-alive-/);
    expect(row!.slug!.endsWith(`-${serverId}-1`)).toBe(true);
    expect(row!.attempts).toBe(1);
  });

  it("re-includes a failed life until maxAttempts, then drops it", async () => {
    const q2 = await seedLife(`nb-q2-${svc}`, { lifeNumber: 1, startedAt: hrs(2), playtimeSeconds: 7200 });
    await recordBirthNoticeFailure(db, { target: targetFor(q2, null), error: "boom-1" });
    let targets = await findBirthNoticeTargets(db, { since, limit: 50, maxAttempts: 3 });
    expect(targets.find((t) => t.gamertag === q2.gamertag)).toBeDefined(); // attempts 1 < 3
    await recordBirthNoticeFailure(db, { target: targetFor(q2, null), error: "boom-2" });
    await recordBirthNoticeFailure(db, { target: targetFor(q2, null), error: "boom-3" });
    targets = await findBirthNoticeTargets(db, { since, limit: 50, maxAttempts: 3 });
    expect(targets.find((t) => t.gamertag === q2.gamertag)).toBeUndefined(); // attempts 3 >= 3
  });
});
