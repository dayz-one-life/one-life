import { z } from "zod";
import type { BirthFacts } from "./birth-facts.js";
import { BIRTH_SYSTEM } from "./birth-voice.js";
import { mapLabel } from "./prompt.js";
import { timeAliveLabel } from "./facts.js";

export const BIRTH_PROMPT_VERSION = "birth-v1";

export interface BirthNotice {
  headline: string;
  lede: string;
  body: string;
  pullQuote: { text: string; attribution: string } | null;
  tags: string[];
}

/** Build the {system, user} messages for one birth notice from the arrival snapshot. */
export function buildBirthPrompt(facts: BirthFacts): { system: string; user: string } {
  const lines: string[] = [];
  lines.push(`Write the birth notice for this new life. Facts (present tense — the subject is ALIVE):`);
  lines.push(`- Callsign: ${facts.gamertag}`);
  lines.push(`- Dateline (map only, never a pin — the subject is alive and can be hunted): ${mapLabel(facts.map)}`);
  lines.push(`- Life number on this map: ${facts.lifeNumber}`);
  if (facts.minutesToQualify != null) {
    lines.push(`- Made it real (qualified) after: ${facts.minutesToQualify} min`);
  } else {
    lines.push(`- Not yet qualified at time of filing.`);
  }
  if (facts.persona) lines.push(`- Wearing the face of: ${facts.persona}`);
  lines.push("");
  lines.push(`Priors (everything this player did BEFORE this life, across every map):`);
  if (facts.isKnownQuantity) {
    lines.push(`- Prior lives lived: ${facts.priors.livesLived}`);
    lines.push(`- Longest prior life: ${timeAliveLabel(facts.priors.longestLifeSeconds)}`);
    lines.push(`- Confirmed kills across all prior lives: ${facts.priors.totalKills}`);
    if (facts.priors.usualDeathCause) lines.push(`- Usual cause of death: ${facts.priors.usualDeathCause}`);
    if (facts.priors.lastDeathCause) lines.push(`- Most recent prior death: ${facts.priors.lastDeathCause}`);
    if (facts.priors.bestLifeMap) lines.push(`- Best run was on: ${mapLabel(facts.priors.bestLifeMap)}`);
  } else {
    lines.push(`- None. This is their first recorded life anywhere. A stranger to these shores.`);
  }
  lines.push("");
  if (facts.isKnownQuantity) {
    lines.push(`TONE — KNOWN QUANTITY: the paper recognizes this face. Greet the return with world-weary familiarity ("oh, it's you again") and mock-grandeur. Any needle targets their RECORD — the wasted priors, the repeat deaths — never cruelty. They have earned the ribbing.`);
  } else {
    lines.push(`TONE — STRANGER: no priors, a first life, a stranger to these shores. Welcome the new fool with doomed optimism and mock-ceremony. Do NOT mock them for being new, green, or unlucky — the joke is the world they just walked into, never the person.`);
  }
  lines.push("");
  lines.push(`Respond with only the JSON object described in your instructions.`);
  return { system: BIRTH_SYSTEM, user: lines.join("\n") };
}

const schema = z.object({
  headline: z.string().trim().min(1).max(200),
  lede: z.string().trim().min(1),
  body: z.string().trim().min(1),
  pullQuote: z
    .object({ text: z.string().trim().min(1), attribution: z.string().trim().min(1) })
    .nullable(),
  // The key must be present, but may be an empty array — the reserved tags (Fresh Spawns / map /
  // priors label) are composed deterministically, not from the model.
  tags: z.array(z.string().trim().min(1)).max(6),
});

/** Parse + validate the model's JSON. Throws on non-JSON or a shape violation. */
export function parseBirthNotice(raw: string): BirthNotice {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    // Some models wrap JSON in prose or fences; salvage the first {...} block before giving up.
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("birth notice response was not JSON");
    json = JSON.parse(match[0]);
  }
  return schema.parse(json);
}

/**
 * The stored tag set — deterministic, spec-bounded: "Fresh Spawns" + the map label + the priors
 * label ("Repeat Offender" for a known quantity, "First Life" for a stranger), plus at most one
 * non-reserved LLM flavor tag. The model never controls the reserved tags.
 */
export function composeBirthTags(facts: BirthFacts, llmTags: string[]): string[] {
  const priorsTag = facts.isKnownQuantity ? "Repeat Offender" : "First Life";
  const base = ["Fresh Spawns", mapLabel(facts.map), priorsTag];
  const taken = new Set(base.map((t) => t.toLowerCase()));
  const flavor = llmTags.map((t) => t.trim()).find((t) => t && !taken.has(t.toLowerCase()));
  return flavor ? [...base, flavor] : base;
}
