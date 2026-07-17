import { z } from "zod";
import type { ObituaryFacts } from "./facts.js";
import { OBITUARY_SYSTEM } from "./voice.js";

export const OBITUARY_PROMPT_VERSION = "obituary-v1";

export interface Obituary {
  headline: string;
  lede: string;
  body: string;
  pullQuote: { text: string; attribution: string } | null;
  tags: string[];
}

const MAP_LABEL: Record<string, string> = { chernarusplus: "Chernarus", sakhal: "Sakhal", enoch: "Livonia" };
const mapLabel = (map: string): string => MAP_LABEL[map] ?? map.replace(/\b\w/g, (c) => c.toUpperCase());

/** Build the {system, user} messages for one obituary from the factual snapshot. */
export function buildObituaryPrompt(facts: ObituaryFacts): { system: string; user: string } {
  const lines: string[] = [];
  lines.push(`Write the obituary for this life. Facts (all past tense, all confirmed):`);
  lines.push(`- Callsign: ${facts.gamertag}`);
  lines.push(`- Dateline (map only, never a pin): ${mapLabel(facts.map)}`);
  lines.push(`- Time survived this life: ${facts.timeAliveLabel}`);
  lines.push(`- Confirmed kills this life: ${facts.kills}`);
  if (facts.longestKillMeters != null) lines.push(`- Longest kill: ${Math.round(facts.longestKillMeters)}m`);
  lines.push(`- Sessions played: ${facts.sessions}`);
  if (facts.causeCategory === "pvp") {
    lines.push(`- Cause of death: killed by another player${facts.killerGamertag ? ` (${facts.killerGamertag})` : ""}${facts.weapon ? `, ${facts.weapon}` : ""}.`);
  } else if (facts.causeCategory === "environment") {
    lines.push(`- Cause of death: ${facts.cause ?? "the environment"} (not a player kill).`);
  } else {
    lines.push(`- Cause of death: unknown.`);
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
  return cat === "pvp" ? "PvP" : cat === "environment" ? "Environment" : "Unknown";
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
