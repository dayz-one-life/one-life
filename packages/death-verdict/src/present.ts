import type {
  Confidence, LifeDeathFacts, PublicCauseKey, PublicDeath, StoredVerdict, TrapCredit,
} from "./types.js";
import {
  CAPTION, CAUSE_VOCAB, COARSE_TO_LEGACY, CREDIT_DIRECTIVE, CREDIT_TEXT, INFERRED_CAUSE_DIRECTIVE, LOGOUT_CAUSES,
  LOGOUT_SENTENCE, NAMES_NO_PERSON_DIRECTIVE, OBJECT_LABEL, PUBLIC_INFERRED, PUBLIC_ROWS, PVP_UNNAMED_ON_KILL_LINE,
  STATED_COARSE,
  STRONG_CAUSE_DIRECTIVE, UPSTREAM_TO_PUBLIC, WITHHELD_DIRECTIVE, formatDistance, inferredOf, legacyCause,
  type ObjectLabel, type WordingInput,
} from "./vocabulary.js";

/**
 * The one way a death leaves the server.
 *
 * ⚠️ Read this before changing what any branch returns. The stored verdict knows things that must
 * never be published: that a player logged out or respawned while down, who probably set a trap,
 * who probably fired, who was nearby. `StoredVerdict` does not carry those names at all, and the
 * rules below keep the rest in:
 *   - a killer is printed only when the kill line names one AND the life itself was recorded as a
 *     player kill; the name comes from the life, never from the verdict;
 *   - a driver is printed only when the kill line names one, and never as the killer;
 *   - "their own" is printed only when the kill line names the victim;
 *   - the player who set a trap appears only through the `credit` argument, which the caller reads
 *     from a `kills` row — this function never builds a credit from an attribution;
 *   - a death after a knock-out prints the cause of the knock-out, worded "died after", and
 *     nothing about how the player left.
 */

const none = (key: "withheld" | "unknown"): PublicDeath => {
  const w = PUBLIC_ROWS[key].stated(EMPTY);
  return {
    status: "final", key, tag: "Unknown", certainty: "unknown", label: w.label, detail: null, sentence: w.sentence,
    caption: null, killerGamertag: null, driverGamertag: null, credit: null, trap: false, selfStated: false,
    conditions: [], ...legacyCause(key, "unknown"),
  };
};
const EMPTY: WordingInput = { name: null, weapon: null, distance: null, object: null, conditions: [] };

/** Which public row a stored verdict prints under. Null means "Not recorded". */
function keyFor(v: StoredVerdict, killer: string | null): PublicCauseKey | null {
  const key = CAUSE_VOCAB[v.cause].key;
  if (v.cause === "pvp") {
    if (killer) return "pvp";
    // A kill line that names a weapon and nobody behind it: the rounds landed after their
    // shooter had dropped. An object key means the line named a thing, not a firearm.
    if (v.mechanismStated && v.objectKey == null) return "shot";
    return "pvp_unnamed";
  }
  // "Own" is a claim about a person. It is printed only when the kill line makes it.
  if (key === "own_explosive") return v.attrBasis === "kill_line_self" ? "own_explosive" : "explosion";
  if (key === "self_inflicted") return v.attrBasis === "kill_line_self" ? "self_inflicted" : null;
  return key;
}

function minStrong(c: Confidence): Confidence {
  return c === "definitive" ? "strong" : c;
}

/**
 * The public reading of a stored verdict.
 *
 * `life` is the life row's own record of its end. `credit` is the trap kill credited for this
 * death, when the caller found one; leave it out and no credit is shown, whatever the verdict
 * holds.
 */
