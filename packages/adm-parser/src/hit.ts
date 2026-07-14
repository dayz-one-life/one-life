import { parsePos } from "./coords.js";

const HP_RE = /\[HP:\s*([\d.]+)\]/u;
const VICTIM_RE = /Player "([^"]+)"/u;
const BY_PLAYER_RE = /hit by Player "([^"]+)"/u;
const BY_INFECTED_RE = /hit by Infected/u;
const INTO_RE = /into ([A-Za-z]+)(?:\(\d+\))?/u;
const DAMAGE_RE = /for ([\d.]+) damage/u;
const BY_OTHER_RE = /hit by ([A-Za-z0-9_]+)/u;

export function parseHit(raw: string): {
  victim: string; victimHp: number | null;
  attackerType: "player" | "infected" | "environment";
  attackerGamertag: string | null; attackerLabel: string | null;
  damage: number | null; bodyPart: string | null;
  x: number | null; y: number | null;
} | null {
  if (!raw.includes("hit by")) return null;
  const v = VICTIM_RE.exec(raw);
  if (!v) return null;

  const hp = HP_RE.exec(raw);
  const dmg = DAMAGE_RE.exec(raw);
  const into = INTO_RE.exec(raw);
  const victimHp = hp ? parseFloat(hp[1]!) : null;
  const damage = dmg ? parseFloat(dmg[1]!) : null;
  const bodyPart = into ? into[1]! : null;
  const c = parsePos(raw);
  const x = c?.x ?? null;
  const y = c?.y ?? null;

  const byPlayer = BY_PLAYER_RE.exec(raw);
  if (byPlayer) {
    return { victim: v[1]!, victimHp, attackerType: "player", attackerGamertag: byPlayer[1]!, attackerLabel: null, damage, bodyPart, x, y };
  }
  if (BY_INFECTED_RE.test(raw)) {
    return { victim: v[1]!, victimHp, attackerType: "infected", attackerGamertag: null, attackerLabel: "Infected", damage, bodyPart, x, y };
  }
  const other = BY_OTHER_RE.exec(raw);
  return { victim: v[1]!, victimHp, attackerType: "environment", attackerGamertag: null, attackerLabel: other ? other[1]! : null, damage, bodyPart, x, y };
}
