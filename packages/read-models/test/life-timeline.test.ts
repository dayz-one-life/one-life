import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, sessions, kills, hitEvents, articles } from "@onelife/db";
import { inArray, eq } from "drizzle-orm";
import { getLifeTimeline } from "../src/life-timeline.js";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 51e7;
const start = new Date("2026-07-14T00:00:00Z");
const mins = (m: number) => new Date(start.getTime() + m * 60_000);
let serverId: number;
let pid: number;
let deadLifeId: number;
let openLifeId: number;

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "lt", map: "sakhal", slug: `lt-${svc}`, active: true }).returning();
  serverId = s!.id;
  const [p] = await db.insert(players).values({ gamertag: `LtHero-${svc}`, lastSeenAt: mins(400) }).returning();
  pid = p!.id;
  const [dl] = await db.insert(lives).values({
    serverId, playerId: pid, lifeNumber: 1, startedAt: start, endedAt: mins(360),
    deathCause: "pvp", deathByGamertag: "SomeKiller", deathWeapon: "VSD", deathDistance: 126,
    energyAtDeath: 42, waterAtDeath: 18, bleedSourcesAtDeath: 2, playtimeSeconds: 21600,
  }).returning();
  deadLifeId = dl!.id;
  await db.insert(sessions).values([
    { serverId, playerId: pid, lifeId: deadLifeId, connectedAt: start, disconnectedAt: mins(180), durationSeconds: 10800, closeReason: "disconnect" },
    { serverId, playerId: pid, lifeId: deadLifeId, connectedAt: mins(200), disconnectedAt: mins(360), durationSeconds: 9600, closeReason: "death" },
  ]);
  await db.insert(kills).values({
    serverId, killerGamertag: `LtHero-${svc}`, victimGamertag: "Victim1", weapon: "KAS-74U", distance: 25, occurredAt: mins(120),
  });
  await db.insert(hitEvents).values({
    serverId, victimGamertag: `LtHero-${svc}`, attackerType: "player", attackerGamertag: "SomeKiller",
    victimHp: 30, occurredAt: new Date(mins(360).getTime() - 20_000),
  });

  // An OPEN life (no endedAt), started after the dead life ended — the dossier must not be
  // fetched for it, so verdict/ordeals/hpLow must all come back null.
  const [ol] = await db.insert(lives).values({
    serverId, playerId: pid, lifeNumber: 2, startedAt: mins(400), endedAt: null,
    playtimeSeconds: 0,
  }).returning();
  openLifeId = ol!.id;
  await db.insert(sessions).values({
    serverId, playerId: pid, lifeId: openLifeId, connectedAt: mins(400), disconnectedAt: null, durationSeconds: null, closeReason: null,
  });
});

afterAll(async () => {
  await db.delete(articles).where(inArray(articles.slug, [`lt-obit-${svc}`, `lt-obit-wrong-${svc}`]));
  await db.delete(hitEvents).where(inArray(hitEvents.serverId, [serverId]));
  await db.delete(kills).where(inArray(kills.serverId, [serverId]));
  await db.delete(sessions).where(inArray(sessions.serverId, [serverId]));
  await db.delete(lives).where(inArray(lives.serverId, [serverId]));
  await db.delete(players).where(inArray(players.id, [pid]));
  await db.delete(servers).where(inArray(servers.id, [serverId]));
  await sql.end();
});

