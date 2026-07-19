/** The Standing Dead's subject is an ABSENCE, not a death: a qualified life still open (no
 *  `endedAt`) whose player has gone idle past the threshold. Unlike an obituary subject this
 *  person is alive and their character is standing somewhere unattended — the Fog Rule forbids
 *  disclosing a live player's whereabouts, so this target carries no coordinates and no location
 *  field, and nothing downstream should add one. */
export interface StandingDeadTarget {
  lifeId: number;            // transient — loads getLifeTimeline in the tick; NEVER persisted
  serverId: number; gamertag: string;
  map: string; mapSlug: string | null; lifeNumber: number;
  lifeStartedAt: Date; playtimeSeconds: number;
  lastSeenAt: Date; eligibleAt: Date; idleSeconds: number;
  priorLives: number; hitsAbsorbed: number;
  naturalKey: string;
}

/** Every threshold is a required field, deliberately not defaulted: a follow-up PR's worker pass
 *  calls the targeting function this type belongs to, and an incomplete call site must be a
 *  compile error rather than a silently-wrong default. */
export interface StandingDeadOpts {
  now: Date; since: Date;
  standingDeadHours: number;        // 72
  minPlaytimeSeconds: number;       // 1800
  minHitsAbsorbed: number;          // 100
  suppressedGamertags: string[];
  maxAttempts: number; limit: number;
}

/** Rebuild-stable identity: server id + gamertag verbatim + the life's start instant as an
 *  ISO string (UTC, ms precision). NEVER a projection row id — `articles` survives --rebuild and
 *  `lives.id` does not. Computed BEFORE generation and written by BOTH the publish path and the
 *  failure-stub path; a stub with a NULL natural_key escapes articles_natural_key_uniq and the
 *  retry inserts a second stub forever. */
export function standingDeadNaturalKey(serverId: number, gamertag: string, lifeStartedAt: Date): string {
  return `standing_dead:${serverId}:${gamertag}:${lifeStartedAt.toISOString()}`;
}
