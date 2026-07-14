export type Server = {
  id: number;
  nitradoServiceId: number;
  name: string;
  map: string;
  slug: string | null;
  active: boolean;
  clockOffsetMs: number;
  createdAt: string;
};

export type RosterEntry = { gamertag: string; sessionSeconds: number; lifeSeconds: number };
export type GlobalRosterEntry = RosterEntry & { map: string; slug: string };

export type Profile = {
  gamertag: string;
  lives: number;
  deaths: number;
  totalPlaytimeSeconds: number;
  currentLifeSeconds: number;
  alive: boolean;
  lastSeenAt: string | null;
};

export type Life = {
  id: number;
  serverId: number;
  playerId: number;
  lifeNumber: number;
  startedAt: string;
  endedAt: string | null;
  deathCause: string | null;
  deathByGamertag: string | null;
  deathWeapon: string | null;
  deathDistance: number | null;
  playtimeSeconds: number;
};

export type Session = {
  id: number;
  serverId: number;
  playerId: number;
  lifeId: number;
  connectedAt: string;
  disconnectedAt: string | null;
  durationSeconds: number | null;
  closeReason: string | null;
};

export type LifeDetail = { life: Life; sessions: Session[] };

export type LeaderRow = { gamertag: string; value: number; detail?: Record<string, unknown> };
export type GlobalLeaderRow = LeaderRow & { map: string; slug: string };

export type Kill = {
  id: number;
  serverId: number;
  killerGamertag: string;
  killerPlayerId: number | null;
  victimGamertag: string;
  victimPlayerId: number | null;
  victimLifeId: number | null;
  weapon: string | null;
  distance: number | null;
  occurredAt: string;
};

export type Build = {
  id: number;
  serverId: number;
  gamertag: string;
  playerId: number | null;
  lifeId: number | null;
  action: string;
  object: string;
  className: string | null;
  tool: string | null;
  x: number | null;
  y: number | null;
  occurredAt: string;
};

export type Challenge = { sequence: string[]; progressIndex: number; expiresAt: string; expired: boolean };

export type GamertagLink = {
  id: number;
  serverId: number;
  gamertag: string;
  status: "pending" | "verified" | "cancelled";
  verifiedAt: string | null;
  challenge: Challenge | null;
};

export type ClaimResult = {
  linkId: number;
  serverId: number;
  gamertag: string;
  status: "pending";
  challenge: Challenge;
};

export type Me = {
  user: { id: string; name: string; email: string; image: string | null };
  accounts: Array<{ providerId: string; accountId: string }>;
};

export type PlayerMapStats = {
  map: string;
  slug: string;
  profile: Profile;
  kills: number;
  longestLifeSeconds: number;
};

export type PlayerAggregate = {
  gamertag: string;
  perMap: PlayerMapStats[];
  totals: {
    lives: number;
    deaths: number;
    kills: number;
    totalPlaytimeSeconds: number;
    longestLifeSeconds: number;
    aliveAnywhere: boolean;
  };
};
