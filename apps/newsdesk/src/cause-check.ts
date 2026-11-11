import { FAMILY_TAG, PUBLIC_ROWS, type InferredFamily, type PublicCauseKey } from "@onelife/death-verdict";
import type { ObituaryFacts } from "./facts.js";
import type { Obituary } from "./prompt.js";

/**
 * The deterministic check of a draft against what the writer was told about the death
 * (death-verdict spec 6.1). It runs beside `findPlaceViolations` in `generate.ts` and feeds the
 * same retry-then-fail path: a draft that breaks a rule gets one retry with the violations named,
 * then no obituary.
 *
 * ⚠️ It is LEXICAL. It proves that a hedge word is present, not that a sentence is honest, and a
 * rule that rejects honest wording costs a publication (retry, then a failure stub). The word
 * lists are tuned by running `scripts/check-inferred-previews.ts` over generated previews of the
 * inferred lives before release 3; widen a list only with a draft that shows why.
 *
 * The rules:
 *   1. logout vocabulary never appears in the headline, the lede or the tags; for a logout-family
 *      death (an internal hint, never in the facts) nowhere in the article;
 *   2. when the writer was given no cause (not recorded, withheld), no family word appears in the
 *      headline, the lede or the tags;
 *   3. pneumonia, silicosis and heatstroke never appear;
 *   4. an inferred cause: no family word in the headline, the pull quote, its attribution or a
 *      flavour tag; in the lede and the body every cause sentence holds a hedge marker and no
 *      certainty marker;
 *   5. a trap credit: the credited name is absent from the headline, the lede, the pull quote, its
 *      attribution and the tags;
 *   6. a trap kill in a count: when this life or the earlier ones hold a trap kill, no kill count
 *      in the headline or the lede (those two fields are all the crier posts, and a post cannot be
 *      recalled after a denial).
 * A family word in a sentence that only states a confirmed fact (an earlier death, run-ins with
 * the infected) is exempt; see `isCauseSentence`.
 */

/** Rule 1. Never in any obituary: how a player left the game is not public (spec 2.3). */
export const LOGOUT_WORDS: readonly RegExp[] = [
  /\blog(?:s|ged|ging)?[\s-]*(?:out|off)\b/i,
  /\bdisconnect\w*/i,
  /\b(?:rage[\s-]*)?quit(?:s|ting|ter|ters)?\b/i,
  /\brespawn\w*/i,
  /\bcombat[\s-]*log\w*/i,
  /\b(?:gave|give|gives|giving)\s+up\b/i,
  /\bleft\s+the\s+(?:server|game)\b/i,
];

/** Rule 3. Internal words that are never public. */
export const NEVER_PUBLIC_WORDS: readonly RegExp[] = [/\bpneumonia\b/i, /\bsilicosis\b/i, /\bheat[\s-]*stroke\b/i];

/**
 * The words that state a death of each inferred family. Rule 4 for an inferred cause of that
 * family; rule 2 for every family when the writer was given no cause.
 */
export const FAMILY_WORDS: Record<InferredFamily, RegExp> = {
  exposure: /\b(?:cold|froze|frozen|freez(?:e|es|ing)|exposure|hypotherm\w*|overheat\w*)\b/i,
  illness: /\b(?:illness\w*|sick\w*|disease[sd]?|fever\w*|ailment\w*)\b/i,
  vehicle_crash: /\b(?:crash\w*|wreck\w*|collision\w*|motorbike\w*|motorcycle\w*|vehicle\w*)\b/i,
  hunger_thirst: /\b(?:starv\w*|hunger|hungry|famish\w*|thirst\w*|dehydrat\w*|malnourish\w*)\b/i,
  infected: /\b(?:infected|zombies?|horde\w*|undead)\b/i,
  pvp: /\b(?:shot|shooter\w*|gunned|gunfire|gunman|bullets?|sniper\w*|murder\w*|another player)\b/i,
};

/** A sentence that states an inferred cause must hold one of these (spec 6.1). */
export const HEDGE_MARKERS: RegExp =
  /\b(?:likely|probably|most likely|apparently|appears?|appeared|seems?|seemed|looks? like|by every sign|points? to|pointed to|suggests?|suggested|may have|might have|presumed|presumably)\b/i;

/**
 * And none of these. ⚠️ Not the bare word "recorded": "No cause was recorded, but he most likely
 * starved" is the honest sentence and must pass.
 */
export const CERTAINTY_MARKERS: RegExp =
  /\b(?:confirmed|confirms|the record shows|the records show|the log shows|the record confirms|was recorded as|officially|cause of death:)/i;

/** A sentence about a confirmed run-in states no death without one of these. */
export const DEATH_TERMS: RegExp = /\b(?:died|dies|dead|death|killed|kills him|kills her|fatal\w*|perished|succumbed|the end)\b/i;

/** A sentence about an earlier death holds one of these. */
export const PRIOR_MARKERS: RegExp = /\b(?:last time|before|again|previous\w*|earlier|once more|usual\w*)\b/i;

const NUMBER_WORDS =
  "zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|dozen|dozens";
const COUNT_TOKEN = new RegExp(`^(?:\\d+|${NUMBER_WORDS})$`, "i");
const KILL_TOKEN = /^(?:kill|kills|killed|bodies|dead)$/i;

/** Sentences, split on terminal punctuation and line breaks. Small on purpose: prose here is a
 *  headline, a lede and a few short paragraphs. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const words = (s: string): string[] => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** Rule 6: a digit or number word within three words of kill, kills, killed, bodies or dead. */
