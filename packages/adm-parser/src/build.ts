import type { BuildAction } from "./types.js";
import { parsePos } from "./coords.js";

// Note: "Built" has NO leading space before it in real logs: `pos=<...>)Built base on Fence`.
const BUILD_RE = /Player "([^"]+)"[^)]*\)\s*(placed|Built|Dismantled|packed|repaired)\s+(.+?)(?:<([^>]+)>)?(?: with (.+?))?\s*$/u;

export function parseBuild(raw: string): {
  gamertag: string; action: BuildAction; object: string; className: string | null; tool: string | null;
  x: number | null; y: number | null;
} | null {
  const m = BUILD_RE.exec(raw);
  if (!m) return null;
  const action = m[2]!.toLowerCase() as BuildAction;
  const c = parsePos(raw);
  return {
    gamertag: m[1]!,
    action,
    object: m[3]!.trim(),
    className: m[4] != null ? m[4]! : null,
    tool: m[5] != null ? m[5]!.trim() : null,
    x: c?.x ?? null,
    y: c?.y ?? null,
  };
}
