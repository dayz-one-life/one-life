import type {
  Confidence, InferredFamily, InternalCause, LegacyCause, ObjectKey, PublicCauseKey, PublicTag, TrapDevice,
} from "./types.js";

/**
 * Every public word about a death lives in this file. Pages, cards, images, tags and the writer's
 * prompt all take their wording from here, so a death reads the same everywhere.
 *
 * ⚠️ Wording is a function of (cause, certainty). No string exists at one certainty only: an
 * inferred cause always says "Likely" on a label and a sentence and "most likely" to the writer,
 * and a stated or strong one never does. vocabulary.test.ts walks every pair.
 *
 * ⚠️ Three words are never public, in any string: the two named illnesses and the named heat
 * condition the classifier distinguishes internally. They print as "Illness" and "Exposure".
 */

const NBSP = " ";

/** What a wording function may be given. Every field can be absent; each function words around it. */
export interface WordingInput {
  /** A player the kill line itself names: the killer, or the driver. Never anyone else. */
  name: string | null;
  weapon: string | null;
  distance: number | null;
  object: ObjectLabel | null;
  conditions: readonly string[];
}

export interface ObjectLabel {
  /** Standing alone, as a detail: "M67 frag grenade". */
  short: string;
  /** After "by": "an M67 frag grenade". */
  withArticle: string;
  /** After "their own": "40mm round". */
  bare: string;
}

export const OBJECT_LABEL: Record<ObjectKey, ObjectLabel> = {
  m67_grenade: { short: "M67 frag grenade", withArticle: "an M67 frag grenade", bare: "M67 frag grenade" },
  rgd5_grenade: { short: "RGD-5 frag grenade", withArticle: "an RGD-5 frag grenade", bare: "RGD-5 frag grenade" },
  claymore: { short: "Claymore", withArticle: "a claymore", bare: "claymore" },
  land_mine: { short: "Land mine", withArticle: "a land mine", bare: "land mine" },
  round_40mm: { short: "40mm round", withArticle: "a 40mm explosive round", bare: "40mm round" },
  // The launcher is named on the line, but what killed was the round it fired.
  m79: { short: "40mm round", withArticle: "a 40mm explosive round", bare: "40mm round" },
  plastic_explosive: { short: "Plastic explosive", withArticle: "plastic explosive", bare: "plastic explosive" },
  fuel_pump: { short: "Fuel pump", withArticle: "a fuel pump", bare: "fuel pump" },
  fireplace: { short: "Fireplace", withArticle: "a fireplace", bare: "fireplace" },
  motorbike: { short: "Motorbike", withArticle: "a motorbike", bare: "motorbike" },
  car: { short: "Car", withArticle: "a car", bare: "car" },
  barbed_wire: { short: "Barbed wire", withArticle: "barbed wire", bare: "barbed wire" },
  bear_trap: { short: "Bear trap", withArticle: "a bear trap", bare: "bear trap" },
};

/** The classifier's wording for an object, verbatim, to its public key. Everything not listed
 *  (knives, guns, infected and animal classes) has no key. */
export const OBJECT_KEY_FROM_TEXT: Record<string, ObjectKey> = {
  "Tripwire + M67 frag grenade": "m67_grenade",
  "M67 frag grenade": "m67_grenade",
  "fists holding 6-M7 Frag Grenade": "m67_grenade",
  "Tripwire + RGD-5 frag grenade": "rgd5_grenade",
  "RGD-5 frag grenade": "rgd5_grenade",
  "Tripwire + Claymore": "claymore",
  "Land mine": "land_mine",
  "40mm explosive round": "round_40mm",
  "M79 (40mm explosive round)": "m79",
  "Plastic explosive": "plastic_explosive",
  "Fireplace": "fireplace",
  "Land_FuelStation_Feed": "fuel_pump",
  "CivilianSedan": "car",
  "Barbed wire (Fence)": "barbed_wire",
  "Barbed wire (Watchtower)": "barbed_wire",
};
// Vehicle classes come in colour and map variants, so these are matched by prefix. The car list is
// the parser's own (packages/adm-parser/src/death.ts), without the boat.
const OBJECT_KEY_PREFIXES: readonly [RegExp, ObjectKey][] = [
  [/^Motorbike_/u, "motorbike"],
  [/^(CivilianSedan|Hatchback_|Sedan_|Offroad|Truck_)/u, "car"],
  [/^Land_FuelStation_Feed/u, "fuel_pump"],
];

