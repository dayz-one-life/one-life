import type { Database } from "@onelife/db";
import { lives, players, servers, positions, articles } from "@onelife/db";
import { and, inArray, sql } from "drizzle-orm";
import { qualifiedLifeCondition } from "@onelife/read-models";
import type { DeathCandidate } from "./long-form-cluster.js";
import { applyLongFormExclusions, buildLongFormClusters, type LongFormResult } from "./long-form-cluster.js";

export interface LongFormCandidateOpts {
  since: Date;
  now: Date;
  maxFixAgeSeconds: number;
  suppressedGamertags: string[];
  candidateLimit: number;
}

/** postgres-js returns a RowList (a real Array) from db.execute; node-postgres would return
 *  `{ rows }`. Normalise once so the mapping below is driver-agnostic. */
function resultRows(res: unknown): Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  return ((res as { rows?: unknown[] }).rows ?? []) as Record<string, unknown>[];
}

/** postgres-js already parses timestamptz into a Date; a raw driver could hand back a string. */
const toDate = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v)));
const orNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export async function findLongFormCandidates(
  db: Database,
  opts: LongFormCandidateOpts,
): Promise<DeathCandidate[]> {
  // Suppressed players are filtered HERE as well as post-clustering: a suppressed death must not
  // be able to claim a cluster seed slot and thereby suppress a legitimate cluster around it.
  // Removing a candidate can change cluster membership — that is intended.
  //
  // Built via ARRAY[...] + sql.join, not a bare `${array}` interpolation: drizzle's sql`` tag
  // treats an interpolated plain JS array as a *parenthesized scalar list* (its ${array} chunk
  // handler wraps it "(a, b, c)", one bound param per element) rather than a single array-typed
  // parameter — confirmed against this repo's actual driver. For a single-element array that
  // collapses to `($1)`, and casting THAT bare scalar to `::text[]` makes Postgres try to parse
  // the gamertag itself as an array literal ("malformed array literal"). ARRAY[$1, $2, ...] is
  // the correct construction for a native Postgres array here.
  const suppressed = opts.suppressedGamertags.length === 0
    ? sql`TRUE`
    : sql`lower(${players.gamertag}) <> ALL(ARRAY[${sql.join(
        opts.suppressedGamertags.map((g) => sql`${g.toLowerCase()}`),
        sql`, `,
      )}]::text[])`;

  // Neither `lives` nor `kills` stores coordinates; `positions` is the only source. JOIN LATERAL
  // ... ON TRUE (INNER, never LEFT): a death with no fix must be DROPPED, not carried with NULL
  // coordinates into the distance maths. ORDER BY recorded_at DESC LIMIT 1 is "the last fix at or
  // before ended_at" and is served backwards by positions_player_idx
  // (server_id, player_id, recorded_at) with no sort. The fix-age guard sits in the WHERE so it
  // prunes BEFORE clustering.
  const res = await db.execute(sql`
    SELECT
      ${lives.id}          AS life_id,
      ${lives.serverId}    AS server_id,
      ${players.gamertag}  AS gamertag,
      ${servers.map}       AS map,
      ${servers.slug}      AS map_slug,
      ${lives.lifeNumber}  AS life_number,
      ${lives.startedAt}   AS life_started_at,
      ${lives.endedAt}     AS ended_at,
      ${lives.deathCause}  AS death_cause,
      fix.x                AS x,
      fix.y                AS y,
      fix.recorded_at      AS fix_at
    FROM ${lives}
    INNER JOIN ${players} ON ${players.id} = ${lives.playerId}
    INNER JOIN ${servers} ON ${servers.id} = ${lives.serverId}
    JOIN LATERAL (
      SELECT pos.x, pos.y, pos.recorded_at
      FROM ${positions} pos
      WHERE pos.server_id = ${lives.serverId}
        AND pos.player_id = ${lives.playerId}
        AND pos.recorded_at <= ${lives.endedAt}
      ORDER BY pos.recorded_at DESC
      LIMIT 1
    ) fix ON TRUE
    WHERE ${lives.endedAt} IS NOT NULL
      -- .toISOString(), not the raw Date: drizzle-orm/postgres-js's driver.js REPLACES
      -- postgres-js's own timestamptz serializer with an identity function (it expects the
      -- query builder's column mapping to have already stringified the value). A raw SQL
      -- template tag bypasses that mapping, so a bare Date param here crashes inside
      -- postgres-js's wire encoder (Buffer.byteLength on a Date) the moment the server
      -- describes the placeholder as timestamptz — confirmed against this repo's actual
      -- driver, not assumed.
      AND ${lives.endedAt} >= ${opts.since.toISOString()}
      AND ${lives.endedAt} <= ${opts.now.toISOString()}
      AND ${qualifiedLifeCondition(db)}
      AND fix.recorded_at >= ${lives.endedAt} - make_interval(secs => ${opts.maxFixAgeSeconds}::double precision)
      AND ${suppressed}
    ORDER BY ${lives.endedAt} ASC, ${players.gamertag} ASC
    LIMIT ${opts.candidateLimit}
  `);

  return resultRows(res).map((r) => ({
    lifeId: Number(r.life_id),
    serverId: Number(r.server_id),
    gamertag: String(r.gamertag),
    map: String(r.map),
    mapSlug: orNull(r.map_slug),
    lifeNumber: Number(r.life_number),
    lifeStartedAt: toDate(r.life_started_at),
    endedAt: toDate(r.ended_at),
    deathCause: orNull(r.death_cause),
    x: Number(r.x),
    y: Number(r.y),
    fixAt: toDate(r.fix_at),
  }));
}

/** Nine required fields in total — see the interface note: a C2 call site that omits `now` or
 *  `candidateLimit` will not compile. */
export interface LongFormTargetOpts extends LongFormCandidateOpts {
  windowSeconds: number; radiusMeters: number; maxAttempts: number; limit: number;
}

export async function findLongFormTargets(
  db: Database,
  opts: LongFormTargetOpts,
): Promise<LongFormResult> {
  const candidates = await findLongFormCandidates(db, opts);
  const built = buildLongFormClusters(candidates, opts);
  const { clusters, skipped } = applyLongFormExclusions(built, opts);
  if (clusters.length === 0) return { clusters, skipped };

  // Two-query anti-join, deliberately NOT a SQL-computed key. The Long Form key depends on the
  // whole clique, so it cannot be built in SQL at all; doing it in TS also makes toISOString()
  // the SOLE producer of every key, so the written key and the anti-joined key are the same
  // string by construction. (A SQL to_char() rendering that drifted from JS would make the
  // anti-join a silent no-op and re-publish the same subject every tick.)
  const keys = clusters.map((c) => c.naturalKey);
  const blocked = await db
    .select({ k: articles.naturalKey })
    .from(articles)
    .where(and(
      inArray(articles.naturalKey, keys),
      // Kept byte-for-byte identical to the Standing Dead anti-join so the two cannot drift. A
      // Long Form subject is dead and is never swept, so 'retracted' is unreachable here today —
      // one predicate, one meaning, is worth more than the one term it saves.
      sql`(${articles.status} IN ('published','retracted') OR ${articles.attempts} >= ${opts.maxAttempts})`,
    ));
  const blockedSet = new Set(blocked.map((r) => r.k!));

  // The limit is applied AFTER the anti-join drop, so a blocked cluster never consumes a slot.
  return { clusters: clusters.filter((c) => !blockedSet.has(c.naturalKey)).slice(0, opts.limit), skipped };
}
