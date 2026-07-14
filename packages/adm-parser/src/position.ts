import { parsePos } from "./coords.js";

const PLAYER_NAME_RE = /Player "([^"]+)"/u;

export function parsePosition(raw: string): { gamertag: string; x: number; y: number } | null {
  if (raw.includes("hit by")) return null;
  const p = PLAYER_NAME_RE.exec(raw);
  if (!p) return null;
  const c = parsePos(raw);
  if (!c) return null;
  return { gamertag: p[1]!, x: c.x, y: c.y };
}