/** The public key for the classifier's object wording, or null when it has none. */
export function objectKeyFromText(text: string | null | undefined): ObjectKey | null {
  if (!text) return null;
  if (Object.hasOwn(OBJECT_KEY_FROM_TEXT, text)) return OBJECT_KEY_FROM_TEXT[text]!;
  return OBJECT_KEY_PREFIXES.find(([re]) => re.test(text))?.[1] ?? null;
}

const OBJECT_KEYS = new Set<string>(Object.keys(OBJECT_LABEL));
export function isObjectKey(v: unknown): v is ObjectKey {
  return typeof v === "string" && OBJECT_KEYS.has(v);
}

/**
 * Per-family switch for inferred causes. Turning one off sends every inferred death of that family
 * back to "Not recorded" at once — label, sentence, caption and tag — without re-deriving
 * anything. It does not retract prose already written or posts already sent.
 */
export const PUBLIC_INFERRED: Record<InferredFamily, boolean> = {
  exposure: true, illness: true, vehicle_crash: true, hunger_thirst: true, infected: true, pvp: true,
};

export const FAMILY_TAG: Record<InferredFamily, PublicTag> = {
  exposure: "Exposure", illness: "Illness", vehicle_crash: "Vehicle", hunger_thirst: "Hunger and Thirst",
  infected: "Infected", pvp: "PvP",
};

export const CAPTION = {
  strong: "Worked out from the log",
  inferred: "Best reading of the log. The server recorded no cause.",
} as const;

// ---------------------------------------------------------------------------------------------
// The public rows: one per key.
// ---------------------------------------------------------------------------------------------

interface Wording { label: string; sentence: string; promptLine: string }

export interface PublicRow {
  tag: PublicTag;
  family: InferredFamily | null;
  /** What may be printed beside the label, at definitive or strong only. */
  detail: "object" | "weapon" | "none";
  /** Wording at definitive and strong. */
  stated: (o: WordingInput) => Wording;
  /** Wording at inferred, where the row has its own. Otherwise it is derived: see `inferredOf`. */
  inferred?: Wording;
  /** Rows the writer is given no cause line for. */
  noPromptLine?: true;
  legacy: LegacyCause;
  /** Legacy word at inferred, for the three rows today's readers already hedge themselves. */
  legacyInferred?: LegacyCause;
}

const fixed = (label: string, sentence: string, promptLine: string) => (): Wording => ({ label, sentence, promptLine });
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Distances print as the rest of the site prints them: rounded, with a space that cannot wrap. */
export function formatDistance(meters: number): string {
  return `${Math.round(meters)}${NBSP}m`;
}

function suicideLabel(conditions: readonly string[]): string {
  // Unchanged from the wording the site has always used for a suicide.
  const conds = conditions.filter((c) => c !== "healthy");
  if (conds.length) return `Suicide (${conds.join(", ")})`;
  if (conditions.includes("healthy")) return "Suicide (in good health)";
  return "Suicide";
}
function suicidePromptLine(conditions: readonly string[]): string {
  const conds = conditions.filter((c) => c !== "healthy");
  const state = conds.length
    ? ` At the end they were ${conds.join(" and ")}.`
    : conditions.includes("healthy") ? " They were in good health at the end." : "";
  return state ? `died by their own hand.${state}` : "died by their own hand";
}

