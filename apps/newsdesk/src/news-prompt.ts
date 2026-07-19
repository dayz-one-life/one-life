import { z } from "zod";
import type { ArticleBlock } from "@onelife/read-models";
import type { NewsFacts, NewsSubject } from "./news-facts.js";
import { NEWS_SYSTEM } from "./news-voice.js";
import { mapLabel } from "./prompt.js";
import { timeAliveLabel } from "./facts.js";
import type { RecentProse } from "./prose-pg-store.js";
import { recentProseBlock } from "./prose-block.js";

export const NEWS_PROMPT_VERSION = "news-v1";

/** `body` is DERIVED, never model-authored (spec §8): the para blocks joined by a blank line,
 *  stored for the OG card, the meta description and any future Discord unfurl. Because precedence
 *  is one-way, the share card can never quote text that is not on the page. */
export interface NewsArticle {
  headline: string;
  lede: string;
  blocks: ArticleBlock[];
  body: string;
  pullQuote: { text: string; attribution: string } | null;
  tags: string[];
}

// Shape only, never size. Zod caps the block count and list length so a runaway response cannot
// write an unbounded row, but imposes NO minimum on any text: spec §5 is explicit that length is
// funded by fact density and that a floor is a padding instruction which would also burn an
// attempt against NEWSDESK_MAX_ATTEMPTS on a genuinely thin cluster.
const MAX_BLOCKS = 24;
const MAX_LIST_ITEMS = 8;
const line = z.string().trim().min(1);

const blockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("para"), text: line }),
  z.object({ type: z.literal("subhead"), text: line }),
  z.object({ type: z.literal("quote"), text: line, attribution: line }),
  z.object({ type: z.literal("list"), items: z.array(line).min(1).max(MAX_LIST_ITEMS) }),
]);

const schema = z.object({
  headline: z.string().trim().min(1).max(200),
  lede: z.string().trim().min(1),
  // At least one `para`. This is a SHAPE constraint, not a length floor — §5's "never request a
  // minimum" is about word counts, and a one-word paragraph satisfies this. It exists because
  // `body` is derived from the para blocks ALONE and is the only text the OG card, the meta
  // description and any future Discord unfurl can quote: a para-free article publishes with an
  // empty share card. A refusal costs one attempt and a retry; an empty body is permanent.
  blocks: z.array(blockSchema).min(1).max(MAX_BLOCKS)
    .refine((bs) => bs.some((b) => b.type === "para"), {
      message: "an article must contain at least one para block",
    }),
  pullQuote: z.object({ text: line, attribution: line }).nullable(),
  // Present but possibly empty — the reserved tags (News / map / trigger) are composed
  // deterministically, not by the model.
  tags: z.array(z.string().trim().min(1)).max(6),
});

/** The para blocks joined by a blank line. The single producer of `articles.body` for a news row. */
export function deriveBody(blocks: ArticleBlock[]): string {
  return blocks
    .filter((b): b is Extract<ArticleBlock, { type: "para" }> => b.type === "para")
    .map((b) => b.text)
    .join("\n\n");
}

/** Parse + validate the model's JSON, then DERIVE body. Throws on non-JSON or a shape violation.
 *  Any `body` key the model volunteered is discarded — it is not in the schema and is not read. */
export function parseNewsArticle(raw: string): NewsArticle {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    // Some models wrap JSON in prose or fences; salvage the first {...} block before giving up.
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("news article response was not JSON");
    json = JSON.parse(match[0]);
  }
  const p = schema.parse(json);
  const blocks: ArticleBlock[] = p.blocks;
  return {
    headline: p.headline,
    lede: p.lede,
    blocks,
    body: deriveBody(blocks),
    pullQuote: p.pullQuote,
    tags: p.tags,
  };
}

/**
 * Spec §5. Naming the failure mode explicitly is necessary — a model handed a gap will fill it,
 * and here the gap is a real person's real-world decision that the paper cannot know and must
 * never narrate. This is a Tier-2 brand-bible line (never target a real person rather than an
 * in-game persona), sharpened by the fact that 13 of 14 verified subjects have never visited the
 * site and therefore never consented to anything.
 */
export const FORBIDDEN_FRAMING_DIRECTIVE =
  `STAY INSIDE THE WORLD. The subject is a survivor in it, never a person at a keyboard. Do NOT write "the player", "logged off", "logged out", "stopped playing", "quit the game", "lost interest", or any second person address to a real person, and do not paraphrase around the ban. You do not know why anyone stopped and you cannot know; inventing a reason — boredom, another game, something in their life — is a lie about a real human being. A survivor was seen, and then was not.`;

/** The priors block, identical in shape to the obituary and birth desks so the model reads one
 *  vocabulary across all three. A first-lifer gets a dedicated branch, never an inferred rookie. */
function priorsLines(s: NewsSubject): string[] {
  const lines: string[] = [];
  if (s.isKnownQuantity) {
    lines.push(`- Prior lives lived: ${s.priors.livesLived}`);
    lines.push(`- Longest prior life: ${timeAliveLabel(s.priors.longestLifeSeconds)}`);
    lines.push(`- Confirmed kills across all prior lives: ${s.priors.totalKills}`);
    if (s.priors.usualDeathCause) lines.push(`- Usual cause of death: ${s.priors.usualDeathCause}`);
    if (s.priors.lastDeathCause) lines.push(`- Most recent prior death: ${s.priors.lastDeathCause}`);
    if (s.priors.bestLifeMap) lines.push(`- Best run was on: ${mapLabel(s.priors.bestLifeMap)}`);
  } else {
    lines.push(`- None. This is their first recorded life anywhere. A stranger to these shores.`);
  }
  return lines;
}

