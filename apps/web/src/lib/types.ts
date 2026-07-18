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
  energyAtDeath: number | null;
  waterAtDeath: number | null;
  bleedSourcesAtDeath: number | null;
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
  gamertag: string;
  status: "pending" | "verified" | "cancelled";
  verifiedAt: string | null;
  challenge: Challenge | null;
};

export type ClaimResult = {
  linkId: number;
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

export type AuthMethods = {
  providers: string[];
  magicLink: boolean;
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

export type PlayerCharacter = { name: string | null; head: string | null; gender: string | null };
export type PlayerKill = { victimGamertag: string; weapon: string | null; distanceMeters: number | null; occurredAt: string };
export type AliveStanding = { lifeId: number; lifeNumber: number; startedAt: string; timeAliveSeconds: number; kills: number; longestKillMeters: number | null; killList: PlayerKill[] };
export type BanStanding = { banId: number; bannedAt: string; expiresAt: string | null; liftPending: boolean; triggeringLifeNumber: number | null };
export type ServerStanding = { serverId: number; map: string; slug: string; state: "alive" | "banned" | "idle"; character: PlayerCharacter | null; alive: AliveStanding | null; ban: BanStanding | null };
export type PastLife = { lifeId: number; serverId: number; map: string; slug: string; lifeNumber: number; startedAt: string; endedAt: string; timeAliveSeconds: number; kills: number; longestKillMeters: number | null; character: PlayerCharacter | null; death: { cause: string | null; byGamertag: string | null; weapon: string | null; distanceMeters: number | null }; vitals: { energy: number | null; water: number | null; bleedSources: number | null }; sessions: number; killList: PlayerKill[] };
export type PlayerPage = { gamertag: string; verified: boolean; firstSeenAt: string | null; aliveAnywhere: boolean; totals: { kills: number; lives: number; deaths: number; longestLifeSeconds: number }; standing: ServerStanding[]; pastLives: PastLife[]; pastLivesTotal: number; pastLivesPage: number; pastLivesPageSize: number };

export type SurvivorSort = "kills" | "time" | "longest";
export interface SurvivorCharacter { name: string | null; head: string | null; gender: string | null; }
export interface SurvivorRow { gamertag: string; map: string; slug: string; timeAliveSeconds: number; killsThisLife: number; longestKillMeters: number | null; character: SurvivorCharacter | null; }
export interface SurvivorsPage { rows: SurvivorRow[]; total: number; page: number; pageSize: number; sort: SurvivorSort; }

export type LifeCharacterDto = { charId: number; characterClass: string | null; name: string | null; gender: string | null; sightings: number; confidence: "exact" | "ambiguous" };
export type QualifiedAtDto = { at: string; by: "playtime" | "kill" | "pvp-death" };
export type LifeTimelineData = {
  life: Life;
  sessions: Session[];
  character: LifeCharacterDto | null;
  kills: PlayerKill[];
  qualifiedAt: QualifiedAtDto | null;
  gamertag: string;
  map: string;
  slug: string;
};

export type ObituaryCard = {
  slug: string;
  gamertag: string;
  map: string;
  mapSlug: string | null;
  lifeNumber: number;
  headline: string;
  lede: string;
  tags: string[];
  timeAliveSeconds: number;
  kills: number;
  longestKillMeters: number | null;
  cause: string | null;
  deathAt: string;
};
export type ObituariesFeed = { rows: ObituaryCard[]; total: number; page: number; pageSize: number };
export type ObituaryArticle = ObituaryCard & {
  body: string;
  pullQuote: { text: string; attribution: string } | null;
  sessions: number;
  killerGamertag: string | null;
  weapon: string | null;
};

export type BirthNoticeCard = {
  slug: string;
  gamertag: string;
  map: string;
  mapSlug: string | null;
  lifeNumber: number;
  headline: string;
  lede: string;
  tags: string[];
  bornAt: string;
  minutesToQualify: number | null;
  priorLives: number;
};
export type BirthNoticesFeed = { rows: BirthNoticeCard[]; total: number; page: number; pageSize: number };
export type BirthNoticeArticle = BirthNoticeCard & {
  body: string;
  pullQuote: { text: string; attribution: string } | null;
  priors: {
    livesLived: number;
    longestLifeSeconds: number;
    totalKills: number;
    usualDeathCause: string | null;
    lastDeathCause: string | null;
    bestLifeMap: string | null;
  };
  endedAt: string | null;
};
