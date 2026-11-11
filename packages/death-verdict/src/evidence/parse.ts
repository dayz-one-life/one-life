/**
 * The evidence parser: one line of an `.ADM` log to everything the classifier reads from it.
 *
 * This is a port of the reference pipeline's line parser (`kind_of`, `parse_killer`, `hit_source`,
 * `parse_hit` and the `Hit` categories). The patterns are the reference's, character for
 * character, so a verdict can be compared with the reference's by string equality.
 *
 * ⚠️ It is separate from `@onelife/adm-parser`'s `parseLine` on purpose. It emits no events, has
 * no `subIndex` contract and is never folded: it only reads. Do not "share" a pattern between the
 * two — the event parser's patterns are frozen by the event log, these by the reference.
 *
 * ⚠️ Players are matched by the 40-hex id on the line, never by gamertag.
 */

export type EvidenceKind =
  | "playerlist" | "hit" | "killed" | "died" | "drowned" | "drowned_uncon" | "bled_out"
  | "suicide" | "respawn" | "disc_uncon" | "disc_restrained" | "connected" | "connecting" | "disconnected"
  | "unconscious" | "regained" | "placed" | "emote" | "teleported" | "other" | "structural" | "nontime";

/** `<x, z (northing), altitude>` — the order the log prints. Distances on the ground use the first two. */
export type Pos = [number, number, number];

/** What a hit line says did the damage, as the reference labels it. */
export type HitLabel =
  | "player" | "explosion" | "fall" | "vehicle_no_driver" | "vehicle" | "fire" | "barbed_wire" | "enviro"
  | "heat" | "object" | "infected" | "trap" | "animal" | "creature_or_weapon" | "unparsed";

/** The label seen from the victim's side: a hit by the victim's own id is `self`, a named driver is
 *  `vehicle_driver`, a weapon with no player block is `ownerless_weapon`. */
export type HitCategory =
  | "self" | "vehicle_driver" | "player" | "infected" | "animal" | "vehicle" | "vehicle_no_driver"
  | "ownerless_weapon" | "explosion" | "fall" | "fire" | "barbed_wire" | "enviro" | "heat" | "object" | "trap"
  | "unparsed";

export interface HitInfo {
  /** The `[HP: n]` reading AFTER the hit. Every hit line carries one, including 0-damage lines. */
  hp: number | null;
  /** The printed `for n damage`, when the line prints one. */
  damage: number | null;
  /** False for the lines that only report HP (`Dummy_*`, `TripWireHit`) and for 0 damage. */
  damaging: boolean;
  label: HitLabel;
  category: HitCategory;
  /** The class or creature named as the source (`Infected`, `TripwireTrap`, a vehicle class). */
  source: string | null;
  /** The ammo / damage type in brackets (`MeleeFist`, `M67Grenade_Ammo`, `FallDamageHealth`). */
  ammo: string | null;
  /** The body zone a creature or weapon hit (`Torso`, `LeftArm`). */
  zone: string | null;
  attacker: { id: string; name: string; dead: boolean } | null;
  /** A named attacker's weapon; `vehicle:<class>` when the attacker is in a driver's seat. */
  weapon: string | null;
  distance: number | null;
}

export type KillerKind =
  | "player" | "vehicle_driver" | "player_unparsed" | "unnamed" | "vehicle_no_driver"
  | "infected" | "animal" | "vehicle" | "explosive" | "entity_other";

export interface KillerInfo {
  /** The four shapes of `killed by ...`. */
  form: "player" | "entity" | "empty" | "no_driver";
  /** The reference's finer kind, verbatim: the rules dispatch on it. */
  kind: KillerKind;
  /** Only for the empty-killer form (`killed by  with X`, two spaces). */
  subkind: "ownerless_firearm" | "fire" | "explosive_item" | "other" | null;
  /** Everything after `killed by `, trailing space removed. */
  raw: string;
  id: string | null;
  name: string | null;
  dead: boolean;
  pos: Pos | null;
  /** The kill line names the victim's own id as the killer. */
  self: boolean;
  /** The class named where a player would be (`ZmbM_...`, `LandMineTrap`); null for a player. */
  entity: string | null;
  /** The reference's `weapon`, verbatim: the weapon, the vehicle class, or the entity. */
  weapon: string | null;
  distance: number | null;
  /** The empty-killer firearm form prints the distance to the map origin, not a range. */
  distanceRaw: number | null;
  vehicleClass: string | null;
}

