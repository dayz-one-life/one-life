import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, articles } from "@onelife/db";
import { eq, and, inArray } from "drizzle-orm";
import { publishObituary, recordObituaryFailure, type ObituaryTarget } from "../src/pg-store.js";
import { publishBirthNotice, recordBirthNoticeFailure, type BirthNoticeTarget } from "../src/birth-pg-store.js";

// Guards the partial unique index added in migration 0014. Making
// `articles_kind_server_gamertag_life_uniq` partial (WHERE kind IN ('obituary','birth_notice'))
// means every ON CONFLICT that targets it must carry a matching `targetWhere` — without one
// Postgres raises 42P10 "no unique or exclusion constraint matching the ON CONFLICT
// specification" and publishing dies on the next newsdesk tick.
const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 53e7;
const t0 = new Date("2026-07-18T00:00:00Z");
const hrs = (h: number) => new Date(t0.getTime() + h * 3600_000);

let serverId: number;
const pids: number[] = [];
const lifeIds: number[] = [];

async function seedLife(tag: string, over: Record<string, unknown>) {
  const [p] = await db.insert(players).values({ gamertag: tag }).returning();
  pids.push(p!.id);
  const [l] = await db
    .insert(lives)
    .values({ serverId, playerId: p!.id, lifeNumber: 1, startedAt: hrs(0), ...over })
    .returning();
  lifeIds.push(l!.id);
  return { lifeId: l!.id, gamertag: tag, lifeStartedAt: hrs(0) };
}

let dead: { lifeId: number; gamertag: string; lifeStartedAt: Date };
let alive: { lifeId: number; gamertag: string; lifeStartedAt: Date };
let failStub: { lifeId: number; gamertag: string; lifeStartedAt: Date };

beforeAll(async () => {
  const [s] = await db
    .insert(servers)
    .values({ nitradoServiceId: svc, name: "pi", map: "chernarusplus", slug: `pi-${svc}`, active: true })
    .returning();
  serverId = s!.id;
  dead = await seedLife(`pi-o-${svc}`, { endedAt: hrs(2), deathCause: "pvp", playtimeSeconds: 7200 });
  alive = await seedLife(`pi-b-${svc}`, { playtimeSeconds: 7200 });
  failStub = await seedLife(`pi-f-${svc}`, { endedAt: hrs(4), deathCause: "pvp", playtimeSeconds: 7200 });
});

afterAll(async () => {
  await db.delete(articles).where(eq(articles.serverId, serverId));
  await db.delete(lives).where(inArray(lives.id, lifeIds));
  await db.delete(players).where(inArray(players.id, pids));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

const obitTarget = (o: typeof dead): ObituaryTarget => ({
  lifeId: o.lifeId, serverId, gamertag: o.gamertag, map: "chernarusplus",
  mapSlug: `pi-${svc}`, lifeNumber: 1, lifeStartedAt: o.lifeStartedAt, endedAt: hrs(2),
});
const birthTarget = (o: typeof alive): BirthNoticeTarget => ({
  lifeId: o.lifeId, serverId, gamertag: o.gamertag, map: "chernarusplus",
  mapSlug: `pi-${svc}`, lifeNumber: 1, lifeStartedAt: o.lifeStartedAt, endedAt: null,
});

const rowsFor = (kind: string, gamertag: string) =>
  db.select().from(articles).where(and(eq(articles.kind, kind), eq(articles.gamertag, gamertag)));

describe("partial unique index: article upserts still conflict-resolve", () => {
  it("publishes an obituary twice — upserts in place, attempts = 2", async () => {
    const target = obitTarget(dead);
    const facts = { sessions: 1, killerGamertag: "Killer", weapon: "M4", timeAliveSeconds: 7200, kills: 3, longestKillMeters: 90, cause: "pvp" };
    const base = { target, facts, promptVersion: "obituary-v2", model: "test", now: hrs(5) };
    await publishObituary(db, { ...base, obituary: { headline: "Gone First", lede: "l1", body: "b1", pullQuote: null, tags: ["Obituaries"] } });
    await publishObituary(db, { ...base, obituary: { headline: "Gone Second", lede: "l2", body: "b2", pullQuote: null, tags: ["Obituaries"] } });

    const rows = await rowsFor("obituary", dead.gamertag);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.attempts).toBe(2);
    expect(rows[0]!.headline).toBe("Gone Second");
    expect(rows[0]!.status).toBe("published");
  });

  it("publishes a birth notice twice — upserts in place, attempts = 2", async () => {
    const target = birthTarget(alive);
    const facts = { minutesToQualify: 6, persona: null, isKnownQuantity: false };
    const base = { target, facts, promptVersion: "birth-v1", model: "test", now: hrs(5) };
    await publishBirthNotice(db, { ...base, notice: { headline: "Ashore First", lede: "l1", body: "b1", pullQuote: null, tags: ["Fresh Spawns"] } });
    await publishBirthNotice(db, { ...base, notice: { headline: "Ashore Second", lede: "l2", body: "b2", pullQuote: null, tags: ["Fresh Spawns"] } });

    const rows = await rowsFor("birth_notice", alive.gamertag);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.attempts).toBe(2);
    expect(rows[0]!.headline).toBe("Ashore Second");
    expect(rows[0]!.status).toBe("published");
  });

  it("records an obituary failure stub twice — upserts in place, attempts = 2", async () => {
    const target = obitTarget(failStub);
    await recordObituaryFailure(db, { target, error: "boom-1" });
    await recordObituaryFailure(db, { target, error: "boom-2" });

    const rows = await rowsFor("obituary", failStub.gamertag);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.attempts).toBe(2);
    expect(rows[0]!.status).toBe("failed");
    expect(rows[0]!.lastError).toBe("boom-2");
  });

  it("records a birth-notice failure stub twice — upserts in place, attempts = 2", async () => {
    const target = birthTarget(alive);
    // Same life already has a published notice: the stub must conflict onto that same row.
    await recordBirthNoticeFailure(db, { target, error: "birth-boom-1" });
    await recordBirthNoticeFailure(db, { target, error: "birth-boom-2" });

    const rows = await rowsFor("birth_notice", alive.gamertag);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.attempts).toBe(4); // 2 publishes + 2 failures on the same row
    expect(rows[0]!.status).toBe("failed");
    expect(rows[0]!.lastError).toBe("birth-boom-2");
  });
});
