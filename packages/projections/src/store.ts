import type {
  PlayerRow, LifeRow, SessionRow, EndLife,
  KillInput, HitInput, BuildInput, PositionInput,
} from "./types.js";

export interface ProjectionStore {
  getPlayer(gamertag: string): Promise<PlayerRow | null>;
  getPlayerById(playerId: number): Promise<PlayerRow | null>;
  /** Resolve a player by their stable DayZ account hash. The identity lookup. */
  getPlayerByDayzId(dayzId: string): Promise<PlayerRow | null>;
  createPlayer(gamertag: string, dayzId: string | null, seenAt: Date): Promise<PlayerRow>;
  /**
   * Record that `playerId` was seen under `gamertag`, and make it their current name.
   * Idempotent: a repeat connect under the same name only extends last_seen_at.
   */
  recordGamertag(playerId: number, gamertag: string, seenAt: Date): Promise<void>;
  touchPlayer(playerId: number, lastSeenAt: Date): Promise<void>;

  getOpenLife(serverId: number, playerId: number): Promise<LifeRow | null>;
  getMaxLifeNumber(serverId: number, playerId: number): Promise<number>;
  createLife(serverId: number, playerId: number, lifeNumber: number, startedAt: Date): Promise<LifeRow>;
  endLife(lifeId: number, ended: EndLife): Promise<void>;
  addLifePlaytime(lifeId: number, seconds: number): Promise<void>;
  findLifeIdAt(serverId: number, playerId: number, at: Date): Promise<number | null>;
  getRecentlyEndedLifeId(serverId: number, playerId: number, endedAt: Date): Promise<number | null>;
  enrichLifeDeath(lifeId: number, patch: { cause: string; energy: number | null; water: number | null; bleedSources: number | null }): Promise<void>;

  getOpenSession(serverId: number, playerId: number): Promise<SessionRow | null>;
  getAllOpenSessions(serverId: number): Promise<SessionRow[]>;
  createSession(serverId: number, playerId: number, lifeId: number, connectedAt: Date): Promise<void>;
  closeSession(sessionId: number, disconnectedAt: Date, durationSeconds: number, closeReason: string): Promise<void>;

  insertKill(k: KillInput): Promise<void>;
  insertHit(h: HitInput): Promise<void>;
  insertBuild(b: BuildInput): Promise<void>;
  insertPosition(p: PositionInput): Promise<void>;
}