export const PUBLIC_ROWS: Record<PublicCauseKey, PublicRow> = {
  pvp: {
    tag: "PvP", family: "pvp", detail: "weapon", legacy: "pvp",
    stated: ({ name, weapon, distance }) => {
      if (!name) return { label: "Killed", sentence: "Killed by another player.", promptLine: "killed by another player" };
      const dist = distance != null ? formatDistance(distance) : null;
      return {
        label: `Killed by ${name}`,
        sentence: `Killed by ${name}${weapon ? ` with ${weapon}` : ""}${dist ? ` from ${dist}` : ""}.`,
        promptLine: `killed by another player (${name})${weapon ? `, ${weapon}` : ""}${dist ? `, from ${dist}` : ""}`,
      };
    },
  },
  pvp_unnamed: {
    tag: "PvP", family: "pvp", detail: "none", legacy: "pvp",
    stated: fixed("Killed", "Killed by another player. The log has no kill line, so no name is given.",
      "killed by another player; the record names no one"),
    inferred: { label: "Likely killed", sentence: "Likely killed by another player.",
      promptLine: "most likely killed by another player; the record names no one" },
  },
  shot: {
    tag: "Gunfire", family: null, detail: "weapon", legacy: "pvp",
    stated: fixed("Shot", "Shot. The log names no shooter.", "shot dead; the record names no shooter"),
  },
  held_grenade: {
    tag: "PvP", family: null, detail: "object", legacy: "pvp",
    stated: ({ name }) => name
      ? { label: `Killed by ${name}`, sentence: `Killed by ${name} (a grenade).`,
          promptLine: `killed by another player (${name}) with a grenade` }
      : { label: "Killed", sentence: "Killed by another player (a grenade).", promptLine: "killed by another player with a grenade" },
  },
  suicide: {
    tag: "Self-Inflicted", family: null, detail: "none", legacy: "suicide",
    stated: ({ conditions }) => ({ label: suicideLabel(conditions), sentence: "Died by their own hand.",
      promptLine: suicidePromptLine(conditions) }),
  },
  self_inflicted: {
    tag: "Self-Inflicted", family: null, detail: "none", legacy: "suicide",
    stated: fixed("Self-inflicted", "Died by their own weapon.", "died by their own weapon"),
  },
  tripwire: {
    tag: "Trap", family: null, detail: "object", legacy: "explosion",
    stated: ({ object }) => {
      const what = object ? `a tripwire rigged with ${object.withArticle}` : "a tripwire";
      return { label: "Tripwire", sentence: `Killed by ${what}.`, promptLine: `killed by ${what}` };
    },
  },
  land_mine: {
    tag: "Trap", family: null, detail: "none", legacy: "explosion",
    stated: fixed("Land mine", "Killed by a land mine.", "killed by a land mine"),
  },
  grenade: {
    tag: "Explosion", family: null, detail: "object", legacy: "explosion",
    stated: ({ object }) => {
      const what = object?.withArticle ?? "a grenade";
      return { label: "Grenade", sentence: `Killed by ${what}. The log names no thrower.`, promptLine: `killed by ${what}` };
    },
  },
  explosion: {
    tag: "Explosion", family: null, detail: "object", legacy: "explosion",
    stated: ({ object }) => {
      const what = object?.withArticle ?? "an explosion";
      return { label: "Explosion", sentence: `Killed by ${what}.`, promptLine: `killed by ${what}` };
    },
  },
  own_explosive: {
    tag: "Explosion", family: null, detail: "object", legacy: "explosion",
    stated: ({ object }) => {
      const what = `their own ${object?.bare ?? "explosive"}`;
      return { label: "Own explosive", sentence: `Killed by ${what}.`, promptLine: `killed by ${what}` };
    },
  },
  fuel_pump: {
    tag: "Explosion", family: null, detail: "none", legacy: "explosion",
    stated: fixed("Fuel pump explosion", "Killed by an exploding fuel pump.", "killed by an exploding fuel pump"),
  },
  // No fireplace is named: the object is player-placed, and a few fire ticks are not "burned to
  // death in a fireplace".
  burned: {
    tag: "Fire", family: null, detail: "none", legacy: "environmental",
    stated: fixed("Burned", "Died of burns from a fire.", "died of burns from a fire"),
  },
  infected: {
    tag: "Infected", family: "infected", detail: "none", legacy: "infected",
    stated: fixed("Infected", "Killed by infected.", "killed by the infected"),
    inferred: { label: "Likely infected", sentence: "Likely killed by infected.", promptLine: "most likely killed by the infected" },
  },
  wolf: { tag: "Wildlife", family: null, detail: "none", legacy: "wolf",
    stated: fixed("Wolf", "Killed by a wolf.", "killed by a wolf") },
  bear: { tag: "Wildlife", family: null, detail: "none", legacy: "bear",
    stated: fixed("Bear", "Killed by a bear.", "killed by a bear") },
  dog: { tag: "Wildlife", family: null, detail: "none", legacy: "animal",
    stated: fixed("Dog", "Killed by a dog.", "killed by a dog") },
  animal: { tag: "Wildlife", family: null, detail: "none", legacy: "animal",
    stated: fixed("Animal", "Killed by an animal.", "killed by an animal") },
  fall: { tag: "Fall", family: null, detail: "none", legacy: "fall",
    stated: fixed("Fell", "Fell to their death.", "fell to their death") },
  drowned: { tag: "Drowned", family: null, detail: "none", legacy: "environmental",
    stated: fixed("Drowned", "Drowned.", "drowned") },
  hit_by_vehicle: {
    tag: "Vehicle", family: null, detail: "object", legacy: "vehicle",
    stated: fixed("Hit by a vehicle", "Hit by a vehicle. The log names no driver.", "struck and killed by a vehicle"),
  },
  // The driver is printed on the life page as the log has it — in the seat — never as the killer,
  // and is not given to the writer at all.
  hit_by_vehicle_driver: {
    tag: "Vehicle", family: null, detail: "object", legacy: "vehicle",
    stated: ({ name }) => ({ label: "Hit by a vehicle",
      sentence: name ? `Hit by a vehicle. The log puts ${name} in the driver's seat.` : "Hit by a vehicle.",
      promptLine: "struck and killed by a vehicle" }),
  },
  motorbike_crash: {
    tag: "Vehicle", family: "vehicle_crash", detail: "none", legacy: "vehicle",
    stated: fixed("Motorbike crash", "Died in a motorbike crash.", "died in a motorbike crash"),
    inferred: { label: "Likely a motorbike crash", sentence: "Likely died in a motorbike crash.",
      promptLine: "most likely died in a motorbike crash" },
  },
  vehicle_crash: {
    tag: "Vehicle", family: "vehicle_crash", detail: "none", legacy: "vehicle",
    stated: fixed("Vehicle crash", "Died in a vehicle crash.", "died in a vehicle crash"),
    inferred: { label: "Likely a vehicle crash", sentence: "Likely died in a vehicle crash.",
      promptLine: "most likely died in a vehicle crash" },
  },
  // Only the pending state uses this row: the death line says "vehicle" and nothing finer yet.
  vehicle: {
    tag: "Vehicle", family: null, detail: "none", legacy: "vehicle",
    stated: fixed("Vehicle", "Killed in a vehicle incident.", "killed in a vehicle incident"),
  },
  // No source is named. The bleed is stated; where it came from is a reading.
  bled_out: { tag: "Blood Loss", family: null, detail: "none", legacy: "bled_out",
    stated: fixed("Bled out", "Bled out.", "bled out") },
  starvation: {
    tag: "Hunger and Thirst", family: "hunger_thirst", detail: "none", legacy: "starvation", legacyInferred: "starvation",
    stated: fixed("Starvation", "Starved to death.", "starved"),
    inferred: { label: "Likely starvation", sentence: "Likely starved to death.", promptLine: "most likely starved" },
  },
  dehydration: {
    tag: "Hunger and Thirst", family: "hunger_thirst", detail: "none", legacy: "dehydration", legacyInferred: "dehydration",
    stated: fixed("Dehydration", "Died of thirst.", "died of thirst"),
    inferred: { label: "Likely dehydration", sentence: "Likely died of thirst.", promptLine: "most likely died of thirst" },
  },
  starvation_and_thirst: {
    tag: "Hunger and Thirst", family: "hunger_thirst", detail: "none", legacy: "starvation", legacyInferred: "starvation",
    stated: fixed("Starvation and thirst", "Starved and dehydrated.", "starved and dehydrated"),
    inferred: { label: "Likely starvation and thirst", sentence: "Likely starved and dehydrated.",
      promptLine: "most likely starved and dehydrated" },
  },
  exposure: {
    tag: "Exposure", family: "exposure", detail: "none", legacy: "environmental",
    stated: fixed("Exposure", "Died of exposure.", "died of exposure"),
    inferred: { label: "Likely exposure", sentence: "Likely died of exposure.", promptLine: "most likely died of exposure" },
  },
  illness: {
    tag: "Illness", family: "illness", detail: "none", legacy: "environmental",
    stated: fixed("Illness", "Died of illness.", "died of illness"),
    inferred: { label: "Likely illness", sentence: "Likely died of illness.", promptLine: "most likely died of illness" },
  },
  // The log does state how these ended; it is not printed. Not the same as "not recorded".
  withheld: { tag: "Unknown", family: null, detail: "none", legacy: "unknown", noPromptLine: true,
    stated: fixed("No cause given", "No cause is given for this death.", "") },
  unknown: { tag: "Unknown", family: null, detail: "none", legacy: "unknown", noPromptLine: true,
    stated: fixed("Not recorded", "The log does not say.", "") },
  // No stored verdict yet. Never "Unknown": the answer is on its way.
  awaiting: { tag: "Unknown", family: null, detail: "none", legacy: "unknown", noPromptLine: true,
    stated: fixed("Awaiting the record", "Awaiting the record.", "") },
};

