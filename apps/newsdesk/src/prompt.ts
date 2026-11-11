import { z } from "zod";
import {
  CREDIT_DIRECTIVE, INFERRED_CAUSE_DIRECTIVE, NOT_CONFIRMED_HEADING, TRAP_KILLS_CAVEAT, type PublicTag, type TrapDevice,
} from "@onelife/death-verdict";
import type { ObituaryFacts } from "./facts.js";
import { timeAliveLabel, SUICIDE_RESET_SECONDS } from "./facts.js";
import { OBITUARY_SYSTEM } from "./voice.js";
import type { RecentProse } from "./prose-pg-store.js";
import { recentProseBlock } from "./prose-block.js";

// v4 (death-verdict spec 6.1): the cause comes from the stored verdict's writer brief, by
// certainty. Definitive and strong lines sit among the confirmed facts; an inferred line and a
// trap credit go under NOT_CONFIRMED_HEADING with their directives. Kill counts include trap kills.
export const OBITUARY_PROMPT_VERSION = "obituary-v4";

export interface Obituary {
  headline: string;
  lede: string;
  body: string;
  pullQuote: { text: string; attribution: string } | null;
  tags: string[];
}

const MAP_LABEL: Record<string, string> = { chernarusplus: "Chernarus", sakhal: "Sakhal", enoch: "Livonia" };
export const mapLabel = (map: string): string => MAP_LABEL[map] ?? map.replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * D4 companion constraint, for a death whose cause is not recorded (or whose inferred family is
 * switched off). A model handed a blank will fill it; this names the failure mode explicitly and
 * reframes the gap as the angle.
 */
export const NO_MECHANISM_DIRECTIVE =
  `THE CAUSE OF DEATH IS NOT RECORDED. Do NOT name or imply a mechanism — no fall, no terrain, no exposure, no animal, no infected, no starvation, no thirst, no weather, no ambush. Do not guess, hedge toward, or hint at one, and do not dress the blank up as a cause. The paper does not know. Say so: the ABSENCE of a cause IS the story — the record simply stops, and a life ends with nothing written next to it. Write the gap, not a mechanism.`;

/** Re-exported for tests and callers that predate the vocabulary package owning it. */
export { NAMES_NO_PERSON_DIRECTIVE } from "@onelife/death-verdict";

/** True when the writer is told nothing about the cause: not recorded (or a family switched off). */
export function causeUnrecorded(facts: ObituaryFacts): boolean {
  return facts.death.key === "unknown";
}

/** True when the cause line is a best reading and goes under NOT_CONFIRMED_HEADING. */
const isInferred = (facts: ObituaryFacts): boolean => facts.death.certainty === "inferred";

/**
 * The writer line for this death (spec 2.2), or null when the writer is given none (not recorded,
 * withheld). An inferred line starts "most likely"; `buildObituaryPrompt` puts it under the NOT
 * CONFIRMED heading, never among the confirmed facts. A named driver is never in it.
 */
export function describeDeath(facts: ObituaryFacts): string | null {
  return facts.brief.line;
}

const DEVICE_OF_KEY: Record<string, TrapDevice> = { tripwire: "tripwire", land_mine: "land_mine" };

/** The credit directive actually in the brief, or null. */
function creditDirective(facts: ObituaryFacts): string | null {
  const device = DEVICE_OF_KEY[facts.death.key];
  if (!facts.creditedGamertag || !device) return null;
  const d = CREDIT_DIRECTIVE(facts.creditedGamertag, device);
  return facts.brief.directives.includes(d) ? d : null;
}

/** The brief's directives that belong with the confirmed facts (strong, names-no-person, withheld). */
function confirmedDirectives(facts: ObituaryFacts): string[] {
  const credit = creditDirective(facts);
  return facts.brief.directives.filter((d) => d !== INFERRED_CAUSE_DIRECTIVE && d !== credit);
}

/** Sent beside the trap-kills caveat: the cause check's rule 6 rejects a kill count in the
 *  headline or the lede, so the writer is told (review of PR 406). Not in the death-verdict
 *  vocabulary, so the attested caveat text is unchanged. */
export const TRAP_KILLS_COUNT_DIRECTIVE = "Give no kill count in the headline or the lede; the body may give it.";