export function toPublicDeath(v: StoredVerdict, life: LifeDeathFacts, credit: TrapCredit | null = null): PublicDeath {
  // 1. A death that followed a knock-out prints the cause of the knock-out.
  if (LOGOUT_CAUSES.has(v.cause)) {
    const key = v.upstream ? UPSTREAM_TO_PUBLIC[v.upstream.cause] ?? null : null;
    const words = key ? LOGOUT_SENTENCE[key] : undefined;
    if (!v.upstream || !key || !words || v.upstream.confidence === "unknown") return none("withheld");
    const certainty = minStrong(v.upstream.confidence);
    const row = PUBLIC_ROWS[key];
    const inferred = certainty === "inferred";
    if (inferred && row.family && !PUBLIC_INFERRED[row.family]) return none("unknown");
    return {
      status: "final", key, tag: row.tag, certainty,
      label: inferred ? inferredOf(row).label : row.stated(EMPTY).label,
      detail: null,
      sentence: inferred ? words.inferred : words.strong,
      caption: inferred ? CAPTION.inferred : CAPTION.strong,
      killerGamertag: null, driverGamertag: null, credit: null, trap: false, selfStated: false,
      conditions: v.conditions, ...legacyCause(key, certainty),
    };
  }

  if (v.confidence === "unknown") return none("unknown");

  const namedOnKillLine = v.attrBasis === "kill_line" && life.deathCause === "pvp" ? life.deathByGamertag : null;
  const key = keyFor(v, namedOnKillLine);
  if (key == null) return none("unknown");
  if (key === "withheld" || key === "unknown") return none(key);
  const row = PUBLIC_ROWS[key];
  const certainty = v.confidence;
  const inferred = certainty === "inferred";

  // 2. An inferred family that has been switched off reads "Not recorded".
  if (inferred && row.family && !PUBLIC_INFERRED[row.family]) return none("unknown");

  // 3. Names. Only what the kill line names.
  const killerGamertag = key === "pvp" || key === "held_grenade" ? namedOnKillLine : null;
  const driverGamertag = key === "hit_by_vehicle_driver" && v.attrBasis === "kill_line_driver" ? life.deathByGamertag : null;

  // 4. The detail, at definitive and strong only.
  const object: ObjectLabel | null = !inferred && v.objectKey ? OBJECT_LABEL[v.objectKey] : null;
  const weapon = !inferred && row.detail === "weapon" ? life.deathWeapon : null;
  const distance = weapon && key === "pvp" ? life.deathDistance : null;
  let detail: string | null = null;
  if (!inferred && row.detail === "object") detail = object?.short ?? (key === "held_grenade" ? "Grenade" : null);
  if (!inferred && row.detail === "weapon") {
    detail = [weapon, distance != null ? formatDistance(distance) : null].filter(Boolean).join(" · ") || null;
  }

  const input: WordingInput = { name: killerGamertag ?? driverGamertag, weapon, distance, object, conditions: v.conditions };
  const words = inferred ? inferredOf(row, input) : row.stated(input);

  // 5. Flags, as booleans.
  const trap = v.cause === "explosive_trap" || v.cause === "landmine";
  const selfStated = v.attrBasis === "kill_line_self";

  // A credit is shown only on a trap death that is stated or strong, and only when handed in.
  const shown = credit && trap && !inferred ? credit : null;
  const creditText = shown ? CREDIT_TEXT[shown.device] : null;
  const base = key === "pvp_unnamed" && v.mechanismStated && !inferred ? PVP_UNNAMED_ON_KILL_LINE : words.sentence;
  const sentence = shown && creditText ? `${base} ${creditText.sentenceSuffix(shown.gamertag)}` : base;
  const caption = shown && creditText
    ? (shown.byOperator ? creditText.operatorCaption : creditText.caption(shown.gamertag))
    : certainty === "strong" ? CAPTION.strong : inferred ? CAPTION.inferred : null;

  return {
    status: "final", key, tag: row.tag, certainty, label: words.label, detail, sentence, caption,
    killerGamertag, driverGamertag,
    credit: shown ? { gamertag: shown.gamertag, basis: "trap_placement", device: shown.device, byOperator: shown.byOperator } : null,
    trap, selfStated, conditions: v.conditions, ...legacyCause(key, certainty),
  };
}

