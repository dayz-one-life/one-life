import type { Database } from "@onelife/db";
import { players, lives, sessions, kills, hitEvents, buildEvents, positions } from "@onelife/db";
import { and, eq, isNull, sql, desc, lte, gt, or } from "drizzle-orm";
import type {
  ProjectionStore, PlayerRow, LifeRow, SessionRow, EndLife,
  KillInput, HitInput, BuildInput, PositionInput,
} from "@onelife/projections";

// tx is a Drizzle transaction handle (same surface as Database).
export class PgProjectionStore implements ProjectionStore {
  constructor(private tx: Database) {}

  async getPlayer(gamertag: string): Promise<PlayerRow | null> {
    // Case-insensitive: Xbox reserves gamertags case-insensitively, so a re-cased name is
    // the same human and a bare eq() would miss it and mint a second identity. This is a
    // label lookup, not an identity lookup — identity is getPlayerByDayzId — and since
    // migration 0025 lower(gamertag) is no longer unique, so limit to the first match.
    const r = await this.tx.select().from(players)
      .where(sql`lower(${players.gamertag}) = lower(${gamertag})`)
      .orderBy(players.id).limit(1);
    return r[0] ? { id: r[0].id, gamertag: r[0].gamertag, lastSeenAt: r[0].lastSeenAt } : null;
  }
  async getPlayerById(playerId: number): Promise<PlayerRow | null> {
    const r = await this.tx.select().from(players).where(eq(players.id, playerId));
    return r[0] ? { id: r[0].id, gamertag: r[0].gamertag, lastSeenAt: r[0].lastSeenAt } : null;
  }
  async createPlayer(gamertag: string, dayzId: string | null, seenAt: Date): Promise<PlayerRow> {
    // A PLAIN INSERT — deliberately no ON CONFLICT. Migration 0025 dropped
    // players_gamertag_uniq (gamertag is a current label, not an identity), so
    // `ON CONFLICT (lower(gamertag))` no longer names any unique index and would fail at
    // RUNTIME with "no unique or exclusion constraint matching the ON CONFLICT specification".
    // The old DO UPDATE … RETURNING was worse than merely unsupported: a NEW account hash first
    // seen under a name someone still held returned the INCUMBENT's row, silently attributing
    // the new player's lives, kills and positions to the previous owner.
    //
    // Unconditional insert is safe here: the projector is single-instance, the fold runs inside
    // a transaction, and onConnected resolves by dayz_id (getPlayerByDayzId) before it ever
    // calls createPlayer — so this cannot race itself into a duplicate identity.
    //
    // Raw SQL is retained (rather than the query builder) for the RETURNING shape below. Two
    // things the raw path does NOT do for you, both verified against postgres-js 3.4.9:
    //   1. A `Date` bound as a raw parameter THROWS ("The 'string' argument must be of type
    //      string ... Received an instance of Date") — the driver only serialises Dates through
    //      drizzle's typed builder. Hence toISOString(); the column is timestamptz and Postgres
    //      parses the ISO string.
    //   2. RETURNING comes back untyped: `id` is a bigint STRING (not the number the query
    //      builder maps `bigint mode:"number"` to), and a timestamptz comes back as a raw
    //      Postgres string, not a Date — drizzle's `.execute()` bypasses the driver's type
    //      parsers. PlayerRow declares `id: number` and `lastSeenAt: Date | null`, so both are
    //      converted here. A bare cast would satisfy the compiler and hand the fold a string id.
    //
    // The timestamp is therefore returned as epoch MILLISECONDS rather than as the timestamptz
    // itself. Postgres renders a timestamptz as "2026-07-22 19:17:56.505482+00" — a space
    // separator, microsecond precision and a two-digit offset, none of which are in the
    // Date Time String Format ECMA-262 defines. `new Date()` on that string only works by way
    // of V8's implementation-defined fallback parser. An integer millisecond count has one
    // meaning in every engine.
    const at = seenAt.toISOString();
    const rows = await this.tx.execute(sql`
      INSERT INTO players (gamertag, dayz_id, first_seen_at, last_seen_at)
      VALUES (${gamertag}, ${dayzId}, ${at}, ${at})
      RETURNING id, gamertag, (extract(epoch from last_seen_at) * 1000)::bigint AS last_seen_ms
    `);
    const row = (rows as unknown as Array<{ id: string; gamertag: string; last_seen_ms: string | null }>)[0]!;
    return {
      id: Number(row.id),
      gamertag: row.gamertag,
      lastSeenAt: row.last_seen_ms === null ? null : new Date(Number(row.last_seen_ms)),
    };
  }
  async touchPlayer(playerId: number, lastSeenAt: Date): Promise<void> {
    await this.tx.update(players).set({ lastSeenAt }).where(eq(players.id, playerId));
  }
  async getPlayerByDayzId(dayzId: string): Promise<PlayerRow | null> {
    const r = await this.tx.select().from(players).where(eq(players.dayzId, dayzId)).limit(1);
    return r[0] ? { id: r[0].id, gamertag: r[0].gamertag, lastSeenAt: r[0].lastSeenAt } : null;
  }
  async recordGamertag(playerId: number, gamertag: string, seenAt: Date): Promise<void> {
    // Raw SQL because drizzle 0.36.4 types IndexColumn = PgColumn, so an expression conflict
    // target — player_gamertags_player_name_uniq is on (player_id, lower(gamertag)) — cannot be
    // expressed through the query builder, and a column target fails at RUNTIME rather than
    // compile time.
    // Same Date hazard as createPlayer: a JS Date bound as a raw parameter throws, hence
    // toISOString(); the ::timestamptz casts stop GREATEST() seeing an unknown-typed literal.
    const at = seenAt.toISOString();
    await this.tx.execute(sql`
      INSERT INTO player_gamertags (player_id, gamertag, first_seen_at, last_seen_at)
      VALUES (${playerId}, ${gamertag}, ${at}::timestamptz, ${at}::timestamptz)
      ON CONFLICT (player_id, lower(gamertag))
      DO UPDATE SET last_seen_at = GREATEST(player_gamertags.last_seen_at, ${at}::timestamptz)
    `);
    await this.tx.update(players).set({ gamertag }).where(eq(players.id, playerId));
  }
  async getOpenLife(serverId: number, playerId: number): Promise<LifeRow | null> {
    const r = await this.tx.select().from(lives)
      .where(and(eq(lives.serverId, serverId), eq(lives.playerId, playerId), isNull(lives.endedAt)));
    const l = r[0];
    return l ? { id: l.id, playerId: l.playerId, lifeNumber: l.lifeNumber, startedAt: l.startedAt, endedAt: l.endedAt } : null;
  }
  async getMaxLifeNumber(serverId: number, playerId: number): Promise<number> {
    const r = await this.tx.select({ m: sql<number>`coalesce(max(${lives.lifeNumber}), 0)` }).from(lives)
      .where(and(eq(lives.serverId, serverId), eq(lives.playerId, playerId)));
    return Number(r[0]?.m ?? 0);
  }
  async createLife(serverId: number, playerId: number, lifeNumber: number, startedAt: Date): Promise<LifeRow> {
    const [row] = await this.tx.insert(lives).values({ serverId, playerId, lifeNumber, startedAt }).returning();
    return { id: row!.id, playerId, lifeNumber, startedAt, endedAt: null };
  }
  async endLife(lifeId: number, e: EndLife): Promise<void> {
    await this.tx.update(lives).set({
      endedAt: e.endedAt, deathCause: e.cause, deathByGamertag: e.byGamertag, deathWeapon: e.weapon, deathDistance: e.distance,
      energyAtDeath: e.energy ?? null, waterAtDeath: e.water ?? null, bleedSourcesAtDeath: e.bleedSources ?? null,
    }).where(eq(lives.id, lifeId));
  }
  async addLifePlaytime(lifeId: number, seconds: number): Promise<void> {
    await this.tx.update(lives).set({ playtimeSeconds: sql`${lives.playtimeSeconds} + ${seconds}` }).where(eq(lives.id, lifeId));
  }
  async getRecentlyEndedLifeId(serverId: number, playerId: number, endedAt: Date): Promise<number | null> {
    const rows = await this.tx.select({ id: lives.id }).from(lives)
      .where(and(eq(lives.serverId, serverId), eq(lives.playerId, playerId), eq(lives.endedAt, endedAt)))
      .orderBy(desc(lives.id)).limit(1);
    return rows[0]?.id ?? null;
  }
  async enrichLifeDeath(lifeId: number, patch: { cause: string; energy: number | null; water: number | null; bleedSources: number | null }): Promise<void> {
    await this.tx.update(lives).set({
      deathCause: sql`CASE WHEN ${lives.deathCause} = 'died' AND ${patch.cause} NOT IN ('died','unknown') THEN ${patch.cause} ELSE ${lives.deathCause} END`,
      energyAtDeath: sql`COALESCE(${lives.energyAtDeath}, ${patch.energy})`,
      waterAtDeath: sql`COALESCE(${lives.waterAtDeath}, ${patch.water})`,
      bleedSourcesAtDeath: sql`COALESCE(${lives.bleedSourcesAtDeath}, ${patch.bleedSources})`,
    }).where(eq(lives.id, lifeId));
  }
  async findLifeIdAt(serverId: number, playerId: number, at: Date): Promise<number | null> {
    // Use column-aware operators (not raw sql`` fragments): they carry the
    // timestamptz type so the Date param binds correctly. A raw sql fragment
    // passes a bare Date that postgres.js text-serializes and crashes on.
    const r = await this.tx.select({ id: lives.id }).from(lives).where(and(
      eq(lives.serverId, serverId), eq(lives.playerId, playerId),
      lte(lives.startedAt, at), or(isNull(lives.endedAt), gt(lives.endedAt, at)),
    )).orderBy(desc(lives.startedAt)).limit(1);
    return r[0]?.id ?? null;
  }
  async getOpenSession(serverId: number, playerId: number): Promise<SessionRow | null> {
    const r = await this.tx.select().from(sessions)
      .where(and(eq(sessions.serverId, serverId), eq(sessions.playerId, playerId), isNull(sessions.disconnectedAt)));
    const s = r[0];
    return s ? { id: s.id, playerId: s.playerId, lifeId: s.lifeId, connectedAt: s.connectedAt } : null;
  }
  async getAllOpenSessions(serverId: number): Promise<SessionRow[]> {
    const r = await this.tx.select().from(sessions)
      .where(and(eq(sessions.serverId, serverId), isNull(sessions.disconnectedAt)));
    return r.map((s) => ({ id: s.id, playerId: s.playerId, lifeId: s.lifeId, connectedAt: s.connectedAt }));
  }
  async createSession(serverId: number, playerId: number, lifeId: number, connectedAt: Date): Promise<void> {
    await this.tx.insert(sessions).values({ serverId, playerId, lifeId, connectedAt });
  }
  async closeSession(sessionId: number, disconnectedAt: Date, durationSeconds: number, closeReason: string): Promise<void> {
    await this.tx.update(sessions).set({ disconnectedAt, durationSeconds, closeReason }).where(eq(sessions.id, sessionId));
  }
  async insertKill(k: KillInput): Promise<void> {
    await this.tx.insert(kills).values(k).onConflictDoNothing({ target: [kills.serverId, kills.victimLifeId] });
  }
  async insertHit(h: HitInput): Promise<void> {
    await this.tx.insert(hitEvents).values(h).onConflictDoNothing({
      target: [hitEvents.serverId, hitEvents.victimGamertag, hitEvents.attackerGamertag, hitEvents.attackerType, hitEvents.bodyPart, hitEvents.occurredAt],
    });
  }
  async insertBuild(b: BuildInput): Promise<void> {
    await this.tx.insert(buildEvents).values(b).onConflictDoNothing({
      target: [buildEvents.serverId, buildEvents.gamertag, buildEvents.action, buildEvents.object, buildEvents.occurredAt],
    });
  }
  async insertPosition(p: PositionInput): Promise<void> { await this.tx.insert(positions).values(p); }
}