/** For a player kill whose kill line exists but names a thing and no person: the standard
 *  sentence ("the log has no kill line") would be false. */
export const PVP_UNNAMED_ON_KILL_LINE = "Killed by another player. The log names no one.";

const EMPTY_INPUT: WordingInput = { name: null, weapon: null, distance: null, object: null, conditions: [] };

/** A row's wording at inferred. Rows the classifier can infer today carry their own; every other
 *  row still gets one, derived, so no certainty is ever left without words. */
export function inferredOf(row: PublicRow, o: WordingInput = EMPTY_INPUT): Wording {
  if (row.inferred) return row.inferred;
  // The object is dropped: a detail is printed only when the cause is stated or strong.
  const s = row.stated({ ...o, object: null });
  return { label: `Likely ${lowerFirst(s.label)}`, sentence: `Likely ${lowerFirst(s.sentence)}`,
    promptLine: `most likely ${s.promptLine}` };
}

// ---------------------------------------------------------------------------------------------
// Internal cause -> public row.
// ---------------------------------------------------------------------------------------------

/** The key an internal cause prints under when nothing else decides it. Three causes are refined
 *  by `present.ts`: `pvp` (three variants), the two "own" causes (printed only when the kill line
 *  names the victim), and the logout causes (which print their upstream cause). */