/**
 * A death with no stored verdict yet. Only what the death line itself states is shown: a specific
 * coarse word prints its family with no detail, and anything else reads "Awaiting the record" —
 * never "Unknown", because the answer is on its way. There is no fallback classification here.
 *
 * A player kill keeps its killer, so a page never loses the name while the verdict is pending.
 */
export function pendingPublicDeath(life: LifeDeathFacts): PublicDeath {
  const coarse = life.deathCause ?? "";
  const key: PublicCauseKey = Object.hasOwn(STATED_COARSE, coarse) ? STATED_COARSE[coarse]! : "awaiting";
  const killerGamertag = key === "pvp" ? life.deathByGamertag : null;
  const words = PUBLIC_ROWS[key].stated({ ...EMPTY, name: killerGamertag });
  const legacy = Object.hasOwn(COARSE_TO_LEGACY, coarse) ? COARSE_TO_LEGACY[coarse]! : null;
  return {
    status: "pending", key, tag: null, certainty: key === "awaiting" ? "unknown" : "definitive",
    label: words.label, detail: null, sentence: words.sentence, caption: null,
    killerGamertag, driverGamertag: null, credit: null, trap: false, selfStated: false, conditions: [],
    cause: legacy ?? "unknown", confidence: legacy ? "high" : "low",
  };
}

/** True when the death is worded as following a knock-out. Read off the sentence, because the
 *  public shape deliberately carries no marker for it. */
function logoutWords(p: PublicDeath) {
  const w = LOGOUT_SENTENCE[p.key];
  return w && (p.sentence === w.strong || p.sentence === w.inferred) ? w : null;
}

/**
 * The cause line the writer is given, or null when it is given none (not recorded, withheld,
 * pending). An inferred line starts "most likely" and belongs under `NOT_CONFIRMED_HEADING`.
 *
 * `life` adds the weapon and distance of a player kill; without it the line names the killer only.
 * A named driver is never in the line.
 */
export function promptLine(p: PublicDeath, life: LifeDeathFacts | null = null): string | null {
  if (p.status !== "final") return null;
  const row = PUBLIC_ROWS[p.key];
  if (row.noPromptLine) return null;
  const inferred = p.certainty === "inferred";
  const logout = logoutWords(p);
  if (logout) return inferred ? logout.inferredPromptLine : logout.promptLine;
  const object = p.detail && row.detail === "object"
    ? Object.values(OBJECT_LABEL).find((o) => o.short === p.detail) ?? null : null;
  const input: WordingInput = {
    name: p.killerGamertag,
    weapon: p.key === "pvp" ? life?.deathWeapon ?? null : null,
    distance: p.key === "pvp" && life?.deathWeapon ? life.deathDistance : null,
    object, conditions: p.conditions,
  };
  return (inferred ? inferredOf(row, input) : row.stated(input)).promptLine;
}

/** The fixed instructions that go with a death's cause line, in the order they are sent. */
export function directivesFor(p: PublicDeath): string[] {
  if (p.status !== "final" || p.key === "unknown" || p.key === "awaiting") return [];
  if (p.key === "withheld") return [WITHHELD_DIRECTIVE];
  const out: string[] = [];
  if (p.certainty === "strong") out.push(STRONG_CAUSE_DIRECTIVE);
  if (p.certainty === "inferred") out.push(INFERRED_CAUSE_DIRECTIVE);
  if (p.credit) {
    out.push(CREDIT_DIRECTIVE(p.credit.gamertag, p.credit.device));
  } else if (p.tag === "Trap" || p.tag === "Vehicle" || p.tag === "Fire" || (p.tag === "Explosion" && !p.selfStated)) {
    out.push(NAMES_NO_PERSON_DIRECTIVE);
  }
  return out;
}
