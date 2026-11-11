import { classifyEntityLabel } from "@onelife/domain";
import type { DeathCause } from "./types.js";

// ⚠️ Keep the optional `(DEAD)` here in step with DEATH_RE below. If this one demanded the marker
// while DEATH_RE did not, a marker-less PvP kill would match only DEATH_RE and fall through to the
// entity branch, which would capture the literal `Player` as the killing entity — an `environment`
// death with no killer and no kills row, silently. No such line exists in the corpus today; the
// symmetry is what keeps it from mattering if one ever appears.
// ⚠️ The KILLER half takes an optional `(DEAD)` too. DayZ marks the killer dead when he died
// before the line was written — which is every death by one's own explosive (the line names the
// victim as his own killer), every mutual kill, and a kill by someone a third player had already
// killed. Without it those lines missed this regex and
// did exactly what the paragraph above warns about: `environment`, killing entity `Player`.
// Matching them here is only safe together with the self-kill return in parseDeath — the killer
// id (group 4) is read so a line naming the victim never reaches the `pvp` return.
const KILL_RE = /Player "([^"]+)" (?:\(DEAD\) )?\(id=([^\s)]+)[^)]*\) killed by Player "([^"]+)" (?:\(DEAD\) )?\(id=([^\s)]+)[^)]*\)(.*)$/u;
const KILLER_DEAD_RE = /killed by Player "[^"]+" \(DEAD\) /u;
/**
 * A kill line whose killer is another player who was ALREADY DEAD when it was written. `(DEAD)`
 * says only that — usually it is a mutual kill (each line names the other), but the killer may
 * equally have been killed by a third player a moment earlier. Operator decision, 2026-11-10: it
 * counts as a player kill, so the line takes the ordinary `pvp` return (killer named, a `kills`
 * row, a qualifying death). Set this to `false` to send such a line back to `environment` with no
 * killer; nothing else needs to change. A line naming the VICTIM as the killer is not governed by
 * this — that is never a player kill, whatever this says.
 *
 * ⚠️ Known gap, left for a later step: the `kills` row takes the victim's timestamp, and DayZ can
 * stamp this line a second after the killer's own death line. Per-life kill counting is a time
 * window ending at `lives.ended_at`, so such a kill is in the killer's career total but in none
 * of his lives. `packages/projections/test/fold-death.test.ts` pins it.
 */
export const MUTUAL_KILL_IS_PVP: boolean = true;
// ⚠️ The `(DEAD)` marker is OPTIONAL. Like a fatal fall, a suicide is logged twice and
// inconsistently: a `committed suicide` line plus a clauseless `died. Stats>` line — and DayZ
// omits `(DEAD)` on the suicide line about 12% of the time (12 of 102 in production). Requiring
// the marker dropped those lines entirely, so only the bare `died.` survived and the life read
// "Unknown" — 10 of the 19 unknown lives in production. Nothing else in the corpus carries a
// death verb without the marker (surveyed over every raw line), and DEATH_VERB_RE below is what
// actually separates a death from a roster/position line — the marker never was.
const DEATH_RE = /Player "([^"]+)" (?:\(DEAD\) )?\(id=([^\s)]+)[^)]*\)(.*)$/u;
const WEAPON_RE = /with (.+?)(?: from ([\d.]+) meters)?\s*$/u;
const STATS_RE = /Stats>\s*Water:\s*([\d.]+)\s*Energy:\s*([\d.]+)\s*Bleed sources:\s*(\d+)/u;
const DEATH_VERB_RE = /\b(died|committed suicide|bled out|drowned|killed by)\b/u;

