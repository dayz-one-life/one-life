import type { EventType } from "@onelife/domain";

export type ProjectionEvent = {
  id: number;
  serverId: number;
  type: EventType;
  occurredAt: Date;
  payload: Record<string, unknown>;
};

export type PlayerRow = { id: number; gamertag: string; lastSeenAt: Date | null };
export type LifeRow = { id: number; playerId: number; lifeNumber: number; startedAt: Date; endedAt: Date | null };
export type SessionRow = { id: number; playerId: number; lifeId: number; connectedAt: Date };

export type EndLife = {
  endedAt: Date; cause: string; byGamertag: string | null; weapon: string | null; distance: number | null;
  energy?: number | null; water?: number | null; bleedSources?: number | null;
};
export type KillInput = {
  serverId: number; killerGamertag: string; killerPlayerId: number | null;
  victimGamertag: string; victimPlayerId: number | null; victimLifeId: number | null;
  weapon: string | null; distance: number | null; occurredAt: Date;
};
export type HitInput = {
  serverId: number; victimGamertag: string; victimPlayerId: number | null;
  attackerGamertag: string | null; attackerType: string; attackerLabel: string | null;
  bodyPart: string | null; victimHp: number | null; x: number | null; y: number | null; occurredAt: Date;
};
export type BuildInput = {
  serverId: number; gamertag: string; playerId: number | null; lifeId: number | null;
  action: string; object: string; className: string | null; tool: string | null;
  x: number | null; y: number | null; occurredAt: Date;
};
export type PositionInput = { serverId: number; playerId: number; gamertag: string; x: number; y: number; recordedAt: Date };
