import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, articles } from "@onelife/db";
import { eq, inArray } from "drizzle-orm";
import { findObituaryTargets, publishObituary, recordObituaryFailure, obituarySlug, findUnpostedObituaries, markObituaryPosted, type ObituaryTarget } from "../src/pg-store.js";

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
  const [l] = await db.insert(lives).values({ serverId, playerId: p!.id, lifeNumber: 1, startedAt: hrs(0), ...over }).returning();
  lifeIds.push(l!.id);
  return { lifeId: l!.id, gamertag: tag, lifeStartedAt: hrs(0) };
}

let qualified: { lifeId: number; gamertag: string; lifeStartedAt: Date };
let unqualified: { lifeId: number; gamertag: string; lifeStartedAt: Date };

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
    const targets = await findObituaryTargets(db, { limit: 50, maxAttempts: 3 });
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
    const targets = await findObituaryTargets(db, { limit: 50, maxAttempts: 3 });
    expect(targets.find((t) => t.lifeId === qualified.lifeId)).toBeUndefined();
    const [row] = await db.select().from(articles).where(eq(articles.gamertag, qualified.gamertag));
    expect(row!.status).toBe("published");
    expect(row!.slug).toMatch(/^gone-nd-q-/);
    expect(row!.slug!.endsWith(`-${serverId}-1`)).toBe(true);
    expect(row!.attempts).toBe(1);
  });

  it("re-includes a failed life until maxAttempts, then drops it", async () => {
    const un = targetFor(unqualified, 3); // reuse row as a generic life; force qualification via a fresh qualified life
    const q2 = await seedLife(`nd-q2-${svc}`, { lifeNumber: 1, endedAt: hrs(5), deathCause: "pvp", playtimeSeconds: 7200 });
    await recordObituaryFailure(db, { target: targetFor(q2, 5), error: "boom-1" });
    let targets = await findObituaryTargets(db, { limit: 50, maxAttempts: 3 });
    expect(targets.find((t) => t.lifeId === q2.lifeId)).toBeDefined(); // attempts 1 < 3
    await recordObituaryFailure(db, { target: targetFor(q2, 5), error: "boom-2" });
    await recordObituaryFailure(db, { target: targetFor(q2, 5), error: "boom-3" });
    targets = await findObituaryTargets(db, { limit: 50, maxAttempts: 3 });
    expect(targets.find((t) => t.lifeId === q2.lifeId)).toBeUndefined(); // attempts 3 >= 3
    void un;
  });
});

describe("findUnpostedObituaries + markObituaryPosted", () => {
  const dtag = `nd-d-${svc}`;
  const idsToClean: number[] = [];
  let artSeq = 0;

  // Each seeded article needs a distinct lifeStartedAt — the natural-key unique index is
  // (kind, serverId, gamertag, lifeStartedAt); reusing dtag+lifeStartedAt would collide.
  async function seedArticle(over: Record<string, unknown>) {
    artSeq += 1;
    const [a] = await db
      .insert(articles)
      .values({
        kind: "obituary",
        status: "published",
        serverId,
        gamertag: dtag,
        map: "chernarusplus",
        lifeNumber: artSeq,
        lifeStartedAt: hrs(100 + artSeq),
        deathAt: hrs(1),
        ...over,
      })
      .returning();
    idsToClean.push(a!.id);
    return a!.id;
  }

  it("selects only published+slugged+unposted rows, oldest death first, and honors the limit", async () => {
    const older = await seedArticle({ slug: `older-${svc}`, deathAt: hrs(1) });
    const newer = await seedArticle({ slug: `newer-${svc}`, deathAt: hrs(5) });
    await seedArticle({ slug: `posted-${svc}`, deathAt: hrs(2), discordPostedAt: hrs(3) }); // already posted → excluded
    await seedArticle({ slug: `failed-${svc}`, deathAt: hrs(2), status: "failed" }); // not published → excluded
    await seedArticle({ slug: null, deathAt: hrs(2) }); // no slug → excluded

    const rows = await findUnpostedObituaries(db, { limit: 50 });
    const mine = rows.filter((r) => r.gamertag === dtag);
    expect(mine.map((r) => r.id)).toEqual([older, newer]); // oldest death first
    expect(mine[0]!.slug).toBe(`older-${svc}`);

    // LIMIT is honored (there are ≥2 unposted rows present, so a limit of 1 returns exactly 1).
    const capped = await findUnpostedObituaries(db, { limit: 1 });
    expect(capped).toHaveLength(1);
  });

  it("markObituaryPosted stamps the row so it is not re-selected", async () => {
    const id = await seedArticle({ slug: `mark-${svc}`, deathAt: hrs(9) });
    expect((await findUnpostedObituaries(db, { limit: 50 })).some((r) => r.id === id)).toBe(true);
    await markObituaryPosted(db, id, hrs(10));
    expect((await findUnpostedObituaries(db, { limit: 50 })).some((r) => r.id === id)).toBe(false);
  });

  afterAll(async () => {
    if (idsToClean.length) await db.delete(articles).where(inArray(articles.id, idsToClean));
  });
});