export interface EvidenceLine {
  admFileId: number;
  lineIndex: number;
  text: string;
  clock: { h: number; m: number; s: number } | null;
  kind: EvidenceKind;
  /**
   * The player the line is about (the first identity block).
   * ⚠️ `id` is the 40-hex id, or the literal `ERROR` the server prints for a player it has not
   * resolved yet. Such a line belongs to no life; use `isPlayerId` before grouping by id.
   */
  subject: { id: string; name: string; dead: boolean; pos: Pos | null } | null;
  /** The text after the subject's identity block; null when there is none. */
  tail: string | null;
  /** Every distinct 40-hex id on the line, in order. */
  ids: string[];
  /** Every readable `pos=<...>` on the line, in order. */
  positions: Pos[];
  hit?: HitInfo;
  killer?: KillerInfo;
  stats?: { water: number; energy: number; bleedSources: number };
  placed?: { display: string; className: string };
  emote?: { name: string; item: string | null };
}

const HEX = "[0-9A-F]{40}";
const WHO_RE = new RegExp(`^(\\d\\d):(\\d\\d):(\\d\\d) \\| Player "(.*?)" (\\(DEAD\\) )?\\(id=(${HEX}|ERROR)(?: pos=<([^>]*)>)?\\)`);
const WHO2_SRC = `Player "(.*?)" (\\(DEAD\\) )?\\(id=(${HEX}) pos=<([^>]*)>\\)`;
const WHO2_START_RE = new RegExp(`^${WHO2_SRC}`);
const TIME_RE = /^(\d\d):(\d\d):(\d\d) \| /;
const HP_RE = /^\[HP: (-?[\d.e+-]+)\] hit by (.*)$/;
const STATS_RE = /^ (died|drowned)\. Stats> Water: (-?[\d.e+-]+) Energy: (-?[\d.e+-]+) Bleed sources: (\d+)/;
const DMG_RE = / for (-?[\d.e+-]+) damage/;
const PLACED_RE = /^ placed (.+?)<(\w+)>$/;
const ZONE_RE = / into (\w*)\(-?\d+\)/;
const EMOTE_RE = /^ performed (\w+)(?: with (.+?))?\s*$/;
const EXPLOSIVE_WORDS = /grenade|claymore|landmine|land mine|plastic[ _]explosive|improvised|fuelstation|explosive|firework|gascanister/i;
const VEHICLE_WORDS = /^(CivilianSedan|Sedan_02|Truck_|Offroad|Hatchback|Motorbike|Boat)/i;
const WITH_RE = /^ with (.+?)(?: from (-?[\d.e+-]+) meters)? ?$/;
const FLOAT_RE = /^\s*[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?\s*$/i;

export const isPlayerId = (id: string | null | undefined): id is string => id != null && id.length === 40;

/** A float as the reference reads one: anything that is not a plain number is "no reading". */
function num(s: string | undefined | null): number | null {
  if (s == null || !FLOAT_RE.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** `x, z, altitude`. The server prints a huge sentinel for a player it cannot place; that is
 *  rejected. Off-map but finite positions are kept. */
export function parsePos(s: string | undefined | null): Pos | null {
  if (s == null) return null;
  const parts = s.split(",");
  if (parts.length !== 3) return null;
  const a = parts.map((p) => num(p));
  if (a.some((v) => v == null || !(Math.abs(v) < 1e6))) return null;
  return a as Pos;
}

/** Distance on the ground. Altitude is ignored, as in the reference. */
export const dist2d = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!);

function kindOf(tail: string): EvidenceKind {
  if (tail === "") return "playerlist";
  if (tail.startsWith("[HP: ")) return "hit";
  if (tail.startsWith(" killed by ")) return "killed";
  if (tail.startsWith(" died. Stats>")) return "died";
  if (tail.startsWith(" drowned. Stats>")) return "drowned";
  if (tail === " has drowned while unconscious") return "drowned_uncon";
  if (tail === " bled out") return "bled_out";
  if (tail === " committed suicide") return "suicide";
  if (tail === " is choosing to respawn") return "respawn";
  // The reference has one kind for both; the tail says which.
  if (tail.startsWith(" is disconnecting while being ")) return tail.includes("restrained") ? "disc_restrained" : "disc_uncon";
  if (tail === " is connected") return "connected";
  if (tail === " is connecting") return "connecting";
  if (tail === " has been disconnected") return "disconnected";
  if (tail === " is unconscious") return "unconscious";
  if (tail === " regained consciousness") return "regained";
  if (tail.startsWith(" placed ")) return "placed";
  if (tail.startsWith(" performed ")) return "emote";
  if (tail.startsWith(" was teleported ")) return "teleported";
  return "other";
}

function parseKiller(tail: string, victimId: string): KillerInfo {
  const rest = tail.slice(" killed by ".length);
  const k: KillerInfo = {
    form: "entity", kind: "entity_other", subkind: null, raw: rest.trimEnd(), id: null, name: null, dead: false,
    pos: null, self: false, entity: null, weapon: null, distance: null, distanceRaw: null, vehicleClass: null,
  };
  const m = WHO2_START_RE.exec(rest);
  if (m) {
    k.form = "player";
    k.name = m[1]!; k.dead = Boolean(m[2]); k.id = m[3]!; k.pos = parsePos(m[4]);
    const r2 = rest.slice(m[0].length);
    const mm = WITH_RE.exec(r2);
    const mv = /^ \((\w+)\)\s*$/.exec(r2);
    if (mm) {
      k.kind = "player"; k.weapon = mm[1]!; k.distance = mm[2] ? num(mm[2]) : null;
    } else if (mv) {
      k.kind = "vehicle_driver"; k.weapon = mv[1]!; k.vehicleClass = mv[1]!;
    } else {
      k.kind = "player_unparsed";
    }
    k.self = m[3] === victimId;
    return k;
  }
  const mm = WITH_RE.exec(rest);
  if (mm) {
    // `killed by  with X`: two spaces, the killer prefix is empty. Three unrelated things print it.
    k.form = "empty"; k.kind = "unnamed"; k.weapon = mm[1]!;
    if (mm[2]) {
      k.subkind = "ownerless_firearm"; k.distanceRaw = num(mm[2]);
    } else if (mm[1]!.includes("Fireplace")) k.subkind = "fire";
    else if (EXPLOSIVE_WORDS.test(mm[1]!)) k.subkind = "explosive_item";
    else k.subkind = "other";
    return k;
  }
  const nd = /^NO DRIVER \((\w+)\)\s*$/.exec(rest);
  if (nd) {
    k.form = "no_driver"; k.kind = "vehicle_no_driver"; k.weapon = nd[1]!; k.vehicleClass = nd[1]!;
    return k;
  }
  const ent = rest.trim();
  k.weapon = ent; k.entity = ent;
  if (ent.startsWith("Zmb")) k.kind = "infected";
  else if (ent.startsWith("Animal_")) k.kind = "animal";
  else if (VEHICLE_WORDS.test(ent)) { k.kind = "vehicle"; k.vehicleClass = ent; }
  else if (EXPLOSIVE_WORDS.test(ent) || ent === "LandMineTrap" || ent === "Claymore" || ent === "ClaymoreMine") k.kind = "explosive";
  else k.kind = "entity_other";
  return k;
}

const OBJECT_AMMO: Record<string, HitLabel> = {
  TransportHit: "vehicle", FireDamage: "fire", BarbedWireHit: "barbed_wire", EnviroDmg: "enviro", HeatDamage: "heat",
};

type Source = Pick<HitInfo, "label" | "source" | "ammo" | "attacker" | "weapon" | "distance">;

function hitSource(rest: string): Source {
  const none = { source: null, ammo: null, attacker: null, weapon: null, distance: null };
  const m = WHO2_START_RE.exec(rest);
  if (m) {
    const attacker = { id: m[3]!, name: m[1]!, dead: Boolean(m[2]) };
    const r2 = rest.slice(m[0].length);
    // `hit by Player "X" (...) with TransportHit (<vehicle class>)`: the driver is named.
    const veh = /^ with (\w+) \((\w+)\)\s*$/.exec(r2);
    if (veh) return { ...none, label: "player", attacker, weapon: `vehicle:${veh[2]!}`, ammo: veh[1]! };
    const mw = /\(([^)]*)\)(?: with (.+?)(?: from (-?[\d.e+-]+) meters)?)? ?$/.exec(r2);
    return {
      ...none, label: "player", attacker,
      ammo: mw ? mw[1]! : null, weapon: mw && mw[2] ? mw[2] : null, distance: mw && mw[3] ? num(mw[3]) : null,
    };
  }
  if (rest.startsWith("explosion (")) return { ...none, label: "explosion", ammo: rest.slice("explosion (".length).replace(/[) ]+$/, "") };
  if (rest.startsWith("FallDamage")) return { ...none, label: "fall", ammo: rest.trim() };
  const nd = /^NO DRIVER with (\w+) \((\w+)\)/.exec(rest);
  if (nd) return { ...none, label: "vehicle_no_driver", source: nd[2]!, ammo: nd[1]! };
  const obj = /^(\w+) with (\w+)\s*$/.exec(rest);
  if (obj) return { ...none, label: OBJECT_AMMO[obj[2]!] ?? "object", source: obj[1]!, ammo: obj[2]! };
  const into = /^(.+?) into \w*\(-?\d+\) for (-?[\d.e+-]+) damage \(([^)]*)\)/.exec(rest);
  if (into) {
    const src = into[1]!;
    const label: HitLabel =
      src === "Infected" ? "infected"
      : src === "TripwireTrap" || src === "BearTrap" || src === "LandMineTrap" ? "trap"
      : src === "Wolf" || src === "Brown Bear" || src === "Doberman" || src === "German Shepherd" || src.includes("Bear") ? "animal"
      : "creature_or_weapon";   // e.g. `hit by M16A2 into ...` with no player block
    return { ...none, label, source: src, ammo: into[3]! };
  }
  return { ...none, label: "unparsed", source: rest.slice(0, 60) };
}

