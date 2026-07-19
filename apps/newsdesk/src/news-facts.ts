import type { LifeTimeline, PlayerPriors } from "@onelife/read-models";
import type { NewsImageFacts } from "./image-categories.js";
import type { StandingDeadTarget } from "./standing-dead-targets.js";
import type { LongFormCluster } from "./long-form-cluster.js";
import { timeAliveLabel } from "./facts.js";

/**
 * One person in a news feature. Shaped to match the eventual `article_subjects` child table
 * (spec §6), so normalising it later is a pure jsonb backfill rather than a re-derivation.
 *
 * THREE RAILS ARE STRUCTURAL HERE, not stylistic:
 *  1. NO ROW IDS. `lives.id` / `players.id` do not survive a projector rebuild, and `articles` is
 *     durable — a persisted id is a dangling pointer the moment anyone runs `deploy.sh --rebuild`.
 *     `lifeId` is carried on the TARGET types purely to load a timeline inside the tick, and it
 *     stops there.
 *  2. NO COORDINATES. `DeathCandidate` carries x/y; `LongFormSubject` and `StandingDeadTarget`
 *     already do not, and nothing below re-derives a position, a landmark, a route, or a distance
 *     between two fixes. A Standing Dead subject is ALIVE and can be hunted.
 *  3. TIME ALIVE IS PLAYTIME. `playtime_seconds`, never `endedAt - startedAt` and never
 *     `now - startedAt`. The current wall-clock leader in production has 1.56 hours of play across
 *     7.14 days; printing that as endurance would be the paper's first outright lie.
 */
export type NewsSubject = {
  gamertag: string;                // verbatim as stored in `players` — never lowercased
  map: string;
  mapSlug: string | null;
  lifeNumber: number;
  lifeStartedAt: string;           // ISO, UTC, ms precision
  endedAt: string | null;          // ISO; null for a Standing Dead subject (the life is open)
  timeAliveSeconds: number;        // playtime_seconds — see rail 3
  timeAliveLabel: string;
  kills: number;
  sessions: number;
  persona: string | null;
  deathCause: string | null;       // null for a Standing Dead subject
  priors: PlayerPriors;
  isKnownQuantity: boolean;        // priors.livesLived > 0
  isFresh: boolean;                // first life anywhere, and has never killed anyone
};

/**
 * The frozen snapshot behind one news article — the whole of `articles.facts`.
 *
 * It INTERSECTS NewsImageFacts on purpose: that type is the vocabulary the NEWSROOM image gates
 * read, so a builder below that stops emitting one of those fields is a compile error rather than
 * a gate that silently stops firing (spec §7, PR-C1 ledger item 2).
 */
export type NewsFacts = NewsImageFacts & {
  naturalKey: string;              // the article's identity; produced ONLY by toISOString() in TS
  serverId: number;                // `servers` is durable and is NOT truncated by a rebuild
  mapSlug: string | null;
  primaryGamertag: string;
  subjects: NewsSubject[];         // includes the primary; Long Form order is gamertag ascending
  priors: PlayerPriors;            // the primary's — widened from NewsImageFacts' two-field view
  // ── The Standing Dead only ──
  lastSeenAt: string | null;
  eligibleAt: string | null;
  idleSeconds: number | null;
  // ── The Long Form only ──
  earliestDeathAt: string | null;
  spanSeconds: number | null;      // first death to last death. TIME only — never a distance.
};

function buildNewsSubject(args: {
  gamertag: string; map: string; mapSlug: string | null; lifeNumber: number;
  lifeStartedAt: Date; endedAt: Date | null; deathCause: string | null;
  timeline: LifeTimeline; priors: PlayerPriors;
}): NewsSubject {
  const kills = args.timeline.kills.length;
  const timeAliveSeconds = args.timeline.life.playtimeSeconds ?? 0;
  return {
    gamertag: args.gamertag,
    map: args.map,
    mapSlug: args.mapSlug,
    lifeNumber: args.lifeNumber,
    lifeStartedAt: args.lifeStartedAt.toISOString(),
    endedAt: args.endedAt ? args.endedAt.toISOString() : null,
    timeAliveSeconds,
    timeAliveLabel: timeAliveLabel(timeAliveSeconds),
    kills,
    sessions: args.timeline.sessions.length,
    persona: args.timeline.character?.name ?? null,
    deathCause: args.deathCause,
    priors: args.priors,
    isKnownQuantity: args.priors.livesLived > 0,
    // The protected class of spec §4.2: a first life anywhere, and never a kill. Both arms of the
    // priors test are needed — a player with prior lives is not fresh even at zero kills.
    isFresh: args.priors.livesLived === 0 && args.priors.totalKills === 0 && kills === 0,
  };
}

