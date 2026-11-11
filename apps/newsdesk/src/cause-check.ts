import { FAMILY_TAG, PUBLIC_ROWS, type InferredFamily, type PublicCauseKey } from "@onelife/death-verdict";
import type { ObituaryFacts } from "./facts.js";
import { flavorTagOf, type Obituary } from "./prompt.js";

/**
 * The deterministic check of a draft against what the writer was told about the death
 * (death-verdict spec 6.1). It runs beside `findPlaceViolations` in `generate.ts` and feeds the
 * same retry-then-fail path: a draft that breaks a rule gets one retry with the violations named,
 * then no obituary.
 *
 * ⚠️ It is LEXICAL. It proves that a hedge word is present, not that a sentence is honest, and a
 * rule that rejects honest wording costs a publication (retry, then a failure stub). The word
 * lists are tuned by running `scripts/check-inferred-previews.ts` over generated previews before
 * release 3; widen a list only with a draft that shows why.
 *
 * The rules:
 *   1. logout vocabulary never appears in the headline, the lede or the tag; for a logout-family
 *      death (an internal hint, never in the facts) nowhere in the article;
 *   2. when the writer was given no cause (not recorded, withheld), the headline, the lede and the
 *      tag hold no word of the death's own internal family (an internal hint, like the logout
 *      one) and none of a short list of explicit mechanisms (`MECHANISMS`);
 *   3. pneumonia, silicosis and heatstroke never appear;
 *   4. an inferred cause: no family word in the headline, the pull quote, its attribution or the
 *      flavour tag; in the lede and the body every clause that states it holds its own hedge
 *      marker, and the sentence holds no certainty marker;
 *   5. a trap credit: the credited name (as a whole word) is absent from the headline, the lede,
 *      the pull quote, its attribution and the tag, and the body never says NAME killed them;
 *   6. a trap kill in a count: when this life or the earlier ones hold a trap kill, no kill count
 *      in the headline or the lede (those two fields are all the crier posts, and a post cannot be
 *      recalled after a denial).
 *
 * Exemptions (lede and body only; never the headline, the pull quote, its attribution or the
 * tag): a clause that is visibly about a confirmed fact that was sent (past run-ins with the
 * infected, the player's own kills, an earlier death) is not a statement of this death's cause.
 * A family word right after a negation ("never fired a shot") states nothing.
 *
 * "The tag" is the one flavour tag `composeTags` keeps (`flavorTagOf`); the others are never
 * published, and the reserved tags are composed, not written.
 */

/** Internal hints for the check (`getDeathCheckHints`). Never sent to the model or stored. */
export interface CheckHints {
  /** A knock-out or logout cause, or the restrained logout: rule 1 covers the whole article. */
  logoutFamily: boolean;
  /** The family of the stored (or, for the logout family, upstream) cause; rule 2 reads it when
   *  the writer was given no cause. Null for a cause with no family. */
  family: InferredFamily | null;
}

/** Rule 1. Never in any obituary: how a player left the game is not public (spec 2.3). */
export const LOGOUT_WORDS: readonly RegExp[] = [
  /\blog(?:s|ged|ging)?[\s-]*(?:out|off)s?\b/i,
  /\bdisconnect\w*/i,
  /\b(?:rage[\s-]*)?quit(?:s|ting|ter|ters)?\b/i,
  /\brespawn\w*/i,
  /\bcombat[\s-]*log\w*/i,
  /\b(?:gave|give|gives|giving)\s+up\b/i,
  /\bleft\s+the\s+(?:server|game)\b/i,
  /\b(?:went|go|goes|going|gone)\s+offline\b/i,
  /\bsign(?:s|ed|ing)?[\s-]+off\b/i,
  /\bpull(?:s|ed|ing)?\s+the\s+plug\b/i,
  /\balt[\s+-]*f4\b/i,
];

