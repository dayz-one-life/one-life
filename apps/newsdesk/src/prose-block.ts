import type { RecentProse } from "./prose-pg-store.js";

/** The do-not-reuse block spliced into both prompt builders. Empty in, empty out — a first
 *  article on a fresh desk gets no block at all. Attributions are de-duplicated
 *  case-insensitively so a phrase the desk has overused is shown once, not N times. */
export function recentProseBlock(recent: RecentProse[]): string[] {
  if (recent.length === 0) return [];

  const lines: string[] = [];
  lines.push("");
  lines.push("RECENTLY PUBLISHED BY THIS DESK — do NOT reuse any of these. Not the attribution");
  lines.push("string, not the headline construction, not the opening move. Repetition is the one");
  lines.push("thing the paper cannot print.");

  lines.push("Recent headlines:");
  for (const r of recent) if (r.headline) lines.push(`- ${r.headline}`);

  const seen = new Set<string>();
  const attributions: string[] = [];
  for (const r of recent) {
    const a = (r.attribution ?? "").trim();
    if (!a) continue;
    const key = a.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    attributions.push(a);
  }
  if (attributions.length) {
    lines.push("Attributions already used (pick none of these — invent a fresh one):");
    for (const a of attributions) lines.push(`- ${a}`);
  }

  const openers = recent.map((r) => r.opener.trim()).filter(Boolean);
  if (openers.length) {
    lines.push("Recent opening lines (do not echo their shape):");
    for (const o of openers) lines.push(`- ${o}`);
  }

  return lines;
}
