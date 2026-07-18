import { z } from "zod";
import type { ObituaryFacts } from "./facts.js";
import { timeAliveLabel } from "./facts.js";
import { OBITUARY_SYSTEM } from "./voice.js";
import type { RecentProse } from "./prose-pg-store.js";
import { recentProseBlock } from "./prose-block.js";

export const OBITUARY_PROMPT_VERSION = "obituary-v2";

export interface Obituary {
  headline: string;
  lede: string;
  body: string;
  pullQuote: { text: string; attribution: string } | null;
  tags: string[];
}

const MAP_LABEL: Record<string, string> = { chernarusplus: "Chernarus", sakhal: "Sakhal", enoch: "Livonia" };
export const mapLabel = (map: string): string => MAP_LABEL[map] ?? map.replace(/\b\w/g, (c) => c.toUpperCase());

/** Deterministic, qualitative death sentence for the prompt — words, never raw stat values. */
export function describeDeath(facts: ObituaryFacts): string {
  if (facts.causeCategory === "pvp") {
    const killer = facts.killerGamertag ? ` (${facts.killerGamertag})` : "";
    const weapon = facts.weapon ? `, ${facts.weapon}` : "";
    const dist = facts.deathDistance != null ? `, from ${Math.round(facts.deathDistance)}m` : "";
    return `killed by another player${killer}${weapon}${dist}.`;
  }
  const v = facts.verdict;
  if (!v) {
    // The bare "suicide" token must never reach the model as a raw word — it is the one cause
    // whose phrasing carries a duty of care, so phrase it here exactly as the verdict path does.
    if (facts.cause === "suicide") return "died by their own hand (not a player kill).";
    return facts.cause ? `${facts.cause.replace(/_/g, " ")} (not a player kill).` : "unknown.";
  }
  const noun: Record<string, string> = {
    suicide: "died by their own hand",
    starvation: "starvation — they ran out of food",
    dehydration: "dehydration — they ran out of water",
    bled_out: "bled out",
    mauled: "mauled — bleeding out after an animal or infected attack",
    wolf: "killed by a wolf",
    bear: "killed by a bear",
    animal: "killed by a wild animal",
    infected: "killed by the infected",
    fall: "died in a fall",
    vehicle: "killed by a vehicle",
    explosion: "killed in an explosion",
    environmental: facts.cause ? facts.cause.replace(/_/g, " ") : "the environment",
    unknown: "unknown",
  };
  const base = noun[v.cause] ?? v.cause.replace(/_/g, " ");
  const hedge = v.confidence === "low" ? "likely " : "";
  const conds = v.conditions.filter((c) => c !== "healthy");
  const state = conds.length
    ? ` At the end they were ${conds.join(" and ")}.`
    : v.conditions.includes("healthy") ? " They were in good health at the end." : "";
  return `${hedge}${base} (not a player kill).${state}`;
}

/** Build the {system, user} messages for one obituary from the factual snapshot. */
export function buildObituaryPrompt(facts: ObituaryFacts, recent: RecentProse[] = []): { system: string; user: string } {
  const lines: string[] = [];
  lines.push(`Write the obituary for this life. Facts (all past tense, all confirmed):`);
  lines.push(`- Callsign: ${facts.gamertag}`);
  lines.push(`- Dateline (map only, never a pin): ${mapLabel(facts.map)}`);
  lines.push(`- Life number on this map: ${facts.lifeNumber} (NOT a career count — see Priors below)`);
  lines.push(`- Time survived this life: ${facts.timeAliveLabel}`);
  lines.push(`- Confirmed kills this life: ${facts.kills}`);
  if (facts.longestKillMeters != null) lines.push(`- Longest kill: ${Math.round(facts.longestKillMeters)}m`);
  lines.push(`- Sessions played: ${facts.sessions}`);
  lines.push(`- Cause of death: ${describeDeath(facts)}`);
  if (facts.ordeals) {
    const o = facts.ordeals;
    if (o.infected.encounters > 0) lines.push(`- Run-ins with the infected: ${o.infected.encounters}${o.infected.worstEncounterHits > 1 ? ` (the worst took ${o.infected.worstEncounterHits} hits)` : ""}`);
    if (o.fire.encounters > 0) lines.push(`- Times caught fire: ${o.fire.encounters}`);
    if (o.pvp.encounters > 0) lines.push(`- Firefights that left a mark before the end: ${o.pvp.encounters}`);
    if (o.buildsPlaced > 0) lines.push(`- Things built this life: ${o.buildsPlaced}`);
  }
  if (facts.hpLow != null && facts.hpLow < 50) lines.push(`- Lowest health recorded: ${Math.round(facts.hpLow)} of 100`);
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
    lines.push(`- None. This was their first recorded life anywhere. A stranger to these shores.`);
  }
  lines.push("");
  if (facts.isLegend) {
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
  lines.push(`Describe the manner of death in qualitative terms — never quote raw stat numbers (energy or water values).`);
  if (facts.verdict?.confidence === "low") {
    lines.push(`The cause of death is an inference from the record, not a certainty — hedge it in-voice ("the record is murky", "the island isn't saying").`);
  }
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

export function causeCategoryTag(cat: ObituaryFacts["causeCategory"]): string {
  switch (cat) {
    case "pvp":
      return "PvP";
    case "suicide":
      return "Self-Inflicted";
    case "environment":
      return "Environment";
    default:
      return "Unknown";
  }
}

/**
 * The stored tag set — deterministic, spec-bounded: "Obituaries" + the map label + the cause
 * category, plus at most one non-reserved LLM flavor tag. The model never controls the reserved
 * tags (it only supplies optional flavor).
 */
export function composeTags(facts: ObituaryFacts, llmTags: string[]): string[] {
  const base = ["Obituaries", mapLabel(facts.map), causeCategoryTag(facts.causeCategory)];
  const taken = new Set(base.map((t) => t.toLowerCase()));
  const flavor = llmTags.map((t) => t.trim()).find((t) => t && !taken.has(t.toLowerCase()));
  return flavor ? [...base, flavor] : base;
}
