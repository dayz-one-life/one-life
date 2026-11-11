import type { LifeTimeline, OrdealSummary, PlayerPriors, WriterDeath } from "@onelife/read-models";
import type { Condition, LegacyCause, PublicDeath, PublicTag, WriterBrief } from "@onelife/death-verdict";
import type { ObituaryTarget } from "./pg-store.js";

export const LEGEND_KILLS = 20;
export const LEGEND_SECONDS = 604800; // 7 days
export const FRESH_SPAWN_SECONDS = 1800; // 30 min
/** Under this, a self-inflicted death is a spawn reroll (a bad beach, a broken leg on landing),
 *  not the end of a run. Published suicides span 15s–5381s; the prompt must not read them alike. */
export const SUICIDE_RESET_SECONDS = 300; // 5 min

/**
 * The death as the article freezes it (death-verdict spec 3.6, 6.1): the already-hedged public
 * strings, the fallback whenever the live verdict is missing or pending. ⚠️ Built without the
 * trap credit and without a named driver (`writerDeathOf`), so the only gamertag that can be in it
 * is a kill-line killer's.
 */
export type ObituaryDeath = Pick<PublicDeath, "key" | "certainty" | "label" | "detail" | "sentence" | "caption" | "trap" | "selfStated"> & {
  tag: PublicTag;
};

export interface ObituaryFacts {
  gamertag: string;
  map: string;
  mapSlug: string | null;
  lifeNumber: number;
  timeAliveSeconds: number;
  timeAliveLabel: string;
  /** Every kill this life, trap kills included (revision 3: a trap kill is a kill). */
  kills: number;
  /** How many of `kills` are credited from a trap this player set. Stored as a number. */
  trapKills: number;
  longestKillMeters: number | null;
  sessions: number;
  /** The life row's own coarse word (`lives.death_cause`), kept for readers that predate `death`. */
  cause: string | null;
  /** The family tag of the death (`death.tag`): "PvP", "Self-Inflicted", "Hunger and Thirst", ...
   *  "Unknown" if and only if the certainty is unknown (not recorded, or withheld). */
  causeCategory: PublicTag;
  /** Only a killer the kill line names (`death.killerGamertag`). Never a driver, never a placer. */
  killerGamertag: string | null;
  weapon: string | null;
  isLegend: boolean;
  freshSpawnVictim: boolean;
  endedAt: string;
  deathDistance: number | null;
  /** The frozen public death. */
  death: ObituaryDeath;
  /** Today's vocabulary (`legacyCause`), for the v0.80.0 reader, an old mobile build and a
   *  rolled-back release. `articles.cause` is `verdict.cause`. */
  verdict: { cause: LegacyCause; confidence: "high" | "low"; conditions: Condition[] };
  ordeals: { infected: OrdealSummary; fire: OrdealSummary; pvp: OrdealSummary } | null;
  hpLow: number | null;
  priors: PlayerPriors;        // the player's global reputation before this life
  isKnownQuantity: boolean;    // priors.livesLived > 0
  /** True when the writer was given a trap credit line. A boolean, never a name. Stored. */
  creditSent: boolean;
  /**
   * ⚠️ NOT STORED. The player credited with this trap death, read live at write time. It goes to
   * the prompt, the cause check and the place-check exemptions, and is stripped by `storedFacts`
   * before `articles.facts` is written: a credit can be denied later (spec 6.4), and the stored
   * facts carry no gamertag but a kill-line killer's.
   */
  creditedGamertag: string | null;
  /** ⚠️ NOT STORED. The writer's brief (cause line, credit line, directives); it can hold the
   *  credited name. Stripped by `storedFacts`. */
  brief: WriterBrief;
}

/** What `articles.facts` holds: the facts minus the two fields that may name a trap-setter. */
export type StoredObituaryFacts = Omit<ObituaryFacts, "creditedGamertag" | "brief">;

/** The facts as they are written to `articles.facts`. */
export function storedFacts(f: ObituaryFacts): StoredObituaryFacts {
  const { creditedGamertag: _c, brief: _b, ...rest } = f;
  return rest;
}

/** Human duration: days once past 24h, else "Hh Mm", else "Mm". */
export function timeAliveLabel(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const days = Math.floor(s / 86400);
  if (days >= 1) {
    const h = Math.floor((s % 86400) / 3600);
    return h ? `${days}d ${h}h` : `${days}d`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

/**
 * Compose the factual snapshot the obituary prompt and Rap Sheet are built from.
 *
 * The death comes from the stored verdict (`writer`, read by `getWriterDeath`), never from the
 * life row's coarse word: the verdict is what every page shows, and the prose must agree with it.
 */
export function buildObituaryFacts(
  target: ObituaryTarget,
  timeline: LifeTimeline,
  priors: PlayerPriors,
  writer: WriterDeath,
): ObituaryFacts {
  const life = timeline.life;
  const kills = timeline.kills.length;
  const trapKills = timeline.kills.filter((k) => k.basis === "trap_placement").length;
  const longestKillMeters = timeline.kills.reduce<number | null>((max, k) => {
    if (k.distanceMeters == null) return max;
    return max == null || k.distanceMeters > max ? k.distanceMeters : max;
  }, null);
  const timeAliveSeconds = life.playtimeSeconds ?? 0;
  const d = writer.death;
  const tag: PublicTag = d.tag ?? "Unknown";
  const stated = d.certainty === "definitive" || d.certainty === "strong";
  // The credit is sent only when the brief carries its line (a stated or strong trap death whose
  // credit matches the device); that is the one case the placer's name reaches the writer.
  const creditedGamertag = writer.brief.creditLine && writer.credit ? writer.credit.gamertag : null;

  return {
    gamertag: target.gamertag,
    map: target.map,
    mapSlug: target.mapSlug,
    lifeNumber: target.lifeNumber,
    timeAliveSeconds,
    timeAliveLabel: timeAliveLabel(timeAliveSeconds),
    kills,
    trapKills,
    longestKillMeters,
    sessions: timeline.sessions.length,
    cause: life.deathCause,
    causeCategory: tag,
    killerGamertag: d.killerGamertag,
    weapon: life.deathWeapon ?? null,
    isLegend: kills >= LEGEND_KILLS || timeAliveSeconds >= LEGEND_SECONDS,
    // Deliberately a stated player kill only: the flag exists to protect a victim from being
    // mocked for being preyed upon, and its directive says "killed by another player" as a fact.
    // A short suicide has no predator, and a best reading of a player kill is not a fact.
    freshSpawnVictim: tag === "PvP" && stated && timeAliveSeconds < FRESH_SPAWN_SECONDS,
    endedAt: target.endedAt.toISOString(),
    deathDistance: life.deathDistance ?? null,
    death: {
      key: d.key, tag, certainty: d.certainty, label: d.label, detail: d.detail, sentence: d.sentence,
      caption: d.caption, trap: d.trap, selfStated: d.selfStated,
    },
    verdict: { cause: d.cause, confidence: d.confidence, conditions: [...d.conditions] },
    // buildsPlaced is deliberately NOT carried across: base-building is not obituary material,
    // and omitting it at the type level means a later edit cannot print it by accident.
    ordeals: timeline.ordeals
      ? { infected: timeline.ordeals.infected, fire: timeline.ordeals.fire, pvp: timeline.ordeals.pvp }
      : null,
    hpLow: timeline.hpLow ?? null,
    priors,
    isKnownQuantity: priors.livesLived > 0,
    creditSent: creditedGamertag != null,
    creditedGamertag,
    brief: writer.brief,
  };
}
