import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { servers, players, lives, sessions, positions } from "@onelife/db";
import { eq, and } from "drizzle-orm";
import { applyEvent } from "@onelife/projections";
import { PgProjectionStore } from "../src/pg-store.js";
import { getTestDb } from "@onelife/test-support";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 6e8;
let serverId: number;

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "pgstore-test" }).returning();
  serverId = s!.id;
});
afterAll(async () => {
  // Delete child rows before players: no ON DELETE CASCADE on lives.player_id (schema uses "no action").
  await db.delete(positions).where(eq(positions.serverId, serverId));
  await db.delete(sessions).where(eq(sessions.serverId, serverId));
  await db.delete(lives).where(eq(lives.serverId, serverId));
  await db.delete(players).where(eq(players.serverId, serverId));
  await sql.end();
});

describe("PgProjectionStore", () => {
  it("creates and reads a player, and tracks open life", async () => {
    await db.transaction(async (tx) => {
      const store = new PgProjectionStore(tx as any);
      const p = await store.createPlayer(serverId, "PG", "PG=", new Date("2026-07-06T12:00:00Z"));
      expect(await store.getPlayer(serverId, "PG")).toMatchObject({ id: p.id, gamertag: "PG" });
      expect(await store.getMaxLifeNumber(serverId, p.id)).toBe(0);
      const life = await store.createLife(serverId, p.id, 1, new Date("2026-07-06T12:00:00Z"));
      expect(await store.getOpenLife(serverId, p.id)).toMatchObject({ id: life.id });
    });
  });

  // The superseded/reboot close cap reads the player's last_seen_at through the store —
  // this proves the pg mapping (getPlayer/getPlayerById expose lastSeenAt) and the capped
  // closeSession Date binding against the real driver, end-to-end through applyEvent.
  it("caps a superseded close at last_seen_at through the real store (fold end-to-end)", async () => {
    await db.transaction(async (tx) => {
      const store = new PgProjectionStore(tx as any);
      await applyEvent(store, { id: 1, serverId, type: "player.connected", occurredAt: new Date("2026-07-06T12:00:00Z"), payload: { gamertag: "CAP", dayzId: "CAP=" } });
      await applyEvent(store, { id: 2, serverId, type: "player.position", occurredAt: new Date("2026-07-06T12:10:00Z"), payload: { gamertag: "CAP", x: 1, y: 2 } });
      await applyEvent(store, { id: 3, serverId, type: "player.connected", occurredAt: new Date("2026-07-06T15:00:00Z"), payload: { gamertag: "CAP", dayzId: "CAP=" } });
      const p = await store.getPlayerById((await store.getPlayer(serverId, "CAP"))!.id);
      expect(p!.lastSeenAt).toEqual(new Date("2026-07-06T15:00:00Z")); // touched by the reconnect
      const closed = await tx.select().from(sessions)
        .where(and(eq(sessions.serverId, serverId), eq(sessions.closeReason, "superseded")));
      expect(closed).toHaveLength(1);
      expect(closed[0]!.disconnectedAt).toEqual(new Date("2026-07-06T12:10:00Z")); // heartbeat, not reconnect
      expect(closed[0]!.durationSeconds).toBe(600);
      const life = (await tx.select().from(lives).where(and(eq(lives.serverId, serverId), eq(lives.playerId, p!.id))))[0]!;
      expect(life.playtimeSeconds).toBe(600); // offline gap not counted
    });
  });

  // Regression: findLifeIdAt binds a Date into its WHERE clause. Raw sql fragments
  // aren't column-type-aware, so a bare Date crashed postgres.js ("Received an
  // instance of Date" for a string param). Column-aware operators fix the binding.
  it("findLifeIdAt attributes a timestamp to the open life (Date param binds correctly)", async () => {
    await db.transaction(async (tx) => {
      const store = new PgProjectionStore(tx as any);
      const p = await store.createPlayer(serverId, "FLA", "FLA=", new Date("2026-07-06T10:00:00Z"));
      const life = await store.createLife(serverId, p.id, 1, new Date("2026-07-06T10:00:00Z"));
      // a moment inside the open (unended) life
      const hit = await store.findLifeIdAt(serverId, p.id, new Date("2026-07-06T10:30:00Z"));
      expect(hit).toBe(life.id);
      // a moment before the life started → no match
      const before = await store.findLifeIdAt(serverId, p.id, new Date("2026-07-06T09:00:00Z"));
      expect(before).toBeNull();
    });
  });

  it("endLife persists death stats; getRecentlyEndedLifeId + enrichLifeDeath upgrade the cluster", async () => {
    await db.transaction(async (tx) => {
      const store = new PgProjectionStore(tx as any);
      const p = await store.createPlayer(serverId, "STATS", "STATS=", new Date("2026-07-12T01:00:00Z"));
      const life = await store.createLife(serverId, p.id, 1, new Date("2026-07-12T01:00:00Z"));
      const lifeId = life.id;
      const playerId = p.id;

      const at = new Date("2026-07-12T01:05:41.000Z");
      await store.endLife(lifeId, { endedAt: at, cause: "died", byGamertag: null, weapon: null, distance: null,
        energy: 0, water: 620.083, bleedSources: 1 });

      const found = await store.getRecentlyEndedLifeId(serverId, playerId, at);
      expect(found).toBe(lifeId);

      await store.enrichLifeDeath(lifeId, { cause: "suicide", energy: null, water: null, bleedSources: null });
      const row = (await tx.select().from(lives).where(eq(lives.id, lifeId)))[0]!;
      expect(row.deathCause).toBe("suicide");
      expect(row.energyAtDeath).toBe(0);
      expect(row.waterAtDeath).toBeCloseTo(620.083);
      expect(row.bleedSourcesAtDeath).toBe(1);
    });
  });
});