/** The NOT CONFIRMED block (spec 6.1), or [] when there is nothing to put under it. */
function notConfirmedBlock(facts: ObituaryFacts): string[] {
  const out: string[] = [];
  const line = describeDeath(facts);
  if (line && isInferred(facts)) {
    out.push(`- Cause of death (the paper's reading): ${line}`);
    out.push(INFERRED_CAUSE_DIRECTIVE);
  }
  const credit = creditDirective(facts);
  if (facts.brief.creditLine && credit) {
    out.push(`- ${facts.brief.creditLine}`);
    out.push(credit);
  }
  if (facts.trapKills > 0 || facts.priors.trapKills > 0) {
    out.push(`- ${TRAP_KILLS_CAVEAT(facts.trapKills, facts.priors.trapKills)}`);
    out.push(TRAP_KILLS_COUNT_DIRECTIVE);
  }
  return out.length ? [NOT_CONFIRMED_HEADING, ...out] : [];
}

/**
 * ⚠️ Everything sent to the model here (facts below, plus `recentProseBlock`) is disclosed in
 * `apps/web/src/content/legal/privacy.tsx` §7 (Who else touches it). Adding a field to the prompt
 * without updating that page makes the published privacy policy false.
 */
/** Build the {system, user} messages for one obituary from the factual snapshot. */
export function buildObituaryPrompt(facts: ObituaryFacts, recent: RecentProse[] = []): { system: string; user: string } {
  const lines: string[] = [];
  lines.push(`Write the obituary for this life. Facts (all past tense, all confirmed):`);
  lines.push(`- Callsign: ${facts.gamertag}`);
  lines.push(`- Dateline (map only, never a pin): ${mapLabel(facts.map)}`);
  lines.push(`- Life number on this map: ${facts.lifeNumber} (NOT a career count — see Priors below)`);
  lines.push(`- Time survived this life: ${facts.timeAliveLabel}`);
  lines.push(`- Kills this life: ${facts.kills}`);
  if (facts.longestKillMeters != null) lines.push(`- Longest kill: ${Math.round(facts.longestKillMeters)}m`);
  lines.push(`- Sessions played: ${facts.sessions}`);
  // Definitive and strong only: an inferred line goes under the NOT CONFIRMED heading below, and
  // a death with no line (not recorded, withheld) sends none.
  const line = describeDeath(facts);
  if (line && !isInferred(facts)) lines.push(`- Cause of death: ${line}.`);
  if (facts.ordeals) {
    const o = facts.ordeals;
    if (o.infected.encounters > 0) lines.push(`- Run-ins with the infected: ${o.infected.encounters}${o.infected.worstEncounterHits > 1 ? ` (the worst took ${o.infected.worstEncounterHits} hits)` : ""}`);
    if (o.fire.encounters > 0) lines.push(`- Times caught fire: ${o.fire.encounters}`);
    if (o.pvp.encounters > 0) lines.push(`- Firefights that left a mark before the end: ${o.pvp.encounters}`);
  }
  if (facts.hpLow != null && facts.hpLow < 50) lines.push(`- Lowest health recorded: ${Math.round(facts.hpLow)} of 100`);
  lines.push("");
  lines.push(`Priors (everything this player did BEFORE this life, across every map):`);
  if (facts.isKnownQuantity) {
    lines.push(`- Prior lives lived: ${facts.priors.livesLived}`);
    lines.push(`- Longest prior life: ${timeAliveLabel(facts.priors.longestLifeSeconds)}`);
    lines.push(`- Kills across all prior lives: ${facts.priors.totalKills}`);
    if (facts.priors.usualDeathCause) lines.push(`- Usual cause of death: ${facts.priors.usualDeathCause}`);
    if (facts.priors.lastDeathCause) lines.push(`- Most recent prior death: ${facts.priors.lastDeathCause}`);
    if (facts.priors.bestLifeMap) lines.push(`- Best run was on: ${mapLabel(facts.priors.bestLifeMap)}`);
  } else {
    lines.push(`- None. This was their first recorded life anywhere. A stranger to these shores.`);
  }
  lines.push("");
  const unconfirmed = notConfirmedBlock(facts);
  if (unconfirmed.length) {
    lines.push(...unconfirmed);
    lines.push("");
  }
  if (facts.causeCategory === "Self-Inflicted" && facts.timeAliveSeconds < SUICIDE_RESET_SECONDS) {
    lines.push(`This was a SELF-INFLICTED death, ${Math.round(facts.timeAliveSeconds)} seconds after this life began. Frame it as a REROLL, not a decision: a bad beach, a broken leg on landing, a spawn nobody wanted — a survivor pressing the reset button on a life that had not started yet. Bureaucratic deadpan, a filing error, an administrative footnote. There is no story arc to eulogize because there was no arc. Do not reach for grief, meaning, or significance — this is paperwork, not a loss.`);
  } else if (facts.causeCategory === "Self-Inflicted") {
    lines.push(`This was a SELF-INFLICTED death that ended a real run — the life lasted ${facts.timeAliveLabel} before it ended. Frame it as a survivor closing their own book after a genuine stretch out there: the record they built is the story, and the ending is the last line of it, reported flatly. Never treat the act itself as the punchline and never speculate about a state of mind — you have the record, not the reason. Any needle lands on the circumstances of the run, never on the person.`);
  } else if (facts.isLegend) {
    lines.push(`This was a LEGEND (a long life and/or a high kill count). Use the reverent tone — a sincere send-off with exactly one small needle.`);
  } else if (facts.freshSpawnVictim) {
    lines.push(`This was a fresh spawn or badly outmatched player killed by another player. PROTECT the victim's dignity — do not mock them for dying. If the killer is named, they are the subject of any mockery, not the victim.`);
  } else {
    lines.push(`Use the default tone: dry mock-gravity — a state funeral for an idiot. Mock the circumstances, never the person's worth.`);
  }
  lines.push("");
  if (facts.isKnownQuantity) {
    lines.push(`KNOWN QUANTITY: the paper has buried this face before. The "Life number on this map" is a per-map counter, not a career count — this player had ${facts.priors.livesLived} prior lives across every map. Never call this a debut, a first appearance, a fresh start, or a rookie run — this player has a record and the paper knows it. Any needle targets their RECORD — the wasted priors, the repeat deaths, the same mistake made again.`);
  } else {
    lines.push(`FIRST LIFE: no priors anywhere — this was their first recorded life. The absence of a record is the story. Do NOT mock them for being new, green, or unlucky; the joke is the world they walked into, never the person.`);
  }
  lines.push("");
  if (line) lines.push(`Describe the manner of death in qualitative terms — never quote raw stat numbers (energy or water values).`);
  if (causeUnrecorded(facts)) lines.push(NO_MECHANISM_DIRECTIVE);
  lines.push(...confirmedDirectives(facts));
  lines.push("");
  lines.push(...recentProseBlock(recent));
  lines.push("");
  lines.push(`Respond with only the JSON object described in your instructions.`);
  return { system: OBITUARY_SYSTEM, user: lines.join("\n") };
}