export function holdsKillCount(text: string): boolean {
  const w = words(text);
  for (let i = 0; i < w.length; i++) {
    if (!KILL_TOKEN.test(w[i]!)) continue;
    for (let j = Math.max(0, i - 3); j <= Math.min(w.length - 1, i + 3); j++) {
      if (j !== i && COUNT_TOKEN.test(w[j]!)) return true;
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

/**
 * What was actually sent to the writer that states a confirmed fact in each family, so a sentence
 * about it is not read as a statement of this death's cause (spec 6.1).
 *  - a confirmed in-life fact of the family was sent (run-ins with the infected; for player kills,
 *    a kill this life or a firefight): a sentence with no death term is not a cause sentence;
 *  - a prior in the family was sent: a sentence with a prior marker is not a cause sentence.
 */
interface Exemptions { inLife: Set<InferredFamily>; prior: Set<InferredFamily> }

export function exemptionsOf(facts: ObituaryFacts): Exemptions {
  const inLife = new Set<InferredFamily>();
  const prior = new Set<InferredFamily>();
  if (facts.ordeals && facts.ordeals.infected.encounters > 0) inLife.add("infected");
  if (facts.kills > 0 || (facts.ordeals && facts.ordeals.pvp.encounters > 0)) inLife.add("pvp");
  if (facts.isKnownQuantity) {
    for (const noun of [facts.priors.usualDeathCause, facts.priors.lastDeathCause]) {
      const f = familyOfPriorNoun(noun);
      if (f) prior.add(f);
    }
  }
  return { inLife, prior };
}

/** True when the sentence holds a word of `family` and is not exempt as a confirmed fact. */
export function isCauseSentence(sentence: string, family: InferredFamily, ex: Exemptions): boolean {
  if (!FAMILY_WORDS[family].test(sentence)) return false;
  if (ex.inLife.has(family) && !DEATH_TERMS.test(sentence)) return false;
  if (ex.prior.has(family) && PRIOR_MARKERS.test(sentence)) return false;
  return true;
}

const ALL_FAMILIES = Object.keys(FAMILY_WORDS) as InferredFamily[];

/**
 * Every rule broken by a draft, as readable strings ("rule N (field): what"); [] when it passes.
 *
 * `hints.logoutFamily` comes from `getDeathCheckHints` and is internal: it is passed here as an
 * argument and is never in `facts`, the prompt or `articles.facts`.
 *
 * ⚠️ `obituary.tags` must be the MODEL's flavour tags (the draft as parsed), not the composed set:
 * the composed reserved tag is the death's family tag, which is a family word by design.
 */
export function findCauseViolations(
  obituary: Obituary,
  facts: ObituaryFacts,
  hints: { logoutFamily: boolean },
): string[] {
  const out: string[] = [];
  const quote = obituary.pullQuote;
  const fields: [string, string][] = [
    ["headline", obituary.headline],
    ["lede", obituary.lede],
    ["body", obituary.body],
    ["pull quote", quote?.text ?? ""],
    ["attribution", quote?.attribution ?? ""],
    ...obituary.tags.map((t): [string, string] => ["tag", t]),
  ];
  const pick = (names: string[]) => fields.filter(([n]) => names.includes(n));
  const short = ["headline", "lede", "tag"];
  const outside = ["headline", "pull quote", "attribution", "tag"];
  const ex = exemptionsOf(facts);

  // 1. Logout vocabulary.
  for (const [name, text] of hints.logoutFamily ? fields : pick(short)) {
    for (const re of LOGOUT_WORDS) {
      const m = re.exec(text);
      if (m) out.push(`rule 1 (${name}): "${m[0]}"`);
    }
  }

  // 2. No cause given to the writer: no family word in the headline, the lede or the tags.
  if (facts.death.certainty === "unknown") {
    for (const [name, text] of pick(short)) {
      for (const s of splitSentences(text)) {
        for (const f of ALL_FAMILIES) {
          if (isCauseSentence(s, f, ex)) out.push(`rule 2 (${name}): ${s}`);
        }
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

  // 4. An inferred cause: never in the headline, the pull quote or a tag; hedged in the lede and body.
  const family = facts.death.certainty === "inferred" ? familyOfKey(facts.death.key) : null;
  if (family) {
    for (const [name, text] of pick(outside)) {
      for (const s of splitSentences(text)) {
        if (isCauseSentence(s, family, ex)) out.push(`rule 4 (${name}): ${s}`);
      }
    }
    for (const [name, text] of pick(["lede", "body"])) {
      for (const s of splitSentences(text)) {
        if (!isCauseSentence(s, family, ex)) continue;
        if (!HEDGE_MARKERS.test(s)) out.push(`rule 4 (${name}, no hedge): ${s}`);
        else if (CERTAINTY_MARKERS.test(s)) out.push(`rule 4 (${name}, certainty marker): ${s}`);
      }
    }
  }

  // 5. The credited name stays out of everything the crier posts and every tag.
  const name = facts.creditedGamertag?.trim().toLowerCase();
  if (name) {
    for (const [field, text] of pick(["headline", "lede", "pull quote", "attribution", "tag"])) {
      if (text.toLowerCase().includes(name)) out.push(`rule 5 (${field}): the credited name`);
    }
  }

  // 6. A kill count that holds a trap kill stays out of the headline and the lede.
  if (facts.trapKills > 0 || facts.priors.trapKills > 0) {
    for (const [field, text] of pick(["headline", "lede"])) {
      for (const s of splitSentences(text)) {
        if (holdsKillCount(s)) out.push(`rule 6 (${field}): ${s}`);
      }
    }
  }

  return [...new Set(out)];
}