const KEY_OF_CAUSE: Record<InternalCause, PublicCauseKey> = {
  pvp: "pvp",
  pvp_bleedout: "bled_out",
  suicide: "suicide",
  self_inflicted: "self_inflicted",
  explosive_trap: "tripwire",
  landmine: "land_mine",
  explosive_grenade: "grenade",
  explosive_40mm: "explosion",
  explosive_charge: "explosion",
  explosive_claymore: "explosion",
  explosive_other: "explosion",
  explosive_held_grenade: "held_grenade",
  self_inflicted_explosive: "own_explosive",
  fuel_explosion: "fuel_pump",
  fire: "burned",
  infected: "infected",
  // The reference can compose this token; it is an infected attack under another name.
  animal_infected: "infected",
  animal_wolf: "wolf",
  animal_bear: "bear",
  animal_dog: "dog",
  animal: "animal",
  animal_other: "animal",
  fall: "fall",
  drowned: "drowned",
  vehicle_run_over: "hit_by_vehicle_driver",
  vehicle_impact: "hit_by_vehicle",
  vehicle_own_crash: "motorbike_crash",
  vehicle_crash_occupant: "vehicle_crash",
  bled_out_infected: "bled_out",
  bled_out_barbed_wire: "bled_out",
  bled_out_animal: "bled_out",
  bled_out_other: "bled_out",
  starvation: "starvation",
  dehydration: "dehydration",
  starvation_and_dehydration: "starvation_and_thirst",
  cold_exposure: "exposure",
  heatstroke: "exposure",
  heatstroke_or_silicosis: "exposure",
  pneumonia: "illness",
  // With no publishable upstream cause a logout death is withheld.
  respawn_while_unconscious: "withheld",
  unconscious_logout: "withheld",
  logout_under_attack: "withheld",
  restrained_logout: "withheld",
  unknown: "unknown",
};

