import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { servers, players, lives, sessions, positions, playerGamertags } from "@onelife/db";
import { eq, and, inArray } from "drizzle-orm";
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
  // players is global (no server_id) as of the global-player migration, so scope the cleanup by
  // the gamertags this suite creates rather than by serverId.
  await db.delete(positions).where(eq(positions.serverId, serverId));
  await db.delete(sessions).where(eq(sessions.serverId, serverId));
  await db.delete(lives).where(eq(lives.serverId, serverId));
  await db.delete(players).where(inArray(players.gamertag, ["PG", "CAP", "FLA", "STATS", "Zed", "IDN-New", "IDN-Recycled"]));
  await sql.end();
});

describe("PgProjectionStore", () => {
  it("creates and reads a player, and tracks open life", async () => {
    await db.transaction(async (tx) => {
      const store = new PgProjectionStore(tx as any);
      const p = await store.createPlayer("PG", "PG=", new Date("2026-07-06T12:00:00Z"));
      expect(await store.getPlayer("PG")).toMatchObject({ id: p.id, gamertag: "PG" });
      expect(await store.getMaxLifeNumber(serverId, p.id)).toBe(0);
      const life = await store.createLife(serverId, p.id, 1, new Date("2026-07-06T12:00:00Z"));
      expect(await store.getOpenLife(serverId, p.id)).toMatchObject({ id: life.id });
    });
  });

  // Superseded by identity-by-hash: createPlayer no longer upserts on the gamertag, so a
  // second call under the same name is a second identity. getPlayer is a LABEL lookup and
  // resolves to the earliest holder; identity resolution is getPlayerByDayzId.
  it("createPlayer is unconditional; getPlayer resolves the label to one row", async () => {
    await expect(db.transaction(async (tx) => {
      const store = new PgProjectionStore(tx as any);
      const a = await store.createPlayer("Zed", "ZEDA=", new Date("2026-07-01"));
      const b = await store.createPlayer("Zed", "ZEDB=", new Date("2026-07-02"));
      expect(b.id).not.toBe(a.id);
      expect((await store.getPlayer("Zed"))?.id).toBe(a.id);
      tx.rollback();
    })).rejects.toThrow(/rollback/i);
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
      const p = await store.getPlayerById((await store.getPlayer("CAP"))!.id);
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
      const p = await store.createPlayer("FLA", "FLA=", new Date("2026-07-06T10:00:00Z"));
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
      const p = await store.createPlayer("STATS", "STATS=", new Date("2026-07-12T01:00:00Z"));
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

  it("resolves an existing player when the ADM re-cases their gamertag", async () => {
    const tag = `Recase${Math.floor(Math.random() * 1e8)}`;
    await db.insert(players).values({ gamertag: tag, dayzId: `D=${tag}` });
    const store = new PgProjectionStore(db);
    const found = await store.getPlayer(tag.toLowerCase());
    expect(found).not.toBeNull();
    expect(found!.gamertag).toBe(tag); // the stored casing is returned, not the queried one
    await db.delete(players).where(eq(players.gamertag, tag));
  });

  it("resolves by dayz_id and records every gamertag the player is seen under", async () => {
    // Exercises the RAW-SQL upsert against real Postgres: an expression conflict target
    // (player_id, lower(gamertag)) is only reachable this way, and a wrong target fails at
    // RUNTIME with "no unique or exclusion constraint matching the ON CONFLICT specification".
    // NOTE: rollback-scoped. `.rejects.toThrow(/rollback/i)` rather than a bare catch — a
    // swallowed rejection would let an assertion failure inside the transaction pass silently.
    await expect(db.transaction(async (tx) => {
      const store = new PgProjectionStore(tx as any);
      const p = await store.createPlayer("IDN-Old", "IDN=", new Date("2026-07-06T12:00:00Z"));
      await store.recordGamertag(p.id, "IDN-Old", new Date("2026-07-06T12:00:00Z"));

      expect(await store.getPlayerByDayzId("IDN=")).toMatchObject({ id: p.id });
      expect(await store.getPlayerByDayzId("NOPE=")).toBeNull();

      // a rename: same player row, current name follows, both aliases retained
      await store.recordGamertag(p.id, "IDN-New", new Date("2026-07-08T12:00:00Z"));
      expect((await store.getPlayerById(p.id))!.gamertag).toBe("IDN-New");

      // idempotent + GREATEST: repeat, then an out-of-order replay that must not rewind
      await store.recordGamertag(p.id, "IDN-New", new Date("2026-07-09T12:00:00Z"));
      await store.recordGamertag(p.id, "idn-new", new Date("2026-07-01T12:00:00Z"));
      const rows = await tx.select().from(playerGamertags)
        .where(eq(playerGamertags.playerId, p.id)).orderBy(playerGamertags.firstSeenAt);
      expect(rows.map((r) => r.gamertag)).toEqual(["IDN-Old", "IDN-New"]);
      const renamed = rows[1]!;
      expect(renamed.firstSeenAt.toISOString()).toBe("2026-07-08T12:00:00.000Z");
      expect(renamed.lastSeenAt.toISOString()).toBe("2026-07-09T12:00:00.000Z");
      tx.rollback();
    })).rejects.toThrow(/rollback/i);
  });

  // players.gamertag is a CURRENT LABEL, not an identity. The recycling end state is two
  // identities whose current label is the same string — legal only once players_gamertag_uniq
  // is gone (migration 0025 replaces it with the non-unique players_gamertag_idx). Against the
  // unique index this raises 23505.
  it("two players with different hashes may both hold the same current gamertag", async () => {
    await expect(db.transaction(async (tx) => {
      const store = new PgProjectionStore(tx as any);
      const a = await store.createPlayer("DUP-Label", "DUPA=", new Date("2026-07-06T12:00:00Z"));
      const b = await store.createPlayer("DUP-Other", "DUPB=", new Date("2026-07-08T12:00:00Z"));
      // b is recycled onto the name a still carries
      await store.recordGamertag(b.id, "dup-label", new Date("2026-07-09T12:00:00Z"));
      expect(b.id).not.toBe(a.id);
      expect((await store.getPlayerById(a.id))!.gamertag).toBe("DUP-Label");
      expect((await store.getPlayerById(b.id))!.gamertag).toBe("dup-label");
      tx.rollback();
    })).rejects.toThrow(/rollback/i);
  });

  // The silent-merge defect: with ON CONFLICT (lower(gamertag)) DO UPDATE … RETURNING, a NEW
  // account hash first seen under a name someone still holds returned the INCUMBENT's row, and
  // every life, kill and position of the new player was attributed to the previous owner.
  it("createPlayer for a new hash under an existing name creates a NEW player", async () => {
    await expect(db.transaction(async (tx) => {
      const store = new PgProjectionStore(tx as any);
      const incumbent = await store.createPlayer("NEWHASH", "NHA=", new Date("2026-07-06T12:00:00Z"));
      const fresh = await store.createPlayer("NEWHASH", "NHB=", new Date("2026-07-08T12:00:00Z"));
      expect(fresh.id).not.toBe(incumbent.id);
      expect(fresh.gamertag).toBe("NEWHASH");
      expect(fresh.lastSeenAt).toEqual(new Date("2026-07-08T12:00:00Z"));
      // the incumbent is untouched — not even its last_seen_at was bumped by the DO UPDATE
      expect((await store.getPlayerById(incumbent.id))!.lastSeenAt)
        .toEqual(new Date("2026-07-06T12:00:00Z"));
      expect(await store.getPlayerByDayzId("NHA=")).toMatchObject({ id: incumbent.id });
      expect(await store.getPlayerByDayzId("NHB=")).toMatchObject({ id: fresh.id });
      tx.rollback();
    })).rejects.toThrow(/rollback/i);
  });

  it("a recycled gamertag under a different hash resolves to a different player", async () => {
    await expect(db.transaction(async (tx) => {
      const store = new PgProjectionStore(tx as any);
      const a = await store.createPlayer("IDN-Recycled", "RECA=", new Date("2026-07-06T12:00:00Z"));
      await store.recordGamertag(a.id, "IDN-Recycled", new Date("2026-07-06T12:00:00Z"));
      // the first owner renames away, freeing the name
      await store.recordGamertag(a.id, "IDN-Moved", new Date("2026-07-07T12:00:00Z"));
      const b = await store.createPlayer("IDN-Recycled", "RECB=", new Date("2026-07-08T12:00:00Z"));
      await store.recordGamertag(b.id, "IDN-Recycled", new Date("2026-07-08T12:00:00Z"));
      expect(b.id).not.toBe(a.id);
      expect(await store.getPlayerByDayzId("RECA=")).toMatchObject({ id: a.id });
      expect(await store.getPlayerByDayzId("RECB=")).toMatchObject({ id: b.id });
      tx.rollback();
    })).rejects.toThrow(/rollback/i);
  });
});
