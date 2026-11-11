import type { HitCategory } from "../evidence/parse.js";

/**
 * The classifier's tables: the constants the rules compare against. They are the reference's,
 * value for value. ⚠️ Changing any of them changes verdicts: bump `CLASSIFIER_VERSION` and rerun
 * the golden suites.
 *
 * The zone table of the log clock (`SERVER_ZONES`) lives in `evidence/log-clock.ts`, beside the
 * code that reads it, and is re-exported here.
 */
export { SERVER_ZONES } from "../evidence/log-clock.js";

/** The frag grenades, by the two names the log uses for each, to the name a verdict stores. */
export const FRAG: Readonly<Record<string, string>> = {
  "6-M7 Frag Grenade": "M67 frag grenade", M67Grenade: "M67 frag grenade",
  "EGD-5 Frag Grenade": "RGD-5 frag grenade", RGD5Grenade: "RGD-5 frag grenade",
};
export const CLAY: ReadonlySet<string> = new Set(["Claymore", "ClaymoreMine"]);
export const PLAS: ReadonlySet<string> = new Set(["Plastic Explosive", "Plastic_Explosive"]);
/** What a line names when a frag grenade is in someone's hands. */
export const FRAG_ITEMS: readonly string[] = ["6-M7 Frag Grenade", "M67Grenade", "EGD-5 Frag Grenade", "RGD5Grenade"];
export const CREATURE: readonly HitCategory[] = ["infected", "animal"];

/** Health removed per point of PRINTED damage, by body zone. Measured, not from the engine. */
export const ZONE_F: Readonly<Record<string, number>> = {
  Torso: 1.0, Head: 2.0, Brain: 2.0, LeftArm: 0.10, RightArm: 0.10, LeftHand: 0.10, RightHand: 0.10,
  LeftLeg: 0.25, RightLeg: 0.25, LeftFoot: 0.15, RightFoot: 0.15,
};
/** Observed health drain per second, net of regeneration, by how many stats are low. */
export const NET_DRAIN: readonly number[] = [0.0, 0.025, 0.075];
/** The gross drain (0.05 HP/s per stat) is an engine maximum; 5 % covers one-second timestamps. */
export const FIT_TOL = 1.05;

/** How long `types.xml` lets a placed device live, in hours. ⚠️ Devices fire past it in the logs:
 *  it is a caveat on an old placement, never a reason to drop one. */
export const LIFETIME_H: Readonly<Record<string, number>> = {
  TripwireTrap: 168, LandMineTrap: 168, BearTrap: 168, ClaymoreMine: 120, ImprovisedExplosive: 120, Plastic_Explosive: 120,
};

/** The ammo of an explosion hit line, in words (operator notes only). */
export const AMMO_NAME: Readonly<Record<string, string>> = {
  M67Grenade_Ammo: "M67 frag", RGD5Grenade_Ammo: "RGD-5 frag", Explosion_40mm_Ammo: "40mm round",
  ClaymoreMine_Ammo: "claymore", Plastic_Explosive_Ammo: "plastic explosive", LandMineExplosion: "land mine",
  LandMineExplosion_Ammo: "land mine", LandFuelFeed_Ammo: "fuel pump", GasCanister_Ammo: "gas canister",
};

/** The two devices whose placer can score a kill, by the class their `placed` line names. */
export const TRAP_CLASSES = { tripwire: "TripwireTrap", land_mine: "LandMineTrap" } as const;

/** A hit category to the word a co-cause is stored under. A category not listed is its own word. */
export const CO_KEY: Readonly<Record<string, string>> = {
  infected: "infected", fall: "fall", fire: "fire", barbed_wire: "barbed_wire", enviro: "hot_food",
  vehicle: "vehicle_hit", vehicle_no_driver: "vehicle_hit", heat: "heat_damage",
};

/** The game build that brought heatstroke to the servers. The faint cycle means nothing before it. */
export const HEAT_BUILD_TS = Date.UTC(2026, 9, 16) / 1000;

/**
 * Maps where cold kills, and where a sandstorm does what heat does. By `servers.map`.
 * ⚠️ The reference keys these by server id; the map says the same thing and survives a server
 * being re-created under a new id.
 */
export const COLD_MAPS: ReadonlySet<string> = new Set(["sakhal"]);
export const SAND_MAPS: ReadonlySet<string> = new Set(["nasdara"]);

/**
 * World wipes, by server id: UTC instants (ISO 8601). A placement from before a server's last
 * wipe is not a candidate for a trap kill — the device is gone, whatever the log still says.
 * ⚠️ Nothing in the log marks a wipe. A wipe on a live server id must be recorded here, which is
 * a classifier version bump. Empty: no server in service has been wiped under its id.
 */
export const WIPES: Readonly<Record<number, readonly string[]>> = {};

/** One step of a server's spawn levels: from this instant (UTC, ISO 8601) a new character starts
 *  with this Water and Energy. */
export interface SpawnBaseline { from: string; water: number; energy: number }

/** The spawn levels when nothing is known about a server. */
export const SPAWN_DEFAULT: Readonly<{ water: number; energy: number }> = { water: 600, energy: 600 };

/**
 * The Water and Energy a new character spawns with, per server id, as they changed over time.
 * Exported once from the reference run (`spawn_baselines.json` in the private golden data): the
 * levels measured on deaths within 120 s of the same player's previous death, each rounded up to a
 * spawn level. Every server's table starts at its first death, so the lookup agrees with the
 * reference on every golden death. A server not listed (and any instant before its first entry)
 * gets `SPAWN_DEFAULT`.
 *
 * ⚠️ Changing this table changes verdicts: bump `CLASSIFIER_VERSION`. `verify-verdicts` prints
 * the levels observed in production; a new server gets its entry once they show.
 */
export const SPAWN_BASELINES: Readonly<Record<number, readonly SpawnBaseline[]>> = {
  1: [{ from: "2026-07-11T22:51:42Z", water: 600, energy: 600 }],
  2: [
    { from: "2026-07-12T01:58:29Z", water: 600, energy: 600 },
    { from: "2026-07-29T21:28:05Z", water: 750, energy: 1000 },
  ],
  3: [{ from: "2026-07-14T19:27:48Z", water: 600, energy: 600 }],
};

/**
 * The spawn Water and Energy that applied on a server at `ts` (UTC seconds): the last entry at or
 * before `ts`, else the default. `table` replaces the server's checked-in entries (a caller with
 * levels of its own, such as a replay of another project's log).
 */
export function spawnAt(serverId: number, ts: number, table?: readonly SpawnBaseline[] | null): { water: number; energy: number } {
  const rows = table ?? SPAWN_BASELINES[serverId] ?? [];
  let hit: SpawnBaseline | null = null;
  for (const r of rows) if (Date.parse(r.from) / 1000 <= ts) hit = r;
  return hit ? { water: hit.water, energy: hit.energy } : { ...SPAWN_DEFAULT };
}