function categoryOf(s: Source, victimId: string): HitCategory {
  if (s.label === "player") {
    if (s.attacker!.id === victimId) return "self";
    return (s.weapon ?? "").startsWith("vehicle:") ? "vehicle_driver" : "player";
  }
  if (s.label === "creature_or_weapon") return "ownerless_weapon";
  return s.label;
}

function parseHit(tail: string, text: string, victimId: string): HitInfo | undefined {
  const m = HP_RE.exec(tail);
  if (!m) return undefined;
  const s = hitSource(m[2]!);
  const dm = DMG_RE.exec(m[2]!);
  const damage = dm ? num(dm[1]) : null;
  const ammo = s.ammo ?? "";
  // ⚠️ `Dummy_Light` and `TripWireHit` lines report HP and take none: they are readings, not damage.
  const damaging = !ammo.startsWith("Dummy_") && !ammo.startsWith("TripWireHit") && (damage == null || damage > 0);
  return { hp: num(m[1]), damage, damaging, ...s, category: categoryOf(s, victimId), zone: ZONE_RE.exec(text)?.[1] ?? null };
}

/** Parses one line. Never throws: a line it cannot read is `structural`, `nontime` or `other`. */
export function parseEvidenceLine(admFileId: number, lineIndex: number, text: string): EvidenceLine {
  const line: EvidenceLine = {
    admFileId, lineIndex, text, clock: null, kind: "nontime", subject: null, tail: null, ids: [], positions: [],
  };
  const t = TIME_RE.exec(text);
  if (!t) return line;
  line.clock = { h: Number(t[1]), m: Number(t[2]), s: Number(t[3]) };
  const w = WHO_RE.exec(text);
  if (!w) { line.kind = "structural"; return line; }
  const id = w[6]!;
  const tail = text.slice(w[0].length);
  line.subject = { id, name: w[4]!, dead: Boolean(w[5]), pos: parsePos(w[7]) };
  line.tail = tail;
  line.kind = kindOf(tail);
  line.ids = [...new Set([...text.matchAll(new RegExp(`id=(${HEX})`, "g"))].map((x) => x[1]!))];
  line.positions = [...text.matchAll(/pos=<([^>]*)>/g)].map((x) => parsePos(x[1])).filter((p): p is Pos => p != null);
  if (line.kind === "hit") {
    const hit = parseHit(tail, text, id);
    if (hit) line.hit = hit;
  } else if (line.kind === "killed") {
    line.killer = parseKiller(tail, id);
  } else if (line.kind === "died" || line.kind === "drowned") {
    const s = STATS_RE.exec(tail);
    if (s) {
      const water = num(s[2]), energy = num(s[3]);
      if (water != null && energy != null) line.stats = { water, energy, bleedSources: Number(s[4]) };
    }
  } else if (line.kind === "placed") {
    const p = PLACED_RE.exec(tail);
    if (p) line.placed = { display: p[1]!, className: p[2]! };
  } else if (line.kind === "emote") {
    const e = EMOTE_RE.exec(tail);
    if (e) line.emote = { name: e[1]!, item: e[2] ?? null };
  }
  return line;
}