describe("getLifeTimeline", () => {
  it("returns life + ordered sessions + kills + qualifiedAt", async () => {
    const t = await getLifeTimeline(db, serverId, `LtHero-${svc}`, deadLifeId);
    expect(t).not.toBeNull();
    expect(t!.life.lifeNumber).toBe(1);
    expect(t!.sessions).toHaveLength(2);
    expect(t!.kills).toHaveLength(1);
    expect(t!.kills[0]!.victimGamertag).toBe("Victim1");
    // qualified: candidates are {playtime crossing @+5m into the first 180m session,
    // kill @120m, pvp-death @360m} → earliest is the playtime crossing (verified against
    // packages/read-models/test/qualified-at.test.ts, which asserts the identical
    // "crosses 5 minutes into a long session" behavior of lifeQualifiedAt).
    expect(t!.qualifiedAt?.by).toBe("playtime");
  });

  it("returns the player's lastSeenAt heartbeat", async () => {
    const t = await getLifeTimeline(db, serverId, `LtHero-${svc}`, deadLifeId);
    expect(t).not.toBeNull();
    expect(t!.lastSeenAt).toEqual(mins(400));
  });

  it("returns null for an unknown life", async () => {
    expect(await getLifeTimeline(db, serverId, `LtHero-${svc}`, 9_999_999)).toBeNull();
  });

  it("carries the classified verdict, ordeals, and hpLow for a dead life", async () => {
    const t = await getLifeTimeline(db, serverId, `LtHero-${svc}`, deadLifeId);
    expect(t).not.toBeNull();
    // Stated pvp mechanism passes through at high confidence.
    expect(t!.verdict).toMatchObject({ cause: "pvp", confidence: "high" });
    expect(t!.ordeals!.pvp.encounters).toBe(1);
    expect(t!.hpLow).toBe(30);
  });

  it("does not fetch a dossier for an open life — verdict, ordeals, and hpLow are all null", async () => {
    const t = await getLifeTimeline(db, serverId, `LtHero-${svc}`, openLifeId);
    expect(t).not.toBeNull();
    expect(t!.life.endedAt).toBeNull();
    expect(t!.verdict).toBeNull();
    expect(t!.ordeals).toBeNull();
    expect(t!.hpLow).toBeNull();
  });
});

describe("obituarySlug", () => {
  it("is null when the paper has not written about this life", async () => {
    const t = await getLifeTimeline(db, serverId, `LtHero-${svc}`, deadLifeId);
    expect(t!.obituarySlug).toBeNull();
  });

  it("finds a published obituary for this exact life", async () => {
    await db.insert(articles).values({
      kind: "obituary", status: "published", slug: `lt-obit-${svc}`,
      serverId, gamertag: `LtHero-${svc}`, lifeNumber: 1, lifeStartedAt: start,
      headline: "Last Light On The Ridge", body: "x", deathAt: mins(360),
    });
    const t = await getLifeTimeline(db, serverId, `LtHero-${svc}`, deadLifeId);
    expect(t!.obituarySlug).toBe(`lt-obit-${svc}`);
  });

  it("ignores a retracted article for the same life", async () => {
    // A retraction is a public correction, not the life's obituary. Linking it would present a
    // withdrawn story as the record of this death.
    await db.update(articles).set({ status: "retracted" }).where(eq(articles.slug, `lt-obit-${svc}`));
    const t = await getLifeTimeline(db, serverId, `LtHero-${svc}`, deadLifeId);
    expect(t!.obituarySlug).toBeNull();
  });

  it("REGRESSION: does not match an article that shares life_number but belongs to a different life", async () => {
    // A published obituary for the SAME server + gamertag + life_number as deadLifeId (1), but
    // with a DIFFERENT life_started_at (it actually belongs to openLifeId's life). Under the old
    // `eq(articles.lifeNumber, life.lifeNumber)` predicate this row would wrongly match
    // deadLifeId's timeline. The correct natural key — (server_id, gamertag, life_started_at) —
    // must reject it, because life_number is a derived count that can drift from the real life
    // while life_started_at (frozen at generation time) cannot.
    await db.insert(articles).values({
      kind: "obituary", status: "published", slug: `lt-obit-wrong-${svc}`,
      serverId, gamertag: `LtHero-${svc}`, lifeNumber: 1, lifeStartedAt: mins(400),
      headline: "Wrong Life, Right Number", body: "x", deathAt: mins(400),
    });
    const t = await getLifeTimeline(db, serverId, `LtHero-${svc}`, deadLifeId);
    expect(t!.obituarySlug).toBeNull();
  });
});
