import type { ParsedLine } from "./types.js";
import { parseBoot, parseConnecting, parseConnected, parseDisconnected, parseRoster } from "./lines.js";
import { parseDeath } from "./death.js";
import { parsePosition } from "./position.js";
import { parseEmote } from "./emote.js";
import { parseHit } from "./hit.js";
import { parseBuild } from "./build.js";
import { parseTeleport } from "./teleport.js";

/** Every ParsedLine a single raw line yields. Primary event(s) first, then position. */
export function parseLine(raw: string): ParsedLine[] {
  const out: ParsedLine[] = [];

  const boot = parseBoot(raw);
  if (boot) return [{ kind: "boot", localDateTime: boot }];

  const roster = parseRoster(raw);
  if (roster) return [{ kind: "roster", count: roster.count }];

  const connecting = parseConnecting(raw);
  if (connecting) out.push({ kind: "connecting", ...connecting });

  const connected = parseConnected(raw);
  if (connected) out.push({ kind: "connected", ...connected });

  const disconnected = parseDisconnected(raw);
  if (disconnected) out.push({ kind: "disconnected", ...disconnected });

  const death = parseDeath(raw);
  if (death) out.push({ kind: "death", ...death });

  const emote = parseEmote(raw);
  if (emote) out.push({ kind: "emote", ...emote });

  const hit = parseHit(raw);
  if (hit) out.push({ kind: "hit", ...hit });

  const build = parseBuild(raw);
  if (build) out.push({ kind: "build", ...build });

  const teleport = parseTeleport(raw);
  if (teleport) out.push({ kind: "teleport", ...teleport });

  const position = parsePosition(raw);
  if (position) out.push({ kind: "position", ...position });

  return out;
}
