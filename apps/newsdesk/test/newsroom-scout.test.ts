import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, sessions, hitEvents } from "@onelife/db";
import { inArray, eq } from "drizzle-orm";
import { scout, type ScoutReport } from "../src/newsroom/scout.js";

/** Key names that would carry a raw map coordinate if one leaked through. Ported from
 *  news-facts.test.ts — test-local by convention; the newsdesk suite has no shared helper module. */
const COORDINATE_KEYS = new Set(["x", "y", "posX", "posY", "coordX", "coordY", "lat", "lon"]);

/** Recursive key-presence walk (the PR-C1 rail): proves the Fog Rule by SHAPE, not by
 *  pattern-matching a coordinate-looking number, which /\d{4}\.\d/ fails to do near a map's
 *  low edge (e.g. "812.4"). */
function collectKeys(value: unknown, keys: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
  } else if (value !== null && typeof value === "object") {
    for (const [key, val] of Object.entries(value)) {
      keys.add(key);
      collectKeys(val, keys);
    }
  }
  return keys;
}

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 56e7;
const t0 = new Date("2026-07-01T00:00:00.000Z");
const hrs = (h: number) => new Date(t0.getTime() + h * 3_600_000);
const NOW = hrs(200);
const tag = (n: string) => `scout-${n}-${svc}`;
let serverId: number;
const pids: number[] = [];

/** An idle Standing Dead shape: prior life (earned coverage), open qualified life, last seen
 *  well past the 72h threshold. */
async function seedIdle(name: string) {
  const [p] = await db.insert(players).values({ gamertag: tag(name), lastSeenAt: hrs(2) }).returning();
  pids.push(p!.id);
  await db.insert(lives).values({
    serverId, playerId: p!.id, lifeNumber: 1, startedAt: hrs(0),
    endedAt: hrs(0.5), deathCause: "pvp", playtimeSeconds: 1800,
  });
  const [l] = await db.insert(lives).values({
    serverId, playerId: p!.id, lifeNumber: 2, startedAt: hrs(1),
    endedAt: null, deathCause: null, playtimeSeconds: 3600,
  }).returning();
  await db.insert(sessions).values({
    serverId, playerId: p!.id, lifeId: l!.id,
    connectedAt: hrs(1), disconnectedAt: hrs(2), durationSeconds: 3600, closeReason: "disconnect",
  });
}

beforeAll(async () => {
  const [s] = await db.insert(servers).values({
    nitradoServiceId: svc, name: "scout", map: "sakhal", slug: `scout-${svc}`, active: true,
  }).returning();
  serverId = s!.id;
  await seedIdle("idle");
  await seedIdle("hush");   // suppressed below
});

afterAll(async () => {
  await db.delete(hitEvents).where(eq(hitEvents.serverId, serverId));
  await db.delete(sessions).where(eq(sessions.serverId, serverId));
  await db.delete(lives).where(eq(lives.serverId, serverId));
  await db.delete(players).where(inArray(players.id, pids));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

describe("newsroom scout", () => {
  let report: ScoutReport;

  beforeAll(async () => {
    report = await scout(db, NOW, { suppressedGamertags: [tag("hush")] });
  });

  it("tips the idle Standing Dead subject with display fields only", () => {
    const tip = report.standingDead.find((t) => t.gamertag === tag("idle"));
    expect(tip).toBeDefined();
    expect(tip!.map).toBe("sakhal");
    expect(tip!.idleDays).toBeGreaterThanOrEqual(8);
  });

  it("excludes suppressed gamertags", () => {
    expect(report.standingDead.some((t) => t.gamertag === tag("hush"))).toBe(false);
  });

  it("returns the long-form list (empty here — no co-located deaths seeded)", () => {
    expect(Array.isArray(report.longForm)).toBe(true);
  });

  it("digests per-map aggregates including the seeded map", () => {
    const row = report.aggregates.find((a) => a.map === "sakhal");
    expect(row).toBeDefined();
    expect(row!.players).toBeGreaterThanOrEqual(2);
    expect(row!.medianLifeMinutes).not.toBeNull();
  });

  it("carries no coordinate-shaped key at any depth (Fog Rule)", () => {
    const keys = collectKeys(report);
    for (const forbidden of COORDINATE_KEYS) {
      expect(keys.has(forbidden)).toBe(false);
    }
  });
});
