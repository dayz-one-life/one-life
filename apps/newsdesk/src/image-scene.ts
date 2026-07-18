import { z } from "zod";
import type { ArticleKind, ImageCategory } from "./image-categories.js";

export interface RecentCover { caption: string; sceneLine: string }
export interface SceneChoice { caption: string; scene: string }

/** Hard rails for the scene-writer. These bind EVERY category, menu or invented — the escape
 *  hatch invents framings, never rule exemptions. Source: brand-bible §10.4 (spec §3). */
export const IMAGE_SCENE_SYSTEM = [
  "You are the photo desk of One Life, a deadpan DayZ-community tabloid. Given the facts of an",
  "article, you choose the framing for its single AI-generated photograph and write the scene.",
  "",
  "HARD RULES (non-negotiable, apply to every category including ones you invent):",
  "- Imply, don't depict: NEVER a corpse, body, or gore. Death is told through aftermath,",
  "  absence, objects, witnesses.",
  "- Fog Rule: generic unidentifiable locales only. No landmarks, no base layouts. A living",
  "  subject stays deniable: distant, obscured, or blurred.",
  "- No legible text, no logos, no real-person likenesses. Imperfect or partially obscured faces",
  "  (hood, mask, blur, shadow) are a feature.",
  "- One clear subject caught mid-moment. Never posed, never glamorous, never professionally",
  "  composed.",
  "- Keep it generatable: a single simple subject, no complex multi-figure choreography.",
  "- Tone: obituaries = deadpan mock-gravity; birth notices = doomed optimism. Punch up, never",
  "  down. Rib first-lifers affectionately, never cruelly.",
  "",
  "Prefer a category from the menu. ESCAPE HATCH: you may invent a new category when the story",
  "genuinely earns it — then you must supply its caption yourself, in the same deadpan register.",
  "",
  "Do not repeat any scene or composition from the recent-covers list.",
  "",
  'Respond with JSON only: {"caption": string, "scene": string}. caption: the photo caption in',
  "CAPS, max 48 characters. scene: one paragraph, one specific concrete scene, max 600 characters.",
  "Write the scene only — the fixed camera style is appended by the system.",
].join("\n");

export function buildScenePrompt(args: {
  kind: ArticleKind;
  facts: Record<string, unknown>;
  headline: string;
  lede: string | null;
  eligible: ImageCategory[];
  recent: RecentCover[];
}): { system: string; user: string } {
  const lines: string[] = [];
  lines.push(`Article kind: ${args.kind === "obituary" ? "obituary (The Morgue)" : "birth notice (The Nursery)"}`);
  lines.push(`Headline: ${args.headline}`);
  if (args.lede) lines.push(`Lede: ${args.lede}`);
  lines.push(`Facts: ${JSON.stringify(args.facts)}`);
  lines.push("");
  lines.push("Category menu (eligible for this story):");
  for (const c of args.eligible) lines.push(`- ${c.caption}: ${c.example}`);
  if (args.recent.length > 0) {
    lines.push("");
    lines.push("Recent covers — do NOT repeat these scenes or compositions:");
    for (const r of args.recent) lines.push(`- ${r.caption} — ${r.sceneLine}`);
  }
  return { system: IMAGE_SCENE_SYSTEM, user: lines.join("\n") };
}

const sceneSchema = z.object({
  caption: z.string().transform((v) => v.trim().toUpperCase()).pipe(z.string().min(3).max(48)),
  scene: z.string().transform((v) => v.replace(/\s+/g, " ").trim()).pipe(z.string().min(20).max(600)),
});

/** JSON.parse with the prompt.ts salvage fallback, then zod. Throws on anything invalid. */
export function parseScene(raw: string): SceneChoice {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    const m = /\{[\s\S]*\}/.exec(raw);
    if (!m) throw new Error("scene writer returned no JSON object");
    obj = JSON.parse(m[0]);
  }
  return sceneSchema.parse(obj);
}