/** Every identity block on a line: `(name, dead, id, pos)`. Used to ask who was near a spot. */
export function identityBlocks(text: string): { name: string; dead: boolean; id: string; pos: Pos | null }[] {
  return [...text.matchAll(new RegExp(WHO2_SRC, "g"))].map((m) => ({ name: m[1]!, dead: Boolean(m[2]), id: m[3]!, pos: parsePos(m[4]) }));
}

/**
 * The alive-form `is choosing to respawn` is a death marker (the player gave up while knocked
 * out). ⚠️ The `(DEAD)` form is not: it is a corpse's owner pressing respawn after dying of
 * something else, and it never starts, ends or belongs to a death.
 */
export const isRespawnMarker = (line: EvidenceLine): boolean => line.kind === "respawn" && line.subject != null && !line.subject.dead;

export type TrapClass = "TripwireTrap" | "LandMineTrap";

/**
 * True for a line that records a device of this class going off. A tripwire writes `TripWireHit`
 * on whoever walked into it. A mine writes one `hit by explosion` line per player caught.
 * ⚠️ The mine's ammo is spelt `LandMineExplosion` in old logs and `LandMineExplosion_Ammo` in
 * current ones; both count.
 */
export function isDetonation(line: EvidenceLine, cls: TrapClass): boolean {
  if (line.kind !== "hit" || !line.hit) return false;
  if (cls === "TripwireTrap") return line.hit.ammo === "TripWireHit";
  return line.hit.label === "explosion" && (line.hit.ammo ?? "").startsWith("LandMineExplosion");
}
