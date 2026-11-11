import type {
  Condition, Grade, InferredFamily, LifeDeathFacts, PublicCauseKey, PublicDeath, StoredVerdict, TrapCredit, WriterBrief,
} from "./types.js";
import {
  CAPTION, CAUSE_VOCAB, COARSE_TO_LEGACY, CREDIT_DIRECTIVE, CREDIT_TEXT, INFERRED_CAUSE_DIRECTIVE, LOGOUT_CAUSES,
  LOGOUT_SENTENCE, NAMES_NO_PERSON_DIRECTIVE, OBJECT_LABEL, PUBLIC_INFERRED, PUBLIC_ROWS, PVP_UNNAMED_VARIANT,
  STATED_COARSE, STRONG_CAUSE_DIRECTIVE, TRAP_DEVICE_OF_CAUSE, UPSTREAM_TO_PUBLIC, WITHHELD_DIRECTIVE,
  formatDistance, gradeOf, inferredOf, legacyCause, publicConditions,
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
 *     player kill AND the verdict is not a best reading; the name comes from the life, never from
 *     the verdict;
 *   - a driver is printed only when the kill line names one, and never as the killer;
 *   - "their own" is printed only when the kill line names the victim;
 *   - the player who set a trap appears only through the `credit` argument, which the caller reads
 *     from a `kills` row — this function never builds a credit from an attribution;
 *   - a death after a knock-out prints the cause of the knock-out, worded "died after", and
 *     nothing about how the player left.
 *
 * ⚠️ It fails closed. The verdict is a database row: a cause, a confidence, an object or a
 * condition this release does not know reads as "Not recorded" or is left out. Nothing here may
 * throw on a stored value (one bad row would take a whole feed down) and nothing unknown may be
 * printed as fact. The object and the credit are checked against the cause for the same reason:
 * the caller and the classifier are trusted to be consistent nowhere.
 *
 * ⚠️ The writer's line and directives are built here, from the verdict, in the same pass as the
 * public death. They are not worked back from a `PublicDeath`: that shape deliberately carries no
 * marker for a knock-out, so anything that reads one back out of its sentences breaks silently
 * the day a sentence is reworded.
 */

interface Presented { death: PublicDeath; brief: WriterBrief }

const EMPTY: WordingInput = { name: null, weapon: null, distance: null, object: null, conditions: [] };

const none = (key: "withheld" | "unknown"): Presented => {
  const w = PUBLIC_ROWS[key].stated(EMPTY);
  return {
    death: {
      status: "final", key, tag: "Unknown", certainty: "unknown", label: w.label, detail: null, sentence: w.sentence,
      caption: null, killerGamertag: null, driverGamertag: null, credit: null, trap: false, selfStated: false,
      conditions: [], ...legacyCause(key, "unknown"),
    },
    brief: { line: null, creditLine: null, directives: key === "withheld" ? [WITHHELD_DIRECTIVE] : [] },
  };
};

/** The instructions that go with a cause line: one for the grade, then one for the cause. */
function directivesOf(death: PublicDeath, grade: Grade): string[] {
  const out: string[] = [];
  if (grade === "strong") out.push(STRONG_CAUSE_DIRECTIVE);
  if (grade === "inferred") out.push(INFERRED_CAUSE_DIRECTIVE);
  if (death.credit) {
    out.push(CREDIT_DIRECTIVE(death.credit.gamertag, death.credit.device));
  } else if (death.tag === "Trap" || death.tag === "Vehicle" || death.tag === "Fire"
    || (death.tag === "Explosion" && !death.selfStated)) {
    out.push(NAMES_NO_PERSON_DIRECTIVE);
  }
  return out;
}

/**
 * Whether an inferred cause of this family may be shown. ⚠️ A row with no family (fall, wildlife,
 * a held grenade, a vehicle run-over, ...) is never shown inferred: spec 2.1 promises that every
 * inferred cause has a switch that withdraws it, and the operator approved six families only.
 * Giving such a row a family (and a `PUBLIC_INFERRED` switch) is the way to show it.
 */
function inferredShown(family: InferredFamily | null): boolean {
  return family != null && PUBLIC_INFERRED[family] === true;
}

/** 1. A death that followed a knock-out prints the cause of the knock-out. */
function presentAfterKnockOut(v: StoredVerdict, conditions: Condition[]): Presented {
  const up = v.upstream;
  const key = up && typeof up.cause === "string" && Object.hasOwn(UPSTREAM_TO_PUBLIC, up.cause)
    ? UPSTREAM_TO_PUBLIC[up.cause] ?? null : null;
  const words = key ? LOGOUT_SENTENCE[key] : undefined;
  const stored = up ? gradeOf(up.confidence) : null;
  if (!key || !words || !stored) return none("withheld");
  // Never shown as stated outright: the log states the knock-out, not that it was the end.
  const grade: Grade = stored === "definitive" ? "strong" : stored;
  const row = PUBLIC_ROWS[key];
  const inferred = grade === "inferred";
  if (inferred && !inferredShown(row.family)) return none("unknown");
  const death: PublicDeath = {
    status: "final", key, tag: row.tag, certainty: grade,
    label: inferred ? inferredOf(row).label : row.stated(EMPTY).label,
    detail: null,
    sentence: inferred ? words.inferred : words.strong,
    caption: CAPTION[grade],
    killerGamertag: null, driverGamertag: null, credit: null, trap: false, selfStated: false,
    conditions, ...legacyCause(key, grade),
  };
  // The by-cause directive is kept here on purpose: it says nothing about how the player left,
  // and an explosion still names no person. Pinned in present.test.ts.
  return { death, brief: { line: inferred ? words.inferredPromptLine : words.promptLine, creditLine: null,
    directives: directivesOf(death, grade) } };
}

/**
 * Which public row a stored verdict prints under. Null means "Not recorded".
 * `killer` is the name the kill line gives, when it may be printed; `self` is true when the kill
 * line names the victim.
 */
function keyFor(v: StoredVerdict, killer: string | null, self: boolean): PublicCauseKey | null {
  const key = CAUSE_VOCAB[v.cause].key;
  if (v.cause === "pvp") {
    if (killer) return "pvp";
    // ⚠️ "Shot" needs the positive signal. Never infer it from what is absent: a player kill with
    // no name and no object is also a punch with an item in hand, or a name withheld.
    if (v.ownerlessFirearm === true && v.mechanismStated === true) return "shot";
    return "pvp_unnamed";
  }
  // "Own" is a claim about a person. It is printed only when the kill line makes it.
  if (key === "own_explosive") return self ? "own_explosive" : "explosion";
  if (key === "self_inflicted") return self ? "self_inflicted" : null;
  return key;
}

function present(v: StoredVerdict, life: LifeDeathFacts, credit: TrapCredit | null): Presented {
  // A cause this release does not know. `Object.hasOwn`, so "toString" is not a cause either.
  if (typeof v.cause !== "string" || !Object.hasOwn(CAUSE_VOCAB, v.cause)) return none("unknown");
  const conditions = publicConditions(v.conditions);
  if (LOGOUT_CAUSES.has(v.cause)) return presentAfterKnockOut(v, conditions);

  const stored = gradeOf(v.confidence);
  if (!stored) return none("unknown");

  // Names and "own" are stated by a kill line or not at all. A best reading has no kill line, so
  // an inferred verdict carries neither, whatever its basis claims.
  const lineStated = stored !== "inferred";
  const named = lineStated && v.attrBasis === "kill_line" && life.deathCause === "pvp" ? life.deathByGamertag || null : null;
  const self = lineStated && v.attrBasis === "kill_line_self";
  const key = keyFor(v, named, self);
  if (key == null) return none("unknown");
  if (key === "withheld" || key === "unknown") return none(key);
  const row = PUBLIC_ROWS[key];

  // Where the log states what happened and the grade is about something never printed (the
  // source of a wound, who fired), the death is not hedged below strong.
  const grade: Grade = row.gradesWhatIsNotPrinted && v.mechanismStated === true && stored === "inferred" ? "strong" : stored;
  const inferred = grade === "inferred";

  // 2. An inferred family that has been switched off reads "Not recorded", and so does an inferred
  //    cause on a row with no family: it has no switch to withdraw it.
  if (inferred && !inferredShown(row.family)) return none("unknown");

  // 3. Names. Only what the kill line names.
  const killerGamertag = key === "pvp" || key === "held_grenade" ? named : null;
  const driverGamertag = lineStated && key === "hit_by_vehicle_driver" && v.attrBasis === "kill_line_driver"
    ? life.deathByGamertag || null : null;

  // 4. The detail, at definitive and strong only, and only an object the row can hold.
  const object: ObjectLabel | null = !inferred && row.detail === "object" && v.objectKey != null
    && row.objects?.includes(v.objectKey) ? OBJECT_LABEL[v.objectKey] : null;
  const weapon = !inferred && row.detail === "weapon" ? life.deathWeapon : null;
  const distance = weapon && key === "pvp" ? life.deathDistance : null;
  let detail: string | null = null;
  if (!inferred && row.detail === "object") detail = object?.short ?? (key === "held_grenade" ? "Grenade" : null);
  if (!inferred && row.detail === "weapon") {
    detail = [weapon, distance != null ? formatDistance(distance) : null].filter(Boolean).join(" · ") || null;
  }

  const input: WordingInput = { name: killerGamertag ?? driverGamertag, weapon, distance, object, conditions };
  const words = inferred ? inferredOf(row, input) : row.stated(input);
  // The writer is never given a driver.
  const writerWords = inferred ? inferredOf(row, input) : row.stated({ ...input, name: killerGamertag });

  // An unnamed player kill says "the log has no kill line" only when that is so.
  const unnamed = key !== "pvp_unnamed" || inferred ? null
    : v.attrBasis === "kill_line" ? PVP_UNNAMED_VARIANT.nameWithheld
      : v.mechanismStated === true ? PVP_UNNAMED_VARIANT.onKillLine : null;

  // 5. Flags, as booleans.
  const device = TRAP_DEVICE_OF_CAUSE[v.cause] ?? null;
  const trap = device != null;
  const selfStated = self && (key === "own_explosive" || key === "self_inflicted");

  // A credit is shown only on a trap death that is stated or strong, only when handed in, and
  // only when it is for the device this death was.
  const shown = credit && device && !inferred && credit.device === device
    && typeof credit.gamertag === "string" && credit.gamertag !== "" ? credit : null;
  const creditText = shown && device ? CREDIT_TEXT[device] : null;
  const base = unnamed?.sentence ?? words.sentence;
  const sentence = shown && creditText ? `${base} ${creditText.sentenceSuffix(shown.gamertag)}` : base;
  const caption = shown && creditText
    ? (shown.byOperator === true ? creditText.operatorCaption : creditText.caption(shown.gamertag))
    : CAPTION[grade];

  const death: PublicDeath = {
    status: "final", key, tag: row.tag, certainty: grade, label: words.label, detail, sentence, caption,
    killerGamertag, driverGamertag,
    credit: shown && device ? { gamertag: shown.gamertag, basis: "trap_placement", device, byOperator: shown.byOperator === true } : null,
    trap, selfStated, conditions, ...legacyCause(key, grade),
  };
  return {
    death,
    brief: {
      line: row.noPromptLine ? null : unnamed?.promptLine ?? writerWords.promptLine,
      creditLine: shown && creditText ? creditText.writerLine(shown.gamertag) : null,
      directives: directivesOf(death, grade),
    },
  };
}

/**
 * The public reading of a stored verdict.
 *
 * `life` is the life row's own record of its end. `credit` is the trap kill credited for this
 * death, when the caller found one; leave it out and no credit is shown, whatever the verdict
 * holds.
 */
export function toPublicDeath(v: StoredVerdict, life: LifeDeathFacts, credit: TrapCredit | null = null): PublicDeath {
  return present(v, life, credit).death;
}

/**
 * What the obituary writer is given about the same death: the cause line, the credit line and the
 * fixed instructions. It takes the same three arguments as `toPublicDeath` and agrees with it by
 * construction. A death with no stored verdict has no brief: no obituary is written until one
 * exists.
 *
 * A named driver is never in the line.
 */
export function writerBrief(v: StoredVerdict, life: LifeDeathFacts, credit: TrapCredit | null = null): WriterBrief {
  return present(v, life, credit).brief;
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
