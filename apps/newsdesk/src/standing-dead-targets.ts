import type { Database } from "@onelife/db";
import { lives, players, servers, sessions } from "@onelife/db";
import { and, asc, eq, gte, isNull, sql } from "drizzle-orm";
import { qualifiedLifeCondition } from "@onelife/read-models";

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

export async function findStandingDeadTargets(
  db: Database,
  opts: StandingDeadOpts,
): Promise<StandingDeadTarget[]> {
  // `sessions` are per-life (sessions.life_id), so correlate on lives.id — not on the player.
  // COALESCE(disconnected_at, connected_at) is LOAD-BEARING: disconnected_at is nullable and a
  // stale OPEN session is exactly the crash-and-never-returned case this vertical exists for.
  // A naive MAX(disconnected_at) evaluates NULL and silently drops it.
  const lastSeen = sql<Date>`(
    SELECT MAX(COALESCE(s.disconnected_at, s.connected_at))
    FROM ${sessions} s
    WHERE s.life_id = ${lives.id}
  )`;
  // Expressed once and reused: §4.1.3 gates NEWS_SINCE on this same eligibility instant, NOT on
  // lives.started_at (which would make every verified subject ineligible forever).
  const eligibleAt = sql<Date>`(${lastSeen} + make_interval(hours => ${opts.standingDeadHours}))`;

  // Built via ARRAY[...] + sql.join, not a bare `${array}` interpolation: drizzle's sql`` tag
  // treats an interpolated plain JS array as a *parenthesized scalar list* (one bound param per
  // element) rather than a single array-typed parameter — confirmed against this repo's actual
  // driver (see long-form-targets.ts). For a single-element array that collapses to `($1)`, and
  // casting THAT bare scalar to `::text[]` makes Postgres try to parse the gamertag itself as an
  // array literal ("malformed array literal").
  const suppressed = opts.suppressedGamertags.length === 0
    ? sql`TRUE`
    : sql`lower(${players.gamertag}) <> ALL(ARRAY[${sql.join(
        opts.suppressedGamertags.map((g) => sql`${g.toLowerCase()}`),
        sql`, `,
      )}]::text[])`;

  const earnedCoverage = sql`TRUE`;   // replaced in Task 12
  const notPublished = sql`TRUE`;     // replaced in Task 13 (TS-side two-query anti-join)

  const rows = await db
    .select({
      lifeId: lives.id, serverId: lives.serverId, gamertag: players.gamertag,
      map: servers.map, mapSlug: servers.slug, lifeNumber: lives.lifeNumber,
      lifeStartedAt: lives.startedAt, playtimeSeconds: lives.playtimeSeconds,
      lastSeenAt: lastSeen, eligibleAt,
      priorLives: sql<number>`0`, hitsAbsorbed: sql<number>`0`,
    })
    .from(lives)
    .innerJoin(players, eq(players.id, lives.playerId))
    .innerJoin(servers, eq(servers.id, lives.serverId))
    .where(and(
      isNull(lives.endedAt),
      qualifiedLifeCondition(db),
      gte(lives.playtimeSeconds, opts.minPlaytimeSeconds),
      // A qualified open life with ZERO session rows is not "gone quiet" — it never arrived.
      // The `<=` below would exclude it anyway (NULL comparison), but stating it makes the
      // intent explicit and testable.
      sql`${lastSeen} IS NOT NULL`,
      // .toISOString(), not the raw Date: drizzle-orm/postgres-js's driver.js REPLACES
      // postgres-js's own timestamptz serializer with an identity function (it expects the
      // query builder's column mapping to have already stringified the value). A raw `sql`
      // template tag chunk bypasses that mapping, so a bare Date param here crashes inside
      // postgres-js's wire encoder the moment the server describes the placeholder as
      // timestamptz — confirmed against this repo's actual driver, not assumed.
      sql`${eligibleAt} <= ${opts.now.toISOString()}`,     // idle >= N hours as of the reference instant
      sql`${eligibleAt} >= ${opts.since.toISOString()}`,   // forward-only, on the ELIGIBILITY instant
      earnedCoverage,
      suppressed,
      notPublished,
    ))
    // Oldest-idle first: the ~7-subject pool drains in a stable order across ticks.
    .orderBy(sql`${lastSeen} ASC`, asc(players.gamertag))
    .limit(opts.limit);

  return rows.map((r) => ({
    lifeId: r.lifeId, serverId: r.serverId, gamertag: r.gamertag,
    map: r.map, mapSlug: r.mapSlug, lifeNumber: r.lifeNumber,
    lifeStartedAt: r.lifeStartedAt, playtimeSeconds: r.playtimeSeconds,
    lastSeenAt: new Date(r.lastSeenAt as unknown as string),
    eligibleAt: new Date(r.eligibleAt as unknown as string),
    idleSeconds: Math.round(
      (opts.now.getTime() - new Date(r.lastSeenAt as unknown as string).getTime()) / 1000),
    priorLives: Number(r.priorLives), hitsAbsorbed: Number(r.hitsAbsorbed),
    naturalKey: standingDeadNaturalKey(r.serverId, r.gamertag, r.lifeStartedAt),
  }));
}