/** The two logout words that read as ordinary praise when negated ("never quit", "never gave
 *  up"). Exempt then, but only for a death that is not of the logout family. */
const NEGATABLE_LOGOUT: ReadonlySet<RegExp> = new Set([LOGOUT_WORDS[2]!, LOGOUT_WORDS[5]!]);
const NEGATION_BEFORE = /\b(?:never|not|n't|refused\s+to|wouldn't|won't|didn't)\s+(?:\w+\s+)?$/i;

/** Rule 3. Internal words that are never public. */
export const NEVER_PUBLIC_WORDS: readonly RegExp[] = [/\bpneumonia\b/i, /\bsilicosis\b/i, /\bheat[\s-]*stroke\b/i];

/** The words that state a death of each inferred family (rule 4; rule 2 for the hinted family). */
export const FAMILY_WORDS: Record<InferredFamily, RegExp> = {
  exposure: /\b(?:cold|froze|frozen|freez(?:e|es|ing)|exposure|hypotherm\w*|overheat\w*|winter\w*|snow\w*|ice|icy|chill\w*|frost\w*)\b/i,
  illness: /\b(?:illness\w*|sick\w*|disease[sd]?|fever\w*|ailment\w*|cough\w*|infection\w*|flu|virus\w*|caught\s+something)\b/i,
  vehicle_crash: /\b(?:crash\w*|wreck\w*|collision\w*|motorbike\w*|motorcycle\w*|vehicle\w*|bikes?|cars?|trucks?|drove|driv\w*|roads?|wheels?|rolled|flipped|corner\w*|skid\w*)\b/i,
  hunger_thirst: /\b(?:starv\w*|hunger|hungry|famish\w*|thirst\w*|dehydrat\w*|malnourish\w*|food|water|meals?|stomach\w*|ate|eat|eating|drank|drink\w*|rations?)\b/i,
  infected: /\b(?:infected|zombies?|horde\w*|undead|bites?|bitten|walkers?|shamblers?|ghouls?)\b/i,
  pvp: /\b(?:shot|shooter\w*|gunned|gunfire|gunman|bullets?|sniper\w*|murder\w*|another\s+player|strangers?|rivals?|enem(?:y|ies)|ambush\w*|rifles?|firefight\w*)\b/i,
};

/**
 * Rule 2's own list: explicit mechanisms that `NO_MECHANISM_DIRECTIVE` forbids for a death the
 * writer was given no cause for, by the family each belongs to (null: no family). Deliberately
 * tighter than `FAMILY_WORDS`: no bare "cold", "shot", "sick" or "crash", which are ordinary ways
 * to write that the record stops ("the trail goes cold", "his last shot").
 */
const MECHANISMS: readonly [InferredFamily | null, RegExp][] = [
  ["exposure", /\b(?:froze|frozen|freez(?:e|es|ing)|hypotherm\w*)\b/i],
  ["hunger_thirst", /\b(?:starv\w*|dehydrat\w*)\b/i],
  ["infected", /\b(?:infected|zombies?|horde\w*|undead)\b/i],
  ["pvp", /\b(?:gunned|shot\s+(?:dead|down|him|her|them)|(?:was|were|got|been|being)\s+shot|murder\w*)\b/i],
  ["vehicle_crash", /\b(?:crashed|wrecked)\b/i],
  [null, /(?<!\b(?:night|darkness|silence|dusk|quiet)\s)\bfell\b(?!\s+(?:silent|asleep|quiet|apart|short|behind|for|through|into\s+place))|\b(?:a|the|his|her|their)\s+fall\b(?!\s+of)|\bwolves\b|\b(?:a|the)\s+(?:wolf|bears?)\b|\bmaul\w*|\bdrown\w*|\bbled\b|\bbleeding\b|\bambush\w*|\btripwires?\b|\b(?:land\s*)mines?\b|\bexplo(?:sion|sions|sive|sives|ded)\b|\bgrenades?\b|\bhandcuff\w*|\bcuffed\b|\brestrained\b|\bbound\s+hand\b/i],
];