/** The Standing Dead snapshot: one open, qualified life whose owner has gone quiet. */
export function buildStandingDeadFacts(
  target: StandingDeadTarget,
  timeline: LifeTimeline,
  priors: PlayerPriors,
): NewsFacts {
  const subject = buildNewsSubject({
    gamertag: target.gamertag, map: target.map, mapSlug: target.mapSlug,
    lifeNumber: target.lifeNumber, lifeStartedAt: target.lifeStartedAt,
    // The life is OPEN. There is no death here and there must never be one implied.
    endedAt: null, deathCause: null, timeline, priors,
  });
  return {
    trigger: "standing_dead",
    map: target.map,
    mapSlug: target.mapSlug,
    serverId: target.serverId,
    naturalKey: target.naturalKey,
    primaryGamertag: target.gamertag,
    subjects: [subject],
    subjectCount: 1,
    lifeNumber: target.lifeNumber,
    timeAliveSeconds: subject.timeAliveSeconds,
    hitsAbsorbed: target.hitsAbsorbed,
    // Idle time is its OWN field and is labelled as such everywhere downstream. It is the length
    // of an absence, not the length of a life, and the prompt is told so in as many words.
    idleSeconds: target.idleSeconds,
    idleHours: Math.floor(target.idleSeconds / 3600),
    lastSeenAt: target.lastSeenAt.toISOString(),
    eligibleAt: target.eligibleAt.toISOString(),
    priors,
    allFreshSubjects: subject.isFresh,
    earliestDeathAt: null,
    spanSeconds: null,
  };
}

/**
 * The Long Form snapshot: a clique of qualified deaths. `per` is keyed by gamertag, which is safe
 * because `applyLongFormExclusions` has already discarded any cluster with a repeated gamertag
 * (a self-cluster is one player's rerolls, not a shared fate).
 */
export function buildLongFormFacts(
  cluster: LongFormCluster,
  per: Map<string, { timeline: LifeTimeline; priors: PlayerPriors }>,
): NewsFacts {
  const subjects = cluster.subjects.map((s) => {
    const got = per.get(s.gamertag);
    // Throwing beats publishing a feature that silently omits one of the people in it.
    if (!got) throw new Error(`long form: no timeline for subject ${s.gamertag}`);
    return buildNewsSubject({
      gamertag: s.gamertag, map: s.map, mapSlug: s.mapSlug, lifeNumber: s.lifeNumber,
      lifeStartedAt: s.lifeStartedAt, endedAt: s.endedAt, deathCause: s.deathCause,
      timeline: got.timeline, priors: got.priors,
    });
  });
  const primary = subjects.find((s) => s.gamertag === cluster.primary.gamertag);
  if (!primary) throw new Error(`long form: primary ${cluster.primary.gamertag} missing from subjects`);
  const ends = cluster.subjects.map((s) => s.endedAt.getTime());

  return {
    trigger: "long_form",
    map: cluster.map,
    mapSlug: cluster.mapSlug,
    serverId: cluster.serverId,
    naturalKey: cluster.naturalKey,
    primaryGamertag: cluster.primary.gamertag,
    subjects,
    subjectCount: subjects.length,
    lifeNumber: primary.lifeNumber,
    timeAliveSeconds: primary.timeAliveSeconds,
    // Absorbed hits are a Standing Dead endurance signal and are not queried for a death cluster.
    // The `what-it-took` image framing therefore never fires on a Long Form piece — intended.
    hitsAbsorbed: 0,
    idleSeconds: null,
    idleHours: null,
    lastSeenAt: null,
    eligibleAt: null,
    priors: primary.priors,
    // Spec §4.2's tone branch: when EVERY subject is a first-life, zero-kill player the story is
    // about the world, never about the two men's competence.
    allFreshSubjects: subjects.every((s) => s.isFresh),
    earliestDeathAt: cluster.earliestDeathAt.toISOString(),
    // Seconds between the first and the last death. The DISTANCE between the two fixes is what
    // made this a cluster, and it never leaves long-form-cluster.ts (spec §4.1.4, §11).
    spanSeconds: Math.round((Math.max(...ends) - Math.min(...ends)) / 1000),
  };
}