function standingDeadLines(facts: NewsFacts): string[] {
  const s = facts.subjects[0];
  if (!s) throw new Error("standing dead facts carry no subject");
  const lines: string[] = [];
  lines.push(`Write THE STANDING DEAD feature for this subject.`);
  lines.push(`THE SUBJECT IS ALIVE. There is no death here, no body, and no cause — only an absence. Never state or imply that they died.`);
  lines.push("");
  lines.push(`Facts (all confirmed):`);
  lines.push(`- Callsign: ${s.gamertag}`);
  lines.push(`- Dateline (map only, never a pin — the subject is alive and can be hunted): ${mapLabel(facts.map)}`);
  lines.push(`- Life number on this map: ${s.lifeNumber} (NOT a career count — see Priors below)`);
  lines.push(`- Time actually PLAYED this life: ${s.timeAliveLabel}. This is the only survival figure. Never present the calendar gap as time survived.`);
  lines.push(`- Confirmed kills this life: ${s.kills}`);
  lines.push(`- Sessions played: ${s.sessions}`);
  lines.push(`- Hits absorbed and survived this life: ${facts.hitsAbsorbed}`);
  lines.push(`- Idle: ${facts.idleHours} hours since the world last had word of them. This is IDLE TIME — the length of an absence, never an achievement and never survival time.`);
  if (s.persona) lines.push(`- Wearing the face of: ${s.persona}`);
  lines.push("");
  lines.push(`Priors (everything this player did BEFORE this life, across every map):`);
  lines.push(...priorsLines(s));
  lines.push("");
  lines.push(`TONE — THE STANDING DEAD: elegiac, baffled, warm. A eulogy with no death in it. Never mock the leaving, never guess where they went, and never explain the absence. They are still standing somewhere; the paper does not say where, because it does not know.`);
  lines.push(`THE TURN: the story's turn is the moment the world stopped receiving word of them, reported FROM INSIDE THE FICTION.`);
  return lines;
}

function longFormLines(facts: NewsFacts): string[] {
  const lines: string[] = [];
  lines.push(`Write THE LONG FORM feature. ${facts.subjectCount} qualified deaths on one server, inside the same few minutes and the same small patch of ground. The subject of this piece is a SHARED ENDING, not a person.`);
  lines.push("");
  lines.push(`Facts (all past tense, all confirmed):`);
  lines.push(`- Dateline (map only, never a pin): ${mapLabel(facts.map)}`);
  lines.push(`- Seconds between the first death and the last: ${facts.spanSeconds} seconds`);
  lines.push(`- They died close together. You are NOT told how close, and you must never state, estimate, or imply a distance, a landmark, or a route.`);
  lines.push("");
  for (const s of facts.subjects) {
    lines.push(`SUBJECT — ${s.gamertag}:`);
    lines.push(`- Life number on this map: ${s.lifeNumber}`);
    lines.push(`- Time actually PLAYED this life: ${s.timeAliveLabel}`);
    lines.push(`- Confirmed kills this life: ${s.kills}`);
    lines.push(`- Sessions played: ${s.sessions}`);
    if (s.persona) lines.push(`- Wearing the face of: ${s.persona}`);
    lines.push(`- Cause of death on the record: ${s.deathCause ?? "not recorded"}`);
    lines.push(`- Priors before this life:`);
    lines.push(...priorsLines(s).map((l) => `  ${l}`));
    lines.push("");
  }
  if (facts.allFreshSubjects) {
    lines.push(`TONE — REVERENT. Every subject here was on their first life anywhere and had never killed anyone. They are a protected class: the sneer is fully off and the needle never comes at all. Tell the parallel straight. Name them neutrally, keep NO gear-gap ledger, and the story is the world that did this — the outbreak, the coincidence, the terrible timing. Never their competence, never their inexperience.`);
  } else {
    lines.push(`TONE — COLD FORENSIC MOCK-EPIC. At least one subject was a known quantity with a record behind them. The shared ending gets the full autopsy and nobody leaves it looking good. The needle lands on the record and the circumstances, never on a person's worth.`);
  }
  lines.push(`THE TURN: the story's turn is what happened AFTER the deaths.`);
  return lines;
}

/** Build the {system, user} messages for one news feature. */
export function buildNewsPrompt(facts: NewsFacts, recent: RecentProse[] = []): { system: string; user: string } {
  const lines = facts.trigger === "standing_dead" ? standingDeadLines(facts) : longFormLines(facts);
  lines.push("");
  lines.push(FORBIDDEN_FRAMING_DIRECTIVE);
  lines.push("");
  lines.push(...recentProseBlock(recent));
  lines.push("");
  lines.push(`Respond with only the JSON object described in your instructions.`);
  return { system: NEWS_SYSTEM, user: lines.join("\n") };
}

/**
 * The stored tag set — deterministic and spec-bounded: "News" + the map label + the trigger name,
 * plus at most one non-reserved LLM flavor tag. The model never controls the reserved tags.
 * Mirrors composeTags / composeBirthTags exactly.
 */
export function composeNewsTags(facts: NewsFacts, llmTags: string[]): string[] {
  const triggerTag = facts.trigger === "standing_dead" ? "The Standing Dead" : "The Long Form";
  const base = ["News", mapLabel(facts.map), triggerTag];
  const taken = new Set(base.map((t) => t.toLowerCase()));
  const flavor = llmTags.map((t) => t.trim()).find((t) => t && !taken.has(t.toLowerCase()));
  return flavor ? [...base, flavor] : base;
}
