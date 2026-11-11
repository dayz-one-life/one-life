/**
 * The classifier's token lists: every cause the reference classifier can return and every role it
 * can attach to a person. They are the reference's own strings, verbatim — parity with the golden
 * answers is string equality, so nothing here is renamed, re-cased or tidied.
 *
 * ⚠️ Do not edit by hand. The lists are copied from `tokens.json` in the private golden data, which
 * is produced by reading the reference classifier's source. The private suite
 * `test/golden-private/tokens-golden.test.ts` fails when the two disagree, in either direction.
 *
 * ⚠️ Most of these words are INTERNAL. A logout cause, an inferred role and a trap owner must
 * never reach a page, the API or the writer as themselves; `present.ts` is the only way out.
 */
export const INTERNAL_CAUSES = [
  "animal",
  "animal_bear",
  "animal_dog",
  "animal_infected",
  "animal_other",
  "animal_wolf",
  "bled_out_animal",
  "bled_out_barbed_wire",
  "bled_out_infected",
  "bled_out_other",
  "cold_exposure",
  "dehydration",
  "drowned",
  "explosive_40mm",
  "explosive_charge",
  "explosive_claymore",
  "explosive_grenade",
  "explosive_held_grenade",
  "explosive_other",
  "explosive_trap",
  "fall",
  "fire",
  "fuel_explosion",
  "heatstroke",
  "heatstroke_or_silicosis",
  "infected",
  "landmine",
  "logout_under_attack",
  "pneumonia",
  "pvp",
  "pvp_bleedout",
  "respawn_while_unconscious",
  "restrained_logout",
  "self_inflicted",
  "self_inflicted_explosive",
  "starvation",
  "starvation_and_dehydration",
  "suicide",
  "unconscious_logout",
  "unknown",
  "vehicle_crash_occupant",
  "vehicle_impact",
  "vehicle_own_crash",
  "vehicle_run_over",
] as const;

/** Roles of the one player a verdict is attributed to. */
export const ATTRIBUTION_ROLES = [
  "device_owner (inferred)",
  "driver",
  "grenade_holder",
  "grenade_holder (inferred)",
  "killer",
  "killer (inferred)",
  "killer (inferred, bleed-out)",
  "knocked_out_by",
  "self",
  "self (own device)",
  "self (own fire)",
  "self (own held grenade)",
  "self (probable)",
  "self (spawn reset)",
  "trap_owner",
] as const;

/** Roles of players who contributed without being the attribution. */
export const CONTRIBUTOR_ROLES = [
  "assist",
  "attacker_before_suicide",
  "contributor",
  "contributor (earlier wound)",
  "earlier_attacker",
  "grenade_holder (inferred, co-cause)",
  "last_attacker_before_suicide",
  "possible_restrainer",
  "trap_owner (co-cause)",
] as const;