type Grade = "definitive" | "strong" | "inferred";
export interface VocabEntry {
  label: string;
  sentence: (o: WordingInput) => string;
  promptLine: ((o: WordingInput) => string) | null;
  tag: PublicTag;
}

function entryFor(row: PublicRow, grade: Grade): VocabEntry {
  const words = (o: WordingInput) => (grade === "inferred" && !row.noPromptLine ? inferredOf(row, o) : row.stated(o));
  return {
    label: words(EMPTY_INPUT).label,
    sentence: (o) => words(o).sentence,
    promptLine: row.noPromptLine ? null : (o) => words(o).promptLine,
    tag: row.tag,
  };
}

/** Every internal cause at every certainty it can be shown at. The label here is the one printed
 *  when the kill line names nobody; `present.ts` fills names and objects in. */
export const CAUSE_VOCAB: Record<InternalCause, {
  key: PublicCauseKey; family: InferredFamily | null; by: Record<Grade, VocabEntry>;
}> = Object.fromEntries(
  (Object.entries(KEY_OF_CAUSE) as [InternalCause, PublicCauseKey][]).map(([cause, key]) => {
    const row = PUBLIC_ROWS[key];
    return [cause, { key, family: row.family, by: {
      definitive: entryFor(row, "definitive"), strong: entryFor(row, "strong"), inferred: entryFor(row, "inferred"),
    } }];
  }),
) as Record<InternalCause, { key: PublicCauseKey; family: InferredFamily | null; by: Record<Grade, VocabEntry> }>;

const INTERNAL_CAUSE_SET = new Set<string>(Object.keys(KEY_OF_CAUSE));
export function isInternalCause(v: unknown): v is InternalCause {
  return typeof v === "string" && INTERNAL_CAUSE_SET.has(v);
}

// ---------------------------------------------------------------------------------------------
// Deaths that followed a knock-out.
// ---------------------------------------------------------------------------------------------

/**
 * ⚠️ These four causes are how the classifier records that a player left, respawned or was
 * restrained while down. That marker is never public — no label, sentence, tag or writer line may
 * say or hint at it. Three of them print the cause of the knock-out instead (`LOGOUT_SENTENCE`);
 * the fourth, and any of the three with no publishable upstream cause, prints "No cause given".
 */
export const LOGOUT_CAUSES: ReadonlySet<InternalCause> = new Set<InternalCause>([
  "respawn_while_unconscious", "unconscious_logout", "logout_under_attack",
]);

/** The classifier's upstream words to the public row they print under; null is withheld. */
export const UPSTREAM_TO_PUBLIC: Record<string, PublicCauseKey | null> = {
  infected: "infected",
  fall: "fall",
  explosion: "explosion",
  vehicle: "vehicle_crash",
  vehicle_crash: "vehicle_crash",
  starvation_and_dehydration: "starvation_and_thirst",
  player: null,
  mixed: null,
  own_bear_trap: null,
  barbed_wire: null,
  vehicle_run_over: null,
  unknown: null,
};

