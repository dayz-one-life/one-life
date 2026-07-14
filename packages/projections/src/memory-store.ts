import type { ProjectionStore } from "./store.js";
import type {
  PlayerRow, LifeRow, SessionRow, EndLife,
  KillInput, HitInput, BuildInput, PositionInput,
} from "./types.js";

type FullLife = LifeRow & { serverId: number };
type FullSession = SessionRow & { serverId: number; disconnectedAt: Date | null; durationSeconds?: number; closeReason?: string };
type LifeElement = FullLife & {
  playtimeSeconds: number;
  deathCause?: string;
  deathByGamertag?: string | null;
  deathWeapon?: string | null;
  deathDistance?: number | null;
  energyAtDeath?: number | null;
  waterAtDeath?: number | null;
  bleedSourcesAtDeath?: number | null;
};

export class MemoryStore implements ProjectionStore {
  players: (PlayerRow & { serverId: number; dayzId: string | null; firstSeenAt: Date; lastSeenAt: Date })[] = [];
  lives: LifeElement[] = [];
  sessions: FullSession[] = [];
  kills: KillInput[] = [];
  hits: HitInput[] = [];
  builds: BuildInput[] = [];
  positions: PositionInput[] = [];
  private seq = 1;

  async getPlayer(serverId: number, gamertag: string): Promise<PlayerRow | null> {
    return this.players.find((p) => p.serverId === serverId && p.gamertag === gamertag) ?? null;
  }
  async getPlayerById(playerId: number): Promise<PlayerRow | null> {
    return this.players.find((p) => p.id === playerId) ?? null;
  }
  async createPlayer(serverId: number, gamertag: string, dayzId: string | null, seenAt: Date): Promise<PlayerRow> {
    const row = { id: this.seq++, serverId, gamertag, dayzId, currentLifeId: null, firstSeenAt: seenAt, lastSeenAt: seenAt };
    this.players.push(row);
    return row;
  }
  async touchPlayer(playerId: number, lastSeenAt: Date): Promise<void> {
    const p = this.players.find((x) => x.id === playerId); if (p) p.lastSeenAt = lastSeenAt;
  }
  async setCurrentLife(playerId: number, lifeId: number | null): Promise<void> {
    const p = this.players.find((x) => x.id === playerId); if (p) p.currentLifeId = lifeId;
  }
  async getOpenLife(serverId: number, playerId: number): Promise<LifeRow | null> {
    return (this.lives as FullLife[]).find((l) => l.serverId === serverId && l.playerId === playerId && l.endedAt === null) ?? null;
  }
  async getMaxLifeNumber(serverId: number, playerId: number): Promise<number> {
    const nums = (this.lives as FullLife[]).filter((l) => l.serverId === serverId && l.playerId === playerId).map((l) => l.lifeNumber);
    return nums.length ? Math.max(...nums) : 0;
  }
  async createLife(serverId: number, playerId: number, lifeNumber: number, startedAt: Date): Promise<LifeRow> {
    const row = { id: this.seq++, serverId, playerId, lifeNumber, startedAt, endedAt: null, playtimeSeconds: 0 } as LifeElement;
    this.lives.push(row);
    return row;
  }
  async endLife(lifeId: number, ended: EndLife): Promise<void> {
    const l = (this.lives as LifeElement[]).find((x) => x.id === lifeId);
    if (l) {
      l.endedAt = ended.endedAt;
      l.deathCause = ended.cause;
      l.deathByGamertag = ended.byGamertag;
      l.deathWeapon = ended.weapon;
      l.deathDistance = ended.distance;
      l.energyAtDeath = ended.energy ?? null;
      l.waterAtDeath = ended.water ?? null;
      l.bleedSourcesAtDeath = ended.bleedSources ?? null;
    }
  }
  async getRecentlyEndedLifeId(serverId: number, playerId: number, endedAt: Date): Promise<number | null> {
    const l = (this.lives as LifeElement[])
      .filter((x) => x.serverId === serverId && x.playerId === playerId && x.endedAt?.getTime() === endedAt.getTime())
      .sort((a, b) => b.id - a.id)[0];
    return l ? l.id : null;
  }
  async enrichLifeDeath(lifeId: number, patch: { cause: string; energy: number | null; water: number | null; bleedSources: number | null }): Promise<void> {
    const l = (this.lives as LifeElement[]).find((x) => x.id === lifeId);
    if (!l) return;
    if (l.deathCause === "died" && patch.cause !== "died" && patch.cause !== "unknown") l.deathCause = patch.cause;
    if (l.energyAtDeath == null && patch.energy != null) l.energyAtDeath = patch.energy;
    if (l.waterAtDeath == null && patch.water != null) l.waterAtDeath = patch.water;
    if (l.bleedSourcesAtDeath == null && patch.bleedSources != null) l.bleedSourcesAtDeath = patch.bleedSources;
  }
  async addLifePlaytime(lifeId: number, seconds: number): Promise<void> {
    const l = this.lives.find((x) => x.id === lifeId) as (FullLife & { playtimeSeconds: number }) | undefined;
    if (l) l.playtimeSeconds += seconds;
  }
  async findLifeIdAt(serverId: number, playerId: number, at: Date): Promise<number | null> {
    const l = (this.lives as FullLife[]).find((x) => x.serverId === serverId && x.playerId === playerId
      && x.startedAt.getTime() <= at.getTime() && (x.endedAt === null || x.endedAt.getTime() > at.getTime()));
    return l ? l.id : null;
  }
  async getOpenSession(serverId: number, playerId: number): Promise<SessionRow | null> {
    return this.sessions.find((s) => s.serverId === serverId && s.playerId === playerId && s.disconnectedAt === null) ?? null;
  }
  async getAllOpenSessions(serverId: number): Promise<SessionRow[]> {
    return this.sessions.filter((s) => s.serverId === serverId && s.disconnectedAt === null);
  }
  async createSession(serverId: number, playerId: number, lifeId: number, connectedAt: Date): Promise<void> {
    this.sessions.push({ id: this.seq++, serverId, playerId, lifeId, connectedAt, disconnectedAt: null });
  }
  async closeSession(sessionId: number, disconnectedAt: Date, durationSeconds: number, closeReason: string): Promise<void> {
    const s = this.sessions.find((x) => x.id === sessionId);
    if (s) { s.disconnectedAt = disconnectedAt; (s as any).durationSeconds = durationSeconds; (s as any).closeReason = closeReason; }
  }
  async insertKill(k: KillInput): Promise<void> {
    if (k.victimLifeId != null && this.kills.some((x) => x.serverId === k.serverId && x.victimLifeId === k.victimLifeId)) return;
    this.kills.push(k);
  }
  async insertHit(h: HitInput): Promise<void> {
    const dup = this.hits.some((x) => x.serverId === h.serverId && x.victimGamertag === h.victimGamertag
      && x.attackerGamertag === h.attackerGamertag && x.attackerType === h.attackerType
      && x.bodyPart === h.bodyPart && x.occurredAt.getTime() === h.occurredAt.getTime());
    if (!dup) this.hits.push(h);
  }
  async insertBuild(b: BuildInput): Promise<void> { this.builds.push(b); }
  async insertPosition(p: PositionInput): Promise<void> { this.positions.push(p); }
}
