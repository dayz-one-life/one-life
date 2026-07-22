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
export type ServerStanding = { serverId: number; map: string; slug: string; state: "alive" | "banned" | "idle"; character: PlayerCharacter | null; alive: AliveStanding | null; ban: BanStanding | null; lastLifeNumber: number | null };
export type PastLife = { lifeId: number; serverId: number; map: string; slug: string; lifeNumber: number; startedAt: string; endedAt: string; timeAliveSeconds: number; kills: number; longestKillMeters: number | null; character: PlayerCharacter | null; death: { cause: string | null; byGamertag: string | null; weapon: string | null; distanceMeters: number | null; verdict: DeathVerdictDto | null }; vitals: { energy: number | null; water: number | null; bleedSources: number | null }; sessions: number; killList: PlayerKill[] };
export type PlayerPage = { gamertag: string; verified: boolean; firstSeenAt: string | null; aliveAnywhere: boolean; totals: { kills: number; lives: number; deaths: number; longestLifeSeconds: number }; standing: ServerStanding[]; pastLives: PastLife[]; pastLivesTotal: number; pastLivesPage: number; pastLivesPageSize: number };

/** Every published article that names this player — either as its subject or as the killer
 *  named in someone else's obituary (`role`). `createdAt` arrives as an ISO string over HTTP
 *  even though the server holds a `Date`. */
export type PlayerArticleRow = {
  kind: string;
  slug: string;
  headline: string;
  createdAt: string;
  role: "subject" | "killer";
  mapSlug: string | null;
};
export type PlayerArticlesFeed = { rows: PlayerArticleRow[]; total: number; page: number; pageSize: number };

export type SurvivorSort = "kills" | "time" | "longest";
export interface SurvivorCharacter { name: string | null; head: string | null; gender: string | null; }
export interface SurvivorRow { gamertag: string; map: string; slug: string; timeAliveSeconds: number; killsThisLife: number; longestKillMeters: number | null; character: SurvivorCharacter | null; }
export interface SurvivorsPage { rows: SurvivorRow[]; total: number; page: number; pageSize: number; sort: SurvivorSort; }

export type DeathVerdictDto = { cause: string; confidence: "high" | "low"; conditions: string[] };

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
  verdict: DeathVerdictDto | null;
  // Player heartbeat — caps live "time alive" accrual for an open life so it agrees with the
  // survivor board + dossier standing card (both stop at last-seen, not request-time `now`).
  lastSeenAt: string | null;
  // Slug of this life's published obituary, or null. Published only — see the read-model.
  obituarySlug: string | null;
};

/**
 * Rich-body block union (R5d). `articles.body_blocks` is jsonb and null for every article written
 * before R5d, so this is always optional — a null/absent value means "render the flat `body`".
 * A future block type an older client does not know about is dropped by the renderer, never thrown.
 */
export type ArticleBlock =
  | { type: "para"; text: string }
  | { type: "subhead"; text: string }
  | { type: "quote"; text: string; attribution: string }
  | { type: "list"; items: string[] };

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
  bodyBlocks?: ArticleBlock[] | null;
  pullQuote: { text: string; attribution: string } | null;
  sessions: number;
  killerGamertag: string | null;
  weapon: string | null;
  verdict: DeathVerdictDto | null;
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

/** The §6 live status — recomputed at request time, mirroring NewsSubjectStatus. A birth-notice
 *  subject is never presumed missing (no idle/returned branch), only whether the life it was filed
 *  about is still open. */
export type BirthNoticeSubjectStatus = { kind: "alive" } | { kind: "dead"; diedAt: string };

export type BirthNoticeArticle = BirthNoticeCard & {
  body: string;
  bodyBlocks?: ArticleBlock[] | null;
  pullQuote: { text: string; attribution: string } | null;
  priors: {
    livesLived: number;
    longestLifeSeconds: number;
    totalKills: number;
    usualDeathCause: string | null;
    lastDeathCause: string | null;
    bestLifeMap: string | null;
  };
  /** FROZEN — the article's own death_at snapshot as written. Never recomputed; kept for API
   *  stability. Use `subjectStatus` for the live read. */
  endedAt: string | null;
  subjectStatus: BirthNoticeSubjectStatus;
};

/** Named AppNotification to avoid shadowing the DOM's global Notification type,
 *  which the push permission flow depends on. */
export type AppNotification = {
  id: number;
  kind: string;
  title: string;
  body: string;
  href: string;
  createdAt: string;
  readAt: string | null;
};

/** `total` is what makes the backlog reachable: the panel's "Load older" control exists only
 *  while `page * pageSize < total`. `unreadCount` is the badge and counts the whole inbox,
 *  not this page. */
export type NotificationsFeed = {
  items: AppNotification[];
  unreadCount: number;
  total: number;
  page: number;
  pageSize: number;
};

export type NewsTrigger = "standing_dead" | "long_form";

export type NewsFormat = "standing_dead" | "long_form" | "editorial";

export type NewsSubjectRef = { gamertag: string; mapSlug: string | null; lifeNumber: number };