/**
 * Wording for a death that followed a knock-out. The verb is "died after", never "killed": in
 * most of these the player still had most of their health at the last reading, and it was the
 * server that ended the unconscious body.
 */
export const LOGOUT_SENTENCE: Partial<Record<PublicCauseKey, {
  strong: string; inferred: string; promptLine: string; inferredPromptLine: string;
}>> = {
  infected: { strong: "Died after an infected attack.", inferred: "Likely died after an infected attack.",
    promptLine: "died after being attacked by the infected", inferredPromptLine: "most likely died after an infected attack" },
  fall: { strong: "Died after a fall.", inferred: "Likely died after a fall.",
    promptLine: "died after a fall", inferredPromptLine: "most likely died after a fall" },
  explosion: { strong: "Died after an explosion.", inferred: "Likely died after an explosion.",
    promptLine: "died after an explosion", inferredPromptLine: "most likely died after an explosion" },
  vehicle_crash: { strong: "Died after a vehicle crash.", inferred: "Likely died after a vehicle crash.",
    promptLine: "died after a vehicle crash", inferredPromptLine: "most likely died after a vehicle crash" },
  starvation_and_thirst: { strong: "Died after going without food and water.",
    inferred: "Likely died after going without food and water.",
    promptLine: "died after going without food and water",
    inferredPromptLine: "most likely died after going without food and water" },
};

// ---------------------------------------------------------------------------------------------
// The pending state: a death with no stored verdict yet.
// ---------------------------------------------------------------------------------------------

/** The death line's own coarse word to the family it is shown under while the verdict is pending.
 *  Only words that state something are listed; `died`, `environment` and `unknown` are not. */
export const STATED_COARSE: Record<string, PublicCauseKey> = {
  pvp: "pvp", suicide: "suicide", infected: "infected", wolf: "wolf", bear: "bear", animal: "animal",
  drowned: "drowned", bled_out: "bled_out", explosion: "explosion", vehicle: "vehicle", fall: "fall",
};

/** The same words in the vocabulary readers had before the stored verdict. */
export const COARSE_TO_LEGACY: Record<string, LegacyCause> = {
  pvp: "pvp", suicide: "suicide", infected: "infected", wolf: "wolf", bear: "bear", animal: "animal",
  drowned: "environmental", environment: "environmental", bled_out: "bled_out", explosion: "explosion",
  vehicle: "vehicle", fall: "fall",
};

// ---------------------------------------------------------------------------------------------
// Legacy fields.
// ---------------------------------------------------------------------------------------------

/**
 * A public key in the vocabulary older readers know: an earlier release of the site, an old
 * mobile build, a rolled-back deploy. They must still print something correct and hedged.
 *
 * ⚠️ Never `high` for an inferred cause. The three hunger and thirst rows are the only inferred
 * ones that keep their word, because those readers already print "Likely starvation" for a low
 * confidence; every other inferred row degrades to `unknown`, which they print as unknown.
 */
export function legacyCause(key: PublicCauseKey, certainty: Confidence): { cause: LegacyCause; confidence: "high" | "low" } {
  const row = PUBLIC_ROWS[key];
  if (certainty === "definitive" || certainty === "strong") {
    return row.legacy === "unknown" ? { cause: "unknown", confidence: "low" } : { cause: row.legacy, confidence: "high" };
  }
  if (certainty === "inferred" && row.legacyInferred) return { cause: row.legacyInferred, confidence: "low" };
  return { cause: "unknown", confidence: "low" };
}

// ---------------------------------------------------------------------------------------------
// A trap kill.
// ---------------------------------------------------------------------------------------------

/**
 * Wording for a kill credited to the player who set a trap.
 *
 * ⚠️ The log never says whose device fired; the credit is a reading of where a trap was set. So
 * no string here may say the player killed the victim as a logged fact, or call the trap theirs
 * as plain ownership. "Credited" is the only verb.
 */
