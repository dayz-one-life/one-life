import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, sessions, kills, hitEvents, user, gamertagLinks, avatars } from "@onelife/db";
import { inArray } from "drizzle-orm";
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
    serverId, killerGamertag: `LtHero-${svc}`, killerPlayerId: pid, victimGamertag: "Victim1", weapon: "KAS-74U", distance: 25, occurredAt: mins(120),
  });
  await db.insert(hitEvents).values({
    serverId, victimGamertag: `LtHero-${svc}`, victimPlayerId: pid, attackerType: "player", attackerGamertag: "SomeKiller",
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

  describe("avatarHash", () => {
    const avatarPid: number[] = [];
    const avatarLifeIds: number[] = [];
    const avatarUserIds: string[] = [];

    afterAll(async () => {
      if (avatarLifeIds.length) await db.delete(sessions).where(inArray(sessions.lifeId, avatarLifeIds));
      if (avatarLifeIds.length) await db.delete(lives).where(inArray(lives.id, avatarLifeIds));
      if (avatarPid.length) await db.delete(players).where(inArray(players.id, avatarPid));
      if (avatarUserIds.length) {
        await db.delete(avatars).where(inArray(avatars.userId, avatarUserIds));
        await db.delete(gamertagLinks).where(inArray(gamertagLinks.userId, avatarUserIds));
        await db.delete(user).where(inArray(user.id, avatarUserIds));
      }
    });

    async function makeLife(gamertag: string) {
      const [p] = await db.insert(players).values({ gamertag, lastSeenAt: mins(400) }).returning();
      avatarPid.push(p!.id);
      const [l] = await db.insert(lives).values({
        serverId, playerId: p!.id, lifeNumber: 1, startedAt: start, endedAt: mins(360),
        deathCause: "pvp", playtimeSeconds: 21600,
      }).returning();
      avatarLifeIds.push(l!.id);
      return { p: p!, l: l! };
    }

    // `imageNull: true` pairs a non-null hash with a NULL image to isolate the
    // `image IS NOT NULL` join clause, independent of what a real tombstone (null hash) looks like.
    async function link(userId: string, gamertag: string, status: "pending" | "verified", hash: string | null, imageNull = false) {
      await db.insert(user).values({ id: userId, name: userId, email: `${userId}@example.com` });
      avatarUserIds.push(userId);
      await db.insert(gamertagLinks).values({ userId, gamertag, status, verifiedAt: status === "verified" ? mins(400) : null });
      await db.insert(avatars).values({
        userId, image: imageNull ? null : Buffer.from("fake-avatar-bytes"), hash, source: imageNull ? null : "upload", updatedAt: mins(400),
      });
    }

    it("attaches avatarHash for a verified player with a live avatar", async () => {
      const gt = `AvHero-${svc}`;
      const { l } = await makeLife(gt);
      await link(`u-avhero-${svc}`, gt, "verified", "livehash");
      const t = await getLifeTimeline(db, serverId, gt, l.id);
      expect(t!.avatarHash).toBe("livehash");
    });

    it("returns null avatarHash for a player with no gamertag link at all", async () => {
      const gt = `AvNoLink-${svc}`;
      const { l } = await makeLife(gt);
      const t = await getLifeTimeline(db, serverId, gt, l.id);
      expect(t!.avatarHash).toBeNull();
    });

    it("returns null avatarHash when the avatar is tombstoned", async () => {
      const gt = `AvTomb-${svc}`;
      const { l } = await makeLife(gt);
      await link(`u-avtomb-${svc}`, gt, "verified", "ghosthash", true);
      const t = await getLifeTimeline(db, serverId, gt, l.id);
      expect(t!.avatarHash).toBeNull();
    });

    it("returns null avatarHash for a pending (unverified) gamertag link", async () => {
      const gt = `AvPending-${svc}`;
      const { l } = await makeLife(gt);
      await link(`u-avpending-${svc}`, gt, "pending", "pendinghash");
      const t = await getLifeTimeline(db, serverId, gt, l.id);
      expect(t!.avatarHash).toBeNull();
    });
  });
});