/** A clause that states an inferred cause must hold one of these (spec 6.1, widened in review). */
export const HEDGE_MARKERS: RegExp =
  /\b(?:likel(?:y|ier|iest|ihood)|probabl[ey]|perhaps|possibl[ey]|apparently|appears?|appeared|seems?|seemed|looks?\s+like|looked\s+like|by\s+(?:every|all)\s+signs?|points?\s+(?:to|toward|towards)|pointed\s+(?:to|toward|towards)|suggests?|suggested|may\s+have|might\s+have|presum\w*|evidently|best\s+guess|(?:paper['’]s|our|best|the|a|only\s+a)\s+reading)\b/i;

/**
 * And no sentence that states it holds one of these. ⚠️ Not the bare word "recorded": "No cause
 * was recorded, but he most likely starved" is the honest sentence and must pass; nor "the record
 * says nothing".
 */
export const CERTAINTY_MARKERS: RegExp =
  /\b(?:confirmed|confirms|the\s+(?:records?|logs?)\s+(?:shows|show|says|say|confirms|confirm|states|state)\b(?!\s+(?:nothing|little|no|not|only)\b)|was\s+recorded\s+as|officially|cause\s+of\s+death:|certainly|definitely|no\s+doubt|without\s+(?:a\s+)?doubt|beyond\s+doubt|make\s+no\s+mistake|undoubtedly)/i;

/** A clause that states a death. A clause about a past encounter must hold none of these. */
export const DEATH_TERMS: RegExp =
  /\b(?:died|dies|dead|death|killed|kill(?:s|ed)?\s+(?:him|her|them)|fatal\w*|perished|succumbed|got\s+(?:him|her|them)|took\s+(?:him|her|them)|finish(?:ed|es)?\s+(?:him|her|them|it)|claimed\s+(?:him|her|them)|caught\s+up|won|wins?|collect\w*|overwhelm\w*|overran|overrun|brought\s+(?:him|her|them)\s+down|ended\s+(?:him|her|them))\b/i;

const NUMBER_WORDS =
  "zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|dozen|dozens";

/** A sign that a clause is about an earlier encounter, not the death: a count or an encounter word. */
const PAST_ENCOUNTER = new RegExp(`\\b(?:run-?ins?|encounters?|brushes|brush|fought|fended|survived|escaped|shook\\s+off|times|${NUMBER_WORDS}|\\d+)\\b`, "i");

/** The player's own kills ("shot two men"), and words that aim a shooting at the player. */
const OWN_KILL = new RegExp(`\\b(?:shot|gunned\\s+down|outgunned|murdered|dropped|took\\s+down)\\s+(?:${NUMBER_WORDS}|\\d+|a|an|another|someone)\\b`, "i");
const AIMED_AT_HIM = /\b(?:(?:was|were|got|been|being|is)\s+(?:shot|gunned|murdered)|(?:shot|gunned\s+down|murdered|ambushed)\s+(?:him|her|them)|bullets?|snipers?|gunman|shooter\w*|strangers?|ambush\w*)\b/i;

/** A clause about an earlier death holds one of these (the earlier death, not this one)... */
export const PRIOR_MARKERS: RegExp =
  /\b(?:last\s+time|the\s+time\s+before|previous\w*|prior\s+(?:life|lives|death|deaths)|earlier\s+(?:life|lives|death|deaths)|most\s+recent|last\s+(?:life|death)|the\s+life\s+before|before\s+this\s+life|lives\s+before|(?:his|her|their)\s+usual|(?:a|an|his|her|their)\s+(?:past|former)\s+life)\b/i;
/** ...and none of these, which say this death repeated it ("froze again", "starved too"). */
const REPEAT_MARKERS = /\b(?:again|once\s+more|as\s+usual|usually|too(?!\s+(?:late|soon|early|long|far|much|many|few)\b)|also|this\s+time|repeat\w*|same\s+(?:way|mistake|end|fate)|another\s+time|second\s+time|as\s+before|like\s+before)\b/i;

/** A family word right after one of these (two words at most between) is no claim. A perception
 *  verb in between is ("never saw the bullet"). */
const NEGATED = /\b(?:never|no|not|nothing|without|nor|n't)\s+(?:(?!(?:saw|see|seen|heard|hear|felt|feel|knew|know|coming)\b)\w+\s+){0,2}$/i;

const COUNT_TOKEN = new RegExp(`^(?:\\d+|${NUMBER_WORDS}|double|triple|pair|brace|couple|handful)$`, "i");
const KILL_TOKEN = /^(?:kill|kills|killed|bodies|dead|victims|killers?|scalps?|notch|notches)$/i;
const TIME_UNIT = /^(?:seconds?|minutes?|mins?|hours?|hrs?|days?|nights?|weeks?|months?|years?)$/i;
/** "no one", "the one": not a count. */
const NOT_A_COUNT_BEFORE_ONE = /^(?:no|the|any|every|some|that|this|which|only)$/i;

/** Sentences, split on terminal punctuation and line breaks. Small on purpose: prose here is a
 *  headline, a lede and a few short paragraphs. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Clauses of a sentence, split on semicolons, colons, dashes and "but"/"yet", so a hedge on one
 *  clause does not cover a flat statement in the next. */
export function splitClauses(sentence: string): string[] {
  return sentence
    .split(/\s*[;:—–]\s*|\s+-\s+|,?\s+\b(?:but|yet)\b\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

const words = (s: string): string[] => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** `name` as a whole word (not inside a longer word), literally, ignoring case. */
const nameRe = (name: string, flags = "i") => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(name)}(?![\\p{L}\\p{N}])`, `${flags}u`);

/**
 * Rule 6: a count (a digit, a number word, "double", "pair" ...) within three words of kill,
 * kills, killed, bodies, dead, victims, killer, scalps or notches. Not a count: a number before a
 * time unit ("dead within two hours"), "one" in "no one" or "the one", and anything inside
 * `names` (gamertags, removed before the words are read).
 */
export function holdsKillCount(text: string, names: readonly string[] = []): boolean {
  let t = text;
  for (const n of names) if (n.trim()) t = t.replace(nameRe(n.trim(), "gi"), " ");
  const w = words(t);
  const isCount = (j: number): boolean => {
    if (!COUNT_TOKEN.test(w[j]!)) return false;
    if (j + 1 < w.length && TIME_UNIT.test(w[j + 1]!)) return false;
    if (w[j] === "one" && j > 0 && NOT_A_COUNT_BEFORE_ONE.test(w[j - 1]!)) return false;
    return true;
  };
  for (let i = 0; i < w.length; i++) {
    if (!KILL_TOKEN.test(w[i]!)) continue;
    for (let j = Math.max(0, i - 3); j <= Math.min(w.length - 1, i + 3); j++) {
      if (j !== i && isCount(j)) return true;
    }
  }
  return false;
}

/** The family of a public key's row, or null (`PUBLIC_ROWS[key].family`). */
export function familyOfKey(key: PublicCauseKey | string): InferredFamily | null {
  return Object.hasOwn(PUBLIC_ROWS, key) ? PUBLIC_ROWS[key as PublicCauseKey].family : null;
}

/** The family of a prior as the writer was sent it (the lower-case noun of a public tag). */
function familyOfPriorNoun(noun: string | null): InferredFamily | null {
  if (!noun) return null;
  const hit = (Object.keys(FAMILY_TAG) as InferredFamily[]).find((f) => FAMILY_TAG[f].toLowerCase() === noun.toLowerCase());
  return hit ?? null;
}

/** True when `re` matches somewhere in `clause` other than right after a negation. */
export function claims(clause: string, re: RegExp): boolean {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  for (const m of clause.matchAll(g)) {
    if (!NEGATED.test(clause.slice(0, m.index))) return true;
  }
  return false;
}

/**
 * True when a lede or body clause holding a word of `family` is visibly about a confirmed fact
 * that was sent, not about this death (spec 6.1, narrowed in review):
 *  - infected, when run-ins were sent: the clause has a sign of a past encounter (a count,
 *    "run-ins", "fought off", "survived") and no death term;
 *  - player kills, when the player killed this life: the clause tells the player's own kill
 *    ("shot two men") and aims nothing at the player;
 *  - any family with a prior of that family sent: the clause names the earlier death ("last
 *    time", "previous", "his last life") and does not say this death repeated it ("again",
 *    "too", "as usual").
 */
export function isExemptClause(clause: string, family: InferredFamily, facts: ObituaryFacts): boolean {
  if (family === "infected" && (facts.ordeals?.infected.encounters ?? 0) > 0
    && PAST_ENCOUNTER.test(clause) && !DEATH_TERMS.test(clause)) return true;
  if (family === "pvp" && facts.kills > 0 && OWN_KILL.test(clause) && !AIMED_AT_HIM.test(clause)) return true;
  if (facts.isKnownQuantity && PRIOR_MARKERS.test(clause) && !REPEAT_MARKERS.test(clause)) {
    const priors = [facts.priors.usualDeathCause, facts.priors.lastDeathCause].map(familyOfPriorNoun);
    if (priors.includes(family)) return true;
  }
  return false;
}

const HEDGEABLE = ["lede", "body"];

/**
 * Every rule broken by a draft, as readable strings ("rule N (field): what"); [] when it passes.
 * The strings name sentences of the draft and go to the retry prompt and the operator log only;
 * `ruleNumbersOf` is what may be stored.
 *
 * `hints` comes from `getDeathCheckHints` and is internal: it is passed here as an argument and is
 * never in `facts`, the prompt or `articles.facts`.
 *
 * ⚠️ `obituary.tags` must be the MODEL's tags (the draft as parsed), not the composed set: the
 * check reads the one flavour tag `composeTags` would keep.
 */
export function findCauseViolations(obituary: Obituary, facts: ObituaryFacts, hints: CheckHints): string[] {
  const out: string[] = [];
  const quote = obituary.pullQuote;
  const tag = flavorTagOf(facts, obituary.tags);
  const fields: [string, string][] = [
    ["headline", obituary.headline],
    ["lede", obituary.lede],
    ["body", obituary.body],
    ["pull quote", quote?.text ?? ""],
    ["attribution", quote?.attribution ?? ""],
    ...(tag ? [["tag", tag] as [string, string]] : []),
  ];
  const pick = (names: string[]) => fields.filter(([n]) => names.includes(n));
  const clausesOf = (text: string) => splitSentences(text).flatMap((s) => splitClauses(s).map((c) => ({ s, c })));

  // 1. Logout vocabulary.
  for (const [name, text] of hints.logoutFamily ? fields : pick(["headline", "lede", "tag"])) {
    for (const re of LOGOUT_WORDS) {
      for (const m of text.matchAll(new RegExp(re.source, `${re.flags}g`))) {
        if (!hints.logoutFamily && NEGATABLE_LOGOUT.has(re) && NEGATION_BEFORE.test(text.slice(0, m.index))) continue;
        out.push(`rule 1 (${name}): "${m[0]}"`);
      }
    }
  }

  // 2. No cause given to the writer: no word of the death's own family, and no explicit mechanism,
  //    in the headline, the lede or the tag.
  if (facts.death.certainty === "unknown") {
    const lists: [InferredFamily | null, RegExp][] = [...MECHANISMS];
    if (hints.family) lists.push([hints.family, FAMILY_WORDS[hints.family]]);
    for (const [name, text] of pick(["headline", "lede", "tag"])) {
      for (const { s, c } of clausesOf(text)) {
        const hit = lists.some(([f, re]) => claims(c, re) && !(name === "lede" && f && isExemptClause(c, f, facts)));
        if (hit) out.push(`rule 2 (${name}): ${s}`);
      }
    }
  }

  // 3. Never-public words, anywhere.
  for (const [name, text] of fields) {
    for (const re of NEVER_PUBLIC_WORDS) {
      const m = re.exec(text);
      if (m) out.push(`rule 3 (${name}): "${m[0]}"`);
    }
  }

  // 4. An inferred cause: never in the headline, the pull quote or the tag; hedged in the lede and
  //    the body, clause by clause.
  const family = facts.death.certainty === "inferred" ? familyOfKey(facts.death.key) : null;
  if (family) {
    const re = FAMILY_WORDS[family];
    for (const [name, text] of pick(["headline", "pull quote", "attribution", "tag"])) {
      for (const { s, c } of clausesOf(text)) {
        if (claims(c, re)) out.push(`rule 4 (${name}): ${s}`);
      }
    }
    for (const [name, text] of pick(HEDGEABLE)) {
      for (const s of splitSentences(text)) {
        const stating = splitClauses(s).filter((c) => claims(c, re) && !isExemptClause(c, family, facts));
        if (stating.length === 0) continue;
        if (stating.some((c) => !HEDGE_MARKERS.test(c))) out.push(`rule 4 (${name}, no hedge): ${s}`);
        else if (CERTAINTY_MARKERS.test(s)) out.push(`rule 4 (${name}, certainty marker): ${s}`);
      }
    }
  }

  // 5. The credited name stays out of everything the crier posts and the tag; the body may say
  //    the name is credited, never that the name killed them.
  const credited = facts.creditedGamertag?.trim();
  if (credited) {
    const re = nameRe(credited);
    const own = facts.gamertag.trim();
    const strip = (t: string) => (own && own.toLowerCase() !== credited.toLowerCase() ? t.replace(nameRe(own, "gi"), " ") : t);
    for (const [field, text] of pick(["headline", "lede", "pull quote", "attribution", "tag"])) {
      if (re.test(strip(text))) out.push(`rule 5 (${field}): the credited name`);
    }
    for (const s of splitSentences(obituary.body)) {
      if (re.test(strip(s)) && CREDITED_KILLED.test(s) && !/\bcredit\w*/i.test(s)) out.push(`rule 5 (body): the credited name as the killer`);
    }
  }

  // 6. A kill count that holds a trap kill stays out of the headline and the lede.
  if (facts.trapKills > 0 || facts.priors.trapKills > 0) {
    const names = [facts.gamertag, facts.killerGamertag, facts.creditedGamertag].filter((g): g is string => !!g);
    for (const [field, text] of pick(["headline", "lede"])) {
      for (const s of splitSentences(text)) {
        if (holdsKillCount(s, names)) out.push(`rule 6 (${field}): ${s}`);
      }
    }
  }

  return [...new Set(out)];
}

/** What CREDIT_DIRECTIVE forbids in the body: the credited name told as the killer. */
const CREDITED_KILLED = /\b(?:killed|murdered|took\s+(?:him|her|them)|finished\s+(?:him|her|them)|shot|did\s+for|ended\s+(?:him|her|them))\b/i;

/**
 * The rule numbers alone ("1,4"), for `articles.last_error`. ⚠️ The full strings name the field
 * that broke rule 1, which tells a reader of the table that the death was of the logout family,
 * and quote draft sentences; they go to the operator log only.
 */
export function ruleNumbersOf(violations: readonly string[]): string {
  const n = new Set<number>();
  for (const v of violations) {
    const m = /^rule (\d+)/.exec(v);
    if (m) n.add(Number(m[1]));
  }
  return [...n].sort((a, b) => a - b).join(",");
}
