import { parsePos } from "./coords.js";

const EMOTE_RE = /Player "([^"]+)"[^)]*\) performed (Emote[A-Za-z0-9]+)(?: with (.+?))?\s*$/u;

export function parseEmote(raw: string): { gamertag: string; emote: string; item: string | null; x: number | null; y: number | null } | null {
  const m = EMOTE_RE.exec(raw);
  if (!m) return null;
  const c = parsePos(raw);
  return { gamertag: m[1]!, emote: m[2]!, item: m[3] != null ? m[3]!.trim() : null, x: c?.x ?? null, y: c?.y ?? null };
}
