import type { DeathContext } from "../context/build.js";
import type { Condition } from "../types.js";

/**
 * The state the player was in at the end, for the public suicide wording ("Suicide (starving,
 * hunted)"). The same definitions the site uses today, so the wording does not move:
 * `packages/domain/src/death-verdict.ts` is where they come from.
 */
/** Energy at or below this on the death line is starving (the game prints 0 when out of food). */
export const STARVE_ENERGY_MAX = 1;
/** Water at or below this on the death line is dehydrated. */
export const DEHYDRATE_WATER_MAX = 1;
/** An infected hit on the victim this many seconds before death, or fewer, is "hunted". */
export const HUNTED_WINDOW_S = 120;

export function conditions(c: DeathContext): Condition[] {
  const out: Condition[] = [];
  const { water, energy } = c.stats;
  if (energy != null && energy <= STARVE_ENERGY_MAX) out.push("starving");
  if (water != null && water <= DEHYDRATE_WATER_MAX) out.push("dehydrated");
  // Any infected hit line on the living victim, damaging or not, as today's reader counts them.
  if (c.hits.some((h) => h.cat === "infected" && c.t0 - h.ts >= 0 && c.t0 - h.ts <= HUNTED_WINDOW_S)) out.push("hunted");
  return out.length ? out : ["healthy"];
}