const schema = z.object({
  headline: z.string().trim().min(1).max(200),
  lede: z.string().trim().min(1),
  body: z.string().trim().min(1),
  pullQuote: z
    .object({ text: z.string().trim().min(1), attribution: z.string().trim().min(1) })
    .nullable(),
  // The key must be present, but may be an empty array — flavor tags are optional; the reserved
  // tags (Obituaries / map / cause) are composed deterministically, not from the model.
  tags: z.array(z.string().trim().min(1)).max(6),
});

/** Parse + validate the model's JSON. Throws on non-JSON or a shape violation. */
export function parseObituary(raw: string): Obituary {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    // Some models wrap JSON in prose or fences; salvage the first {...} block before giving up.
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("obituary response was not JSON");
    json = JSON.parse(match[0]);
  }
  const parsed = schema.parse(json);
  return parsed;
}

/** The reserved cause tag: the death's family tag. "Unknown" if and only if the certainty is
 *  unknown (not recorded, or withheld). */
export function causeCategoryTag(facts: ObituaryFacts): PublicTag {
  return facts.death.tag;
}

/**
 * The stored tag set — deterministic, spec-bounded: "Obituaries" + the map label + the cause
 * category, plus at most one non-reserved LLM flavor tag. The model never controls the reserved
 * tags (it only supplies optional flavor).
 */
export function composeTags(facts: ObituaryFacts, llmTags: string[]): string[] {
  const base = reservedTags(facts);
  const flavor = flavorTagOf(facts, llmTags);
  return flavor ? [...base, flavor] : base;
}

function reservedTags(facts: ObituaryFacts): string[] {
  return ["Obituaries", mapLabel(facts.map), causeCategoryTag(facts)];
}

/** The one model tag `composeTags` keeps: the first that is not a reserved tag; null for none.
 *  The cause check reads only this one, since the others are never published. */
export function flavorTagOf(facts: ObituaryFacts, llmTags: string[]): string | null {
  const taken = new Set(reservedTags(facts).map((t) => t.toLowerCase()));
  return llmTags.map((t) => t.trim()).find((t) => t && !taken.has(t.toLowerCase())) ?? null;
}
