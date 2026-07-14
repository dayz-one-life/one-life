import type { DeathCause } from "./types.js";

const KILL_RE = /Player "([^"]+)" \(DEAD\) \(id=([^\s)]+)[^)]*\) killed by Player "([^"]+)" \(id=([^\s)]+)[^)]*\)(.*)$/u;
const DEATH_RE = /Player "([^"]+)" \(DEAD\) \(id=([^\s)]+)[^)]*\)(.*)$/u;
const WEAPON_RE = /with (.+?)(?: from ([\d.]+) meters)?\s*$/u;
const STATS_RE = /Stats>\s*Water:\s*([\d.]+)\s*Energy:\s*([\d.]+)\s*Bleed sources:\s*(\d+)/u;
const DEATH_VERB_RE = /\b(died|committed suicide|bled out|drowned|killed by)\b/u;

export function parseDeath(raw: string): {
  victim: string; dayzId: string; cause: DeathCause;
  killer: string | null; weapon: string | null; distance: number | null;
  energy: number | null; water: number | null; bleedSources: number | null;
} | null {
  if (raw.includes("hit by")) return null;
  const m = DEATH_RE.exec(raw);
  if (!m) return null;

  const k = KILL_RE.exec(raw);
  if (k) {
    let weapon: string | null = null;
    let distance: number | null = null;
    const w = WEAPON_RE.exec(k[5]!);
    if (w) {
      weapon = w[1]!.trim();
      distance = w[2] != null && w[2] !== "" ? parseFloat(w[2]) : null;
    }
    return { victim: k[1]!, dayzId: k[2]!, cause: "pvp", killer: k[3]!, weapon, distance,
      energy: null, water: null, bleedSources: null };
  }

  const tail = m[3]!;
  const lower = tail.toLowerCase();
  // Precision: only a real death verb is a death — a bare (DEAD) marker (a corpse re-listed in the
  // next PlayerList snapshot) is NOT. This kills the delayed-DEAD-reappearance duplicate at the source.
  if (!DEATH_VERB_RE.test(lower)) return null;
  const cause: DeathCause =
    lower.includes("bled out") ? "bled_out" :
    lower.includes("drowned") ? "drowned" :
    lower.includes("committed suicide") ? "suicide" :
    lower.includes("killed by") ? "environment" :
    lower.includes("died") ? "died" : "unknown";

  const s = STATS_RE.exec(tail);
  const water = s ? parseFloat(s[1]!) : null;
  const energy = s ? parseFloat(s[2]!) : null;
  const bleedSources = s ? parseInt(s[3]!, 10) : null;

  return { victim: m[1]!, dayzId: m[2]!, cause, killer: null, weapon: null, distance: null,
    energy, water, bleedSources };
}
