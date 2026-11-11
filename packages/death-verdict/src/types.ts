import type { ATTRIBUTION_ROLES, CONTRIBUTOR_ROLES, INTERNAL_CAUSES } from "./tokens.js";

/** How sure a verdict is. `definitive`: the log states it. `strong`: worked out, with little room
 *  for another reading. `inferred`: the best reading of a log that states nothing. */
export type Confidence = "definitive" | "strong" | "inferred" | "unknown";
/** The three grades a cause can be shown at. */
export type Grade = Exclude<Confidence, "unknown">;

/** The state a player was in at the end. A closed list: these words are printed. */
export type Condition = "starving" | "dehydrated" | "hunted" | "healthy";

/** The precise cause the classifier stores. INTERNAL — see the ⚠️ in tokens.ts. */
export type InternalCause = (typeof INTERNAL_CAUSES)[number];
export type AttributionRole = (typeof ATTRIBUTION_ROLES)[number];
export type ContributorRole = (typeof CONTRIBUTOR_ROLES)[number];

/**
 * Where an attribution comes from. Set by the rule that fires.
 *
 * ⚠️ Only the three `kill_line*` values may put a name on a page: the kill line itself names that
 * player. `placement` is a reading of where a trap was set — it never becomes a killer, a driver
 * or "their own"; it can become a `credit`, and only through a `kills` row the caller supplies.
 * `not_stated` covers every inferred person: never published.
 */
export type AttributionBasis = "kill_line" | "kill_line_driver" | "kill_line_self" | "placement" | "not_stated";

/** The object a death involved, as a public word. Knives, guns, infected and animal classes have
 *  no key: the cause already says what they were. */
export type ObjectKey =
  | "m67_grenade" | "rgd5_grenade" | "claymore" | "land_mine" | "round_40mm" | "m79"
  | "plastic_explosive" | "fuel_pump" | "fireplace" | "motorbike" | "car" | "barbed_wire" | "bear_trap";

/** A line of the log, by the file it is in and its position there. Stable across rebuilds. */
export interface LineRef { admFileId: number; lineIndex: number }

/** What the classifier returns for one death. INTERNAL: stored for the operator, never served. */
export interface InternalVerdict {
  cause: InternalCause;
  confidence: Confidence;
  /** True when a line of the log states the mechanism, false when it was worked out. */
  mechanismStated: boolean;
  object: {
    key: ObjectKey | null;
    className: string | null;
    /** The reference's wording, verbatim. May be a raw class name. */
    text: string | null;
  } | null;
  /** For a death that followed a knock-out or a wound: what caused that. */
  upstream: { cause: string; confidence: Confidence } | null;
  coCauses: string[];
  attribution: {
    role: AttributionRole; basis: AttributionBasis; dayzId: string; gamertag: string; confidence: Confidence;
  } | null;
  /** The id of the rule that fired, the same ids the reference uses. */
  rule: string;
  /** The resolved primary line of the death. */
  deathRef: LineRef;
  deathLines: (LineRef & { role: string })[];
  /** UTC, from the log's own clock. */
  deathAt: string;
  conditions: Condition[];
  evidence: {
    refs: (LineRef & { role: string })[];
    flags: string[];
    contributors: { role: ContributorRole; dayzId: string; gamertag: string; confidence: Confidence }[];
    notes: string[];
    credit: CreditEvidence | null;
  };
}

/** The reading behind a trap kill. INTERNAL. The classifier fills the evidence tests; the writer
 *  of the verdict fills the outcome. */
export interface CreditEvidence {
  outcome: "credited" | "refused" | "denied" | "granted" | "not_applicable";
  refusedBy: 1 | 2 | 3 | 4 | 5 | 6 | 7 | null;
  placerDayzId: string | null;
  placement: LineRef | null;
  distanceM: number | null;
  ageHours: number | null;
  boots: number | null;
  flags: string[];
}

/**
 * The part of a stored verdict that presentation is allowed to read.
 *
 * ⚠️ This is deliberately narrower than the stored row. It carries no gamertag, no player id, no
 * rule, no evidence and no object text, so `toPublicDeath` cannot publish one by mistake: every
 * name it prints comes from the life's own kill line (`LifeDeathFacts`) or from the `credit`
 * argument. Adding a field here widens what can reach a page — read present.ts first.
 *
 * ⚠️ The values come from a database row, so the types are a hope, not a guarantee: a row written
 * by a newer classifier can hold a cause or a confidence this release has never heard of.
 * `toPublicDeath` checks every one at run time and reads anything it does not know as
 * "Not recorded". It must never throw and never print an unknown value as fact.
 */
