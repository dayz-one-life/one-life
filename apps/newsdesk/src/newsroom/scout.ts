import type { Database } from "@onelife/db";
import { lives, servers } from "@onelife/db";
import { sql } from "drizzle-orm";
import { findStandingDeadTargets } from "../standing-dead-targets.js";
import { findLongFormTargets } from "../long-form-targets.js";

/**
 * Story tips for the editorial desk. The two shipped trigger finders run UNCHANGED — same
 * thresholds, same suppression, same anti-join against already-covered stories — but their
 * output is stripped to display fields and handed to a human instead of an LLM.
 *
 * THE FOG RULE HOLDS HERE TOO: nothing in a ScoutReport carries a coordinate at any depth
 * (asserted by the recursive key walk in newsroom-scout.test.ts). A Standing Dead subject is
 * alive; a tip that located them would be a hunting aid.
 */
export interface ScoutReport {
  standingDead: { gamertag: string; map: string; idleDays: number }[];
  longForm: { map: string; subjectCount: number; earliestDeathAt: Date }[];
  aggregates: { map: string; players: number; medianLifeMinutes: number | null; singleSessionPct: number | null }[];
}

/** Thresholds default to the shipped NEWSDESK_* defaults so a scout tip and a (hypothetical)
 *  enabled newsTick would agree on who qualifies. Only the suppression list is required —
 *  forgetting it must be a compile error, not an accidental privacy leak. */
export interface ScoutOpts {
  suppressedGamertags: string[];
  standingDeadHours?: number;
  minPlaytimeSeconds?: number;
  minHitsAbsorbed?: number;
  windowSeconds?: number;
  radiusMeters?: number;
  maxFixAgeSeconds?: number;
  /** Lookback for both finders, in days. */
  sinceDays?: number;
  /** Per-list cap. */
  limit?: number;
}

export async function scout(db: Database, now: Date, opts: ScoutOpts): Promise<ScoutReport> {
  const since = new Date(now.getTime() - (opts.sinceDays ?? 14) * 86_400_000);
  const limit = opts.limit ?? 10;

  const standing = await findStandingDeadTargets(db, {
    now,
    since,
    standingDeadHours: opts.standingDeadHours ?? 72,
    minPlaytimeSeconds: opts.minPlaytimeSeconds ?? 1800,
    minHitsAbsorbed: opts.minHitsAbsorbed ?? 100,
    suppressedGamertags: opts.suppressedGamertags,
    maxAttempts: 3,
    limit,
  });

  const long = await findLongFormTargets(db, {
    since,
    now,
    maxFixAgeSeconds: opts.maxFixAgeSeconds ?? 120,
    suppressedGamertags: opts.suppressedGamertags,
    candidateLimit: 500,
    windowSeconds: opts.windowSeconds ?? 180,
    radiusMeters: opts.radiusMeters ?? 100,
    maxAttempts: 3,
    limit,
  });

  // The founding session's per-map digest: unique players, median non-suicide life length, and
  // the share of ended lives that lasted a single session. Aggregates only — no names, so the
  // suppression list does not apply. The single-player caveat (one player can move a small map's
  // median — the Livonia 1.0-minute lesson) lives in the skill's rails, not in this query.
  const rows = await db.execute(sql`
    SELECT
      s.map AS map,
      COUNT(DISTINCT l.player_id)::int AS players,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY l.playtime_seconds) FILTER (
        WHERE l.ended_at IS NOT NULL AND COALESCE(l.death_cause, '') <> 'suicide'
      ) / 60.0 AS median_life_minutes,
      AVG(
        CASE WHEN l.ended_at IS NOT NULL THEN
          CASE WHEN (SELECT COUNT(*) FROM sessions se WHERE se.life_id = l.id) <= 1 THEN 1.0 ELSE 0.0 END
        END
      ) * 100.0 AS single_session_pct
    FROM ${lives} l
    INNER JOIN ${servers} s ON s.id = l.server_id
    -- .toISOString(), not the raw Date — the same driver.js replacement gotcha long-form-targets
    -- documents: a raw Date in db.execute() reaches postgres-js untyped and throws at Bind.
    WHERE l.started_at >= ${since.toISOString()}
    GROUP BY s.map
    ORDER BY s.map ASC
  `);

  return {
    standingDead: standing.map((t) => ({
      gamertag: t.gamertag,
      map: t.map,
      idleDays: Math.floor(t.idleSeconds / 86_400),
    })),
    longForm: long.clusters.map((c) => ({
      map: c.map,
      subjectCount: c.subjects.length,
      earliestDeathAt: c.earliestDeathAt,
    })),
    aggregates: (rows as unknown as Record<string, unknown>[]).map((r) => ({
      map: String(r.map),
      players: Number(r.players),
      medianLifeMinutes: r.median_life_minutes == null ? null : Number(r.median_life_minutes),
      singleSessionPct: r.single_session_pct == null ? null : Number(r.single_session_pct),
    })),
  };
}