export const CREDIT_TEXT: Record<TrapDevice, {
  sentenceSuffix: (name: string) => string;
  caption: (name: string) => string;
  operatorCaption: string;
  listLabel: string;
  listFootnote: string;
  writerLine: (name: string) => string;
}> = {
  tripwire: {
    sentenceSuffix: (name) => `Kill credited to ${name}.`,
    caption: (name) => `The log names no killer. ${name} placed the only tripwire it records at this spot.`,
    operatorCaption: "The log names no killer. Credited by the server operator.",
    listLabel: "by trap",
    listFootnote: "By trap: credited from where the trap was placed. The log names no killer.",
    writerLine: (name) => `The record names no killer. The only tripwire on record that fits was set by ${name}, who is credited with the kill.`,
  },
  land_mine: {
    sentenceSuffix: (name) => `Kill credited to ${name}.`,
    caption: (name) => `The log names no killer. ${name} placed the only land mine it records at this spot.`,
    operatorCaption: "The log names no killer. Credited by the server operator.",
    listLabel: "by trap",
    listFootnote: "By trap: credited from where the trap was placed. The log names no killer.",
    writerLine: (name) => `The record names no killer. The only land mine on record that fits was set by ${name}, who is credited with the kill.`,
  },
};

const DEVICE_NOUN: Record<TrapDevice, string> = { tripwire: "a tripwire", land_mine: "a land mine" };

/** The qualifying line of a life that a trap kill qualified. */
export const TRAP_QUALIFIED_LINE = "A trap kill credited. The life counts from here.";

/** Told to the writer of the trap-setter's own obituary when a kill count holds a trap kill. */
export function TRAP_KILLS_CAVEAT(thisLife: number, prior: number): string {
  return `${thisLife} of the kills this life and ${prior} of the earlier kills are credited from a trap this player set. `
    + "The record names no killer for a trap death. Count them as kills. Do not tell one as a shooting or a fight, "
    + "and do not say the record names this player as the killer.";
}

/** Told to the writer of the victim's obituary alongside the credit line. */
export function CREDIT_DIRECTIVE(name: string, device: TrapDevice): string {
  return `You may say ${name} is credited with the kill or that ${name} set ${DEVICE_NOUN[device]}. `
    + `Never write that ${name} killed them as a recorded fact, never say who armed it, never give ${name} a motive, `
    + `never say where it was. ${name} does not appear in the headline, the lede, the pull quote or its attribution.`;
}

// ---------------------------------------------------------------------------------------------
// What the writer is told.
// ---------------------------------------------------------------------------------------------

/** The heading an inferred cause line and a trap credit line go under. Everything above it in the
 *  prompt is confirmed; nothing below it is. */
export const NOT_CONFIRMED_HEADING = "NOT CONFIRMED: the paper's reading";

export const INFERRED_CAUSE_DIRECTIVE =
  "The server recorded no cause for this death. The line above is the paper's reading of the record, not a fact. "
  + "You may tell it as the likely cause. Every sentence that states it must mark it as a reading: "
  + "\"probably\", \"most likely\", \"by every sign\", \"the record points to\", \"it looks like\". "
  + "Never state it flatly. Never write that the record confirms or shows it. Add nothing the line does not give: "
  + "no named illness, no temperature or weather, no last meal, no moment of death, no witness. "
  + "Do not put the cause in the headline or the pull quote. Hedge only the cause of this death; "
  + "state everything else in the record plainly, including earlier fights and earlier deaths.";

export const STRONG_CAUSE_DIRECTIVE = "State the cause of death. One small qualifier is allowed.";

export const WITHHELD_DIRECTIVE = "Write about the life. Say nothing about how it ended beyond that it ended.";

/** For a death the log pins on an object and no person. Naming no one is not the same as there
 *  being no one, so the writer may neither guess a person nor rule one out. */
export const NAMES_NO_PERSON_DIRECTIVE =
  "The record names no person behind this. Do not name, hint at or speculate about anyone, and do not say that no one was involved.";
