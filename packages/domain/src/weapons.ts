/** Common melee weapon names as they appear in ADM kill lines, lowercase.
 *  Used by the point-blank incident detector: melee is always point-blank, so it's not news.
 *  Unknown weapons deliberately count as firearms — worst case is one wry article about an
 *  exotic knife, not a missed record. Extend as new names are observed in real logs. */
const MELEE_WEAPON_NAMES = [
  "fists",
  "combat knife", "hunting knife", "kitchen knife", "steak knife", "kukri", "machete",
  "hatchet", "firefighter axe", "woodaxe", "wood axe", "ice axe", "pickaxe",
  "baseball bat", "sledgehammer", "hammer", "pipe wrench", "crowbar", "shovel",
  "field shovel", "farming hoe", "cattle prod", "stun baton", "brass knuckles",
  "screwdriver",
];

export const MELEE_WEAPONS: ReadonlySet<string> = new Set(MELEE_WEAPON_NAMES);

export function isMeleeWeapon(weapon: string | null): boolean {
  if (!weapon) return false;
  return MELEE_WEAPONS.has(weapon.trim().toLowerCase());
}