export interface StoredVerdict {
  cause: InternalCause;
  confidence: Confidence;
  mechanismStated: boolean;
  objectKey: ObjectKey | null;
  upstream: { cause: string; confidence: Confidence } | null;
  attrBasis: AttributionBasis | null;
  /**
   * True only for the one kill-line form that is a firearm with an empty killer (the reference's
   * rule A14, flag `ownerless_firearm`). It is what lets a page say "Shot". ⚠️ Set it from the
   * rule that fired, never by elimination: a player kill with no name and no object is not
   * thereby a shooting (a punch with an item in hand has the same shape).
   */
  ownerlessFirearm: boolean;
  /** Only the words of `Condition` are printed; anything else is dropped. */
  conditions: readonly Condition[];
}

/** What the life row itself records about its end: the parser's coarse word and, for a player
 *  kill, what the kill line named. */
export interface LifeDeathFacts {
  deathCause: string | null;
  deathByGamertag: string | null;
  deathWeapon: string | null;
  deathDistance: number | null;
}

export type TrapDevice = "tripwire" | "land_mine";

/** A trap kill credited to the player who set the trap. The caller reads it from the victim
 *  life's `kills` row whose basis is a trap placement; presentation never builds one itself. */
export interface TrapCredit { gamertag: string; device: TrapDevice; byOperator: boolean }

/** What the obituary writer is given about a death. Built from the verdict, never worked back
 *  from a `PublicDeath`. */
export interface WriterBrief {
  /** The cause line, or null when the writer is given none (not recorded, withheld). An inferred
   *  line starts "most likely" and belongs under `NOT_CONFIRMED_HEADING`. */
  line: string | null;
  /** The line about a credited trap-setter, for under `NOT_CONFIRMED_HEADING`; null with no credit. */
  creditLine: string | null;
  /** The fixed instructions that go with the line, in the order they are sent. */
  directives: string[];
}

/** One key per public wording. Closed: a page can switch on it. */
export type PublicCauseKey =
  | "pvp" | "pvp_unnamed" | "shot" | "held_grenade"
  | "suicide" | "self_inflicted"
  | "tripwire" | "land_mine" | "grenade" | "explosion" | "own_explosive" | "fuel_pump"
  | "burned" | "infected" | "wolf" | "bear" | "dog" | "animal"
  | "fall" | "drowned"
  | "hit_by_vehicle" | "hit_by_vehicle_driver" | "motorbike_crash" | "vehicle_crash" | "vehicle"
  | "bled_out" | "starvation" | "dehydration" | "starvation_and_thirst" | "exposure" | "illness"
  | "withheld" | "unknown" | "awaiting";

/** The family a death is filed under. Aggregation ("usual cause of death") counts on this, never
 *  on a label: a label can hold a killer's name. */
export type PublicTag =
  | "PvP" | "Gunfire" | "Self-Inflicted" | "Trap" | "Explosion" | "Fire" | "Infected" | "Wildlife"
  | "Fall" | "Drowned" | "Vehicle" | "Blood Loss" | "Hunger and Thirst" | "Exposure" | "Illness"
  | "Unknown";

/** The families a cause can be inferred into. Each has a switch (`PUBLIC_INFERRED`). */
export type InferredFamily = "exposure" | "illness" | "vehicle_crash" | "hunger_thirst" | "infected" | "pvp";

/** Today's cause words, kept for readers that predate the stored verdict (see `legacyCause`). */
export type LegacyCause =
  | "pvp" | "suicide" | "starvation" | "dehydration" | "bled_out" | "mauled" | "environmental" | "unknown"
  | "wolf" | "bear" | "animal" | "infected" | "fall" | "vehicle" | "explosion";

/** The only shape of a death that leaves the server. */
export interface PublicDeath {
  /** `pending`: no stored verdict yet; only what the death line itself states is shown. */
  status: "final" | "pending";
  key: PublicCauseKey;
  /** Null while pending. */
  tag: PublicTag | null;
  /** The certainty shown, which is what the wording follows. It can differ from the stored
   *  confidence: a death after a knock-out is capped at strong, and a stated bleed-out or shot is
   *  never shown below it. */
  certainty: Confidence;
  label: string;
  detail: string | null;
  sentence: string;
  caption: string | null;
  /** Set only when the kill line names this player as the killer. */
  killerGamertag: string | null;
  /** Set only when the kill line names this player in the driver's seat. */
  driverGamertag: string | null;
  credit: { gamertag: string; basis: "trap_placement"; device: TrapDevice; byOperator: boolean } | null;
  /** Booleans, not phrases: there is no text channel here for the player who set a trap. */
  trap: boolean;
  selfStated: boolean;
  conditions: Condition[];
  /** Today's vocabulary, for readers that predate `label`. */
  cause: LegacyCause;
  confidence: "high" | "low";
}