/** Subject fields are nullable because an editorial piece has no (server, gamertag, life) tuple —
 *  a card renderer must guard on `gamertag` before drawing any subject chrome. */
export type NewsCard = {
  slug: string;
  trigger: NewsTrigger;
  format: NewsFormat;
  editorialFormat: string | null;
  gamertag: string | null;
  map: string | null;
  mapSlug: string | null;
  lifeNumber: number | null;
  headline: string;
  lede: string;
  tags: string[];
  subjectCount: number;
  createdAt: string;
  /** Cache-versioned when a stored hero exists; null with no image. The home news lead renders
   *  it; the /news feed page stays text-only by choice. */
  imageUrl: string | null;
};
export type NewsFeed = { rows: NewsCard[]; total: number; page: number; pageSize: number };

/**
 * The §4.1.3 status line, computed server-side at request time. `idleDaysAtPublication` is the
 * FROZEN idle figure as of publication and is never recomputed against `now` — the whole point of
 * the line is that the paper reports what it knew when it printed, then corrects itself.
 */
export type NewsSubjectStatus =
  | { kind: "idle"; idleDaysAtPublication: number }
  | { kind: "returned"; seenAt: string }
  | { kind: "died"; diedAt: string; obituarySlug: string | null };

export type NewsArticle = NewsCard & {
  status: "published" | "draft" | "retracted";
  body: string;
  bodyBlocks?: ArticleBlock[] | null;
  pullQuote: { text: string; attribution: string } | null;
  imageUrl: string | null;
  imageCaption: string | null;
  retracted: boolean;
  timeAliveSeconds: number;
  kills: number;
  idleSeconds: number | null;
  spanSeconds: number | null;
  subjects: NewsSubjectRef[];
  subjectStatus: NewsSubjectStatus | null;
};

export interface TrackPointDto { x: number; y: number; at: string }
export interface TrackSegmentDto { sessionId: number; points: TrackPointDto[] }

/** Every marker is approximate — deaths and kills carry no recorded coordinates, so this
 *  is the last position fix before the event. `sampleAgeSeconds` is non-optional so a
 *  render site must actively discard it to omit the staleness. */
export interface TrackMarkerDto {
  kind: "kill" | "death" | "now";
  at: string;
  x: number;
  y: number;
  sampleAt: string;
  sampleAgeSeconds: number;
  label: string | null;
}

export interface LifeTrack {
  mapCodename: string;
  segments: TrackSegmentDto[];
  markers: TrackMarkerDto[];
  sampleCount: number;
  truncated: boolean;
  alive: boolean;
}
/** Everything the sitemap may advertise. `gamertag` is raw — the web builds the URL with
 *  `playerSlug`, the same function that builds every other player link. */
export type SitemapData = {
  players: { gamertag: string; lastmod: string }[];
  lives: { gamertag: string; mapSlug: string; n: number; lastmod: string }[];
  articles: { kind: string; slug: string; lastmod: string }[];
};

export type FriendStatusValue = "none" | "outgoing" | "incoming" | "friends" | "cooldown";

export type FriendEntryDto = {
  id: number;
  gamertag: string;
  slug: string;
  status: FriendStatusValue;
  since: string;
  sharesPresence: boolean;
  notifyPresence: boolean;
  sharesLocation: boolean;
  /** ⚠️ Deliberately collapsed — see `reciprocityLabel` in `components/friends/location-toggles`.
   *  Never split into "master off" vs. "hidden from you specifically". */
  theyShareLocation: boolean;
};

export type FriendsFeed = {
  friends: FriendEntryDto[];
  incoming: FriendEntryDto[];
  outgoing: FriendEntryDto[];
  total: number;
  page: number;
  pageSize: number;
  /** The viewer's master switch — gates every per-friend share flag. */
  sharePresence: boolean;
  /** The viewer's master switch for location — gates every per-friend location flag. */
  shareLocation: boolean;
};

export type FriendStatusDto = {
  status: FriendStatusValue;
  friendshipId: number | null;
  /** ISO-8601. Set only when status is "cooldown". */
  cooldownUntil: string | null;
};

export type FriendPositionDto = {
  gamertag: string;
  x: number;
  y: number;
  /** ISO-8601. */
  recordedAt: string;
  self: boolean;
};
export type OnlinePlayerDto = {
  gamertag: string;
  /** An accepted friendship with the viewer. */
  friend: boolean;
  /** Has a dot on this map — derived server-side from the same positions. */
  sharing: boolean;
  self: boolean;
};
export type FriendMap = {
  mapCodename: string;
  positions: FriendPositionDto[];
  online: OnlinePlayerDto[];
};
/** The gated `GET /me/maps` list shape. ⚠️ NOTHING IN THE WEB READS THIS ANY MORE — the map
 *  shell switched to the public `GET /servers` so the switcher works signed out. Kept as the
 *  documented shape of a route the API still serves. */
export type MapServerDto = { slug: string; name: string; map: string; friendCount: number };