// ⚠️ Capture the WHOLE entity, to the end of the clause. Class names are not all one token:
// `6-M7 Frag Grenade` and `EGD-5 Frag Grenade` carry hyphens and spaces, and the old
// `[A-Za-z0-9_]+` stored them as the entities `6` and `EGD`. The lookahead keeps a `Player "…"`
// clause that KILL_RE did not match from being read as an entity called `Player`.
const KILLED_BY_ENTITY_RE = /killed by (?!Player ")(\S.*?)(?: with .+)?\s*$/u;
// The empty-killer form: DayZ names no killer at all, only what did it — `killed by  with <thing>`,
// TWO spaces. A launched 40mm round, a fireplace, and (rarely) a firearm with no owner. The log
// names no person on any of them, so `killer` stays null in every case.
// ⚠️ The capture starts on a non-space: a line that names nothing after `with` must not match and
// store the empty string as the entity — "no entity" is null everywhere else.
const EMPTY_KILLER_RE = /killed by  with (\S.*?)(?: from [\d.]+ meters)?\s*$/u;
// A vehicle with nobody in the seat: `killed by NO DRIVER (<class>)`. The class is the entity.
const NO_DRIVER_RE = /killed by NO DRIVER \(([A-Za-z0-9_]+)\)/u;
// Things that kill by exploding, as the kill line spells them. Anchored both ends on purpose: an
// explosive is named exactly, and a lookalike class must not ride in on a prefix. The fuel pump is
// the one prefix match (`Land_FuelStation_Feed*` has per-map variants).
const EXPLOSIVE_ENTITIES: readonly RegExp[] = [
  /^M67Grenade$/, /^RGD5Grenade$/, /^6-M7 Frag Grenade$/, /^EGD-5 Frag Grenade$/,
  /^LandMineTrap$/, /^Claymore(Mine)?$/, /^Plastic[ _]Explosive$/, /^Land_FuelStation_Feed/,
];
/** True when the `with <weapon>` of a kill line is something that explodes (a launcher, a 40mm
 *  round, a grenade, a claymore, plastic explosive) rather than something that is aimed. */
function isExplosiveWeapon(weapon: string | null): boolean {
  return weapon != null && /^40mm|M79|Grenade|Claymore|Plastic[ _]Explosive/i.test(weapon);
}
// Ordered entity dict (first match wins). Wolf/bear/animal are classified by the shared
// @onelife/domain classifier (same rules the encounters read-model uses for hit labels).
// Only class-name patterns confirmable from DayZ conventions ship; anything else stays
// "environment" with the entity captured — the backfill-death-causes survey logs unmapped
// entities so this dict can grow. The prefixes below (Zmb, FallDamage, vehicle names) are
// disjoint from the Animal_ prefixes the shared classifier matches, so checking the shared
// classifier first is order-safe.
const ENTITY_CAUSES: readonly [RegExp, DeathCause][] = [
  [/^Zmb/, "infected"],
  [/^FallDamage$/, "fall"],
  // DayZ base-game drivable vehicles (Central Economy events.xml; color variants share the prefix):
  // CivilianSedan* (Olga), Hatchback_02* (Gunter), Sedan_02* (Sarka), Offroad_02 (Humvee),
  // OffroadHatchback* (Ada), Truck_01_Covered* (M3S), Boat_01* (assault boat). Grow from the
  // backfill survey for map-specific classes (Sakhal/Livonia) as they appear.
  [/^(CivilianSedan|Hatchback_|Sedan_|Offroad|Truck_|Boat_)/, "vehicle"],
  [/^Motorbike_/, "vehicle"],
];

// A real player id as the log writes it: a long opaque token (40 characters in every death line
// surveyed). DayZ also writes sentinels in the id slot — `id=ERROR`, `id=Unknown` — and two
// different players can carry the same one.
const REAL_ID_RE = /^[A-Za-z0-9+/_=-]{40,}$/u;
/** True when a kill line names the victim as his own killer. Equal ids prove it only when the id
 *  is a real one; on a sentinel id the names must agree as well. */
function isSelfKill(victim: string, victimId: string, killer: string, killerId: string): boolean {
  if (victimId !== killerId) return false;
  return REAL_ID_RE.test(victimId) || victim === killer;
}

/** The cause a named non-player entity stands for, or null when nothing here recognises it. */
function entityCauseOf(entity: string): DeathCause | null {
  return classifyEntityLabel(entity)
    ?? (EXPLOSIVE_ENTITIES.some((re) => re.test(entity)) ? "explosion" : null)
    ?? ENTITY_CAUSES.find(([re]) => re.test(entity))?.[1]
    ?? null;
}

/** What a `killed by <not a player>` clause names: the entity and the cause it stands for. */
function namedKiller(tail: string): { entity: string | null; cause: DeathCause | null } {
  const noDriver = NO_DRIVER_RE.exec(tail);
  if (noDriver) return { entity: noDriver[1]!, cause: "vehicle" };
  const empty = EMPTY_KILLER_RE.exec(tail);
  if (empty) {
    const thing = empty[1]!.trim();
    // Only the 40mm round is an explosion. A fireplace, an ownerless firearm and anything else
    // stay `environment` — the thing is kept as the entity so the backfill survey can see it.
    return { entity: thing, cause: /^40mm/i.test(thing) ? "explosion" : null };
  }
  const entity = KILLED_BY_ENTITY_RE.exec(tail)?.[1] ?? null;
  return { entity, cause: entity ? entityCauseOf(entity) : null };
}

export function parseDeath(raw: string): {
  victim: string; dayzId: string; cause: DeathCause;
  killer: string | null; weapon: string | null; distance: number | null;
  energy: number | null; water: number | null; bleedSources: number | null;
  deathEntity: string | null;
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
    const base = { victim: k[1]!, dayzId: k[2]!, energy: null, water: null, bleedSources: null };
    // ⚠️ A kill line that names the VICTIM as the killer (same id both sides) is a player dying
    // to his own device, never a player kill. This return must stay ABOVE the `pvp` one: below
    // it, the line would credit the victim with killing himself — a `pvp` death, which qualifies
    // the life on its own. The id is compared, not the name; the name can differ (isSelfKill
    // asks for the name too only when the id is a placeholder).
    // `weapon` and `distance` are nulled on purpose: they describe a player kill, the fold copies
    // them onto the life whatever the cause, and the web timeline prints them under every death.
    // The thing is kept once, as the entity — as the empty-killer form keeps it.
    if (isSelfKill(k[1]!, k[2]!, k[3]!, k[4]!)) {
      return { ...base, cause: isExplosiveWeapon(weapon) ? "explosion" : "environment",
        killer: null, weapon: null, distance: null, deathEntity: weapon };
    }
    if (!MUTUAL_KILL_IS_PVP && KILLER_DEAD_RE.test(raw)) {
      return { ...base, cause: "environment", killer: null, weapon: null, distance: null, deathEntity: "Player" };
    }
    return { ...base, cause: "pvp", killer: k[3]!, weapon, distance, deathEntity: null };
  }

  const tail = m[3]!;
  const lower = tail.toLowerCase();
  // Precision: only a real death verb is a death — a bare (DEAD) marker (a corpse re-listed in the
  // next PlayerList snapshot) is NOT. This kills the delayed-DEAD-reappearance duplicate at the source.
  if (!DEATH_VERB_RE.test(lower)) return null;
  const killedBy = lower.includes("killed by");
  const named = killedBy ? namedKiller(tail) : { entity: null, cause: null };
  const cause: DeathCause =
    lower.includes("bled out") ? "bled_out" :
    lower.includes("drowned") ? "drowned" :
    lower.includes("committed suicide") ? "suicide" :
    killedBy ? (named.cause ?? "environment") :
    lower.includes("died") ? "died" : "unknown";

  const s = STATS_RE.exec(tail);
  const water = s ? parseFloat(s[1]!) : null;
  const energy = s ? parseFloat(s[2]!) : null;
  const bleedSources = s ? parseInt(s[3]!, 10) : null;

  return { victim: m[1]!, dayzId: m[2]!, cause, killer: null, weapon: null, distance: null,
    energy, water, bleedSources, deathEntity: named.entity };
}
