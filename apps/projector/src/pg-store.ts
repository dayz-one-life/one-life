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

  async getPlayer(serverId: number, gamertag: string): Promise<PlayerRow | null> {
    const r = await this.tx.select().from(players)
      .where(and(eq(players.serverId, serverId), eq(players.gamertag, gamertag)));
    return r[0] ? { id: r[0].id, gamertag: r[0].gamertag, currentLifeId: r[0].currentLifeId, lastSeenAt: r[0].lastSeenAt } : null;
  }
  async getPlayerById(playerId: number): Promise<PlayerRow | null> {
    const r = await this.tx.select().from(players).where(eq(players.id, playerId));
    return r[0] ? { id: r[0].id, gamertag: r[0].gamertag, currentLifeId: r[0].currentLifeId, lastSeenAt: r[0].lastSeenAt } : null;
  }
  async createPlayer(serverId: number, gamertag: string, dayzId: string | null, seenAt: Date): Promise<PlayerRow> {
    const [row] = await this.tx.insert(players)
      .values({ serverId, gamertag, dayzId, firstSeenAt: seenAt, lastSeenAt: seenAt })
      .onConflictDoUpdate({ target: [players.serverId, players.gamertag], set: { lastSeenAt: seenAt } })
      .returning();
    return { id: row!.id, gamertag: row!.gamertag, currentLifeId: row!.currentLifeId, lastSeenAt: row!.lastSeenAt };
  }
  async touchPlayer(playerId: number, lastSeenAt: Date): Promise<void> {
    await this.tx.update(players).set({ lastSeenAt }).where(eq(players.id, playerId));
  }
  async setCurrentLife(playerId: number, lifeId: number | null): Promise<void> {
    await this.tx.update(players).set({ currentLifeId: lifeId }).where(eq(players.id, playerId));
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
