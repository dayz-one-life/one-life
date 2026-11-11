import { Hit, type DeathContext } from "../context/build.js";
import { lowerBound, type StampedLine } from "../context/server.js";
import { dist2d, identityBlocks, type KillerInfo, type Pos } from "../evidence/parse.js";
import type { AttributionBasis } from "../types.js";
import { AMMO_NAME, CLAY, CREATURE, FRAG, FRAG_ITEMS, LIFETIME_H, PLAS } from "./tables.js";
import { att, contributor, f0, f1, lineRef, out, type Draft } from "./verdict.js";

/**
 * The rules for a death whose primary line is `killed by ...` (A01 to A17). A port of the
 * reference's `classify_killed`, in its order: the first rule that matches answers.
 *
 * ⚠️ Every rule sets the attribution's `basis` itself. Only three values put a name on a page:
 * `kill_line` (A03, A04, A05), `kill_line_driver` (A01) and `kill_line_self` (A02). `placement`
 * (the trap owner of A06, A07, A09) can become a trap kill, and only through the credit bar
 * (`credit.ts`). Everything else is `not_stated` — every inferred person, and every owner of a
 * device outside the three (A06b, A08, A10, A12, A13, A14).
 */

/** Players who damaged the living victim within `window` seconds. Context, never a kill credit. */
export function recentPlayerContrib(c: DeathContext, window: number, refTs: number = c.t0): Hit[] {
  return c.dmg.filter((h) => (h.cat === "player" || h.cat === "vehicle_driver") && refTs - h.ts >= 0 && refTs - h.ts <= window);
}

const pos = (o: StampedLine): Pos | null => o.subject!.pos;
const names = (xs: Iterable<string>): string => [...new Set(xs)].sort().join(", ");
const endsWithFrag = (s: string): boolean => FRAG_ITEMS.some((f) => s.trimEnd().endsWith(f));

/**
 * Who placed the device nearest a spot. A reading of proximity: the log never says which device
 * fired or who armed it. `strong` when one player has every placement in range, else `inferred`.
 * `basis` is what the attribution carries when the placer is not the victim.
 */
export function trapOwner(c: DeathContext, anchor: Pos, classes: ReadonlySet<string>, radius: number, basis: AttributionBasis,
  maxAgeS: number | null = null): { a: Draft["attribution"]; lines: StampedLine[]; notes: string[] } {
  const cands = c.server.placedNear(anchor, classes, radius, c.firstSeq, maxAgeS, c.t0);
  if (cands.length === 0) return { a: null, lines: [], notes: [] };
  const { dist, line: po, className } = cands[0]!;
  const placers = new Set(cands.map((x) => x.line.subject!.id));
  const ageH = (c.t0 - po.ts) / 3600;
  const self = po.subject!.id === c.pid;
  const a = self
    ? att(c.victimName, c.pid, "self (own device)", "not_stated", placers.size === 1 ? "strong" : "inferred")
    : att(po.subject!.name, po.subject!.id, "trap_owner", basis, placers.size === 1 ? "strong" : "inferred");
  const notes = [placers.size === 1
    ? `only one player has \`placed ${className}\` lines within ${radius} m (${cands.length} line(s)); nearest ${f1(dist)} m away, ${f1(ageH)} h earlier (${lineRef(po)}). Proximity: the log never says which device fired or who armed it`
    : `nearest of ${placers.size} placers of ${className} within ${radius} m: ${f1(dist)} m away, ${f1(ageH)} h earlier (${lineRef(po)})`];
  const lt = LIFETIME_H[className];
  if (lt && ageH > lt) {
    notes.push(`age caveat: the placement is ${f0(ageH)} h old, past the ${lt} h lifetime types.xml gives ${className}. Devices in the logs fire past it, so the attribution stands, but an unlogged later device at the same spot cannot be excluded`);
  }
  return { a, lines: [po], notes };
}

/** The ammo classes among some explosion hits: how many classes, and "2 x M67 frag + 1 x 40mm round". */
export function ammoMix(hs: readonly Hit[]): { classes: number; text: string } {
  const cnt = new Map<string, number>();
  for (const h of hs) cnt.set(h.det.ammo ?? "", (cnt.get(h.det.ammo ?? "") ?? 0) + 1);
  const byCount = [...cnt].sort((a, b) => b[1] - a[1]);
  return { classes: cnt.size, text: byCount.map(([a, n]) => `${n} x ${AMMO_NAME[a] ?? a}`).join(" + ") };
}

/**
 * The dead-man grenade: the victim's own kill line on another player up to `maxS` seconds before
 * a blast and within `maxM` metres of it. Beyond one second and three metres the same blast must
 * also have hit that fresh corpse within three metres of where it died.
 */
export function deadMan(c: DeathContext, tBlast: number, at: Pos | null, beforeSeq: number, maxS = 6, maxM = 8):
  { line: StampedLine; dt: number; dist: number; corpseHit: boolean } | null {
  if (!at) return null;
  const S = c.server;
  const key = `killed by Player "${c.victimName}" (id=${c.pid}`;
  const cands = S.window(tBlast - maxS, tBlast).filter((x) => x.kind === "killed" && x.subject!.id !== c.pid && x.seq < beforeSeq
    && x.text.replaceAll("(DEAD) ", "").includes(key) && pos(x) != null && dist2d(pos(x)!, at) <= maxM);
  const blast = S.window(tBlast - 1, tBlast + 1).filter((y) => y.kind === "hit" && y.subject!.dead && y.text.includes("hit by explosion") && pos(y) != null);
  for (let i = cands.length - 1; i >= 0; i--) {
    const x = cands[i]!;
    const dt = tBlast - x.ts, d = dist2d(pos(x)!, at);
    const corpseHit = blast.some((y) => y.subject!.id === x.subject!.id && y.seq > x.seq && dist2d(pos(y)!, pos(x)!) <= 3);
    if ((dt <= 1 && d <= 3) || corpseHit) return { line: x, dt, dist: d, corpseHit };
  }
  return null;
}

/**
 * The victim logged with a frag grenade in hand in the last `secs` seconds: as the attacker on a
 * `hit by Player <victim> ... with <frag>` line, or on an own `performed Emote... with <frag>` line.
 */
export function heldFrag(c: DeathContext, secs = 60): StampedLine | null {
  const S = c.server;
  const seqs = S.any.get(c.pid) ?? [];
  const key = `hit by Player "${c.victimName}"`;
  let best: StampedLine | null = null;
  for (let i = lowerBound(seqs, Math.max(0, c.firstSeq - 4000)); i < seqs.length; i++) {
    if (seqs[i]! >= c.firstSeq) break;
    const o = S.lines[seqs[i]!]!;
    if (c.t0 - o.ts > secs) continue;
    if (o.kind === "hit" && o.subject?.id !== c.pid && o.text.includes(key) && endsWithFrag(o.text)) best = o;
    else if (o.kind === "emote" && o.subject?.id === c.pid && !o.subject.dead && endsWithFrag(o.tail ?? "")) best = o;
  }
  return best;
}

/** What every A rule starts from. */
interface Killed {
  c: DeathContext;
  k: KillerInfo;
  /** The kill line, and the line directly above it. */
  kl: StampedLine;
  above: StampedLine | null;
  /** The line above when it is the HP-0 hit on this body. */
  fatalAbove: Hit | null;
  /** The fatal hits that are explosions. */
  expl0: Hit[];
  flags: string[];
}

// ---- A01: a player in a driver's seat on the kill line
function ruleDriver({ c, k, kl, above, flags }: Killed): Draft {
  const burst = c.hits.filter((h) => h.cat === "vehicle_driver" && c.t0 - h.ts <= 5);
  return out("A01", "vehicle_run_over", "definitive", {
    weapon: k.weapon, className: k.vehicleClass,
    attributed: att(k.name!, k.id!, "driver", "kill_line_driver", "definitive"),
    evidence: [...burst.slice(0, 1), above, kl], flags,
  });
}

// ---- A02: the kill line names the victim as the killer
function ruleSelf({ c, k, kl, above, expl0, flags }: Killed, fistExpl: boolean): Draft {
  const self = att(c.victimName, c.pid, "self", "kill_line_self", "definitive");
  const selfFlags = [...flags, "self_kill"];
  if (k.weapon === "M79") {
    return out("A02", "self_inflicted_explosive", "definitive", {
      weapon: "M79 (40mm explosive round)", attributed: self, evidence: [...expl0.slice(0, 1), kl], flags: selfFlags,
    });
  }
  if (fistExpl) {
    // The fists label on an explosion death: the grenade went off in their hands.
    return out("A02", "self_inflicted_explosive", "definitive", {
      weapon: expl0[0]!.det.ammo, attributed: self, evidence: [...expl0.slice(0, 1), kl], flags: selfFlags,
    });
  }
  return out("A02", "self_inflicted", "definitive", { weapon: k.weapon, attributed: self, evidence: [above, kl], flags: selfFlags });
}

// ---- A03: fists on the kill line, an explosion as the fatal hit, no fatal punch
function ruleHeldGrenade({ k, kl, expl0, flags }: Killed): Draft {
  return out("A03", "explosive_held_grenade", "strong", {
    weapon: expl0[0]!.det.ammo,
    attributed: att(k.name!, k.id!, "grenade_holder", "kill_line", "definitive"),
    evidence: [...expl0.slice(0, 1), kl], flags,
  });
}

// ---- A04: the kill line names another player
function rulePvp({ c, k, kl, fatalAbove, flags }: Killed): Draft {
  const w = k.weapon;
  const fa = fatalAbove && fatalAbove.pid === k.id ? fatalAbove : null;
  const ammo = fa?.det.ammo ?? "";
  const zone = fa ? fa.det.zone : null;
  const dist = k.distance;
  const wtype =
    w === "M79" ? "grenade launcher"
    : dist != null && ammo.startsWith("FirearmHit") ? "firearm used as club"
    : dist != null ? "firearm"
    : w === "(MeleeFist)" ? "fists"
    : ammo.startsWith("MeleeFist") ? "fists holding item"
    : "melee weapon";
  const fl = [...flags];
  if (zone === "Head" || zone === "Brain") fl.push("headshot");
  if (c.alive.some((o) => o.kind === "emote" && o.tail!.includes("EmoteSuicide") && c.t0 - o.ts <= 15)) fl.push("suicide_emote_interrupted");
  const others = c.playersIn(recentPlayerContrib(c, 120).filter((h) => h.pid !== k.id));
  const contributors = [...others].map(([id, name]) => contributor(name, id, "assist", "inferred"));
  if (contributors.length) fl.push("assist_other_player_hits");
  return out("A04", "pvp", "definitive", {
    weapon: w, attributed: att(k.name!, k.id!, "killer", "kill_line", "definitive"), contributors,
    evidence: [fa, kl], flags: [...fl, `pvp_${wtype.replaceAll(" ", "_")}`],
  });
}

// ---- A11: a fuel-station pump
function ruleFuelPump({ c, kl, expl0, flags }: Killed, raw: string): Draft {
  const blasts = c.hits.filter((h) => h.cat === "explosion" && h.det.ammo === "LandFuelFeed_Ammo" && c.t0 - h.ts <= 300);
  const notes: string[] = [];
  if (c.pos && c.server.othersNear(c.pid, c.pos, c.t0 - 120, c.t0 + 2, 150).size === 0) {
    notes.push("no other player was logged within 150 m in the last 120 s, so the victim probably broke the pump (who destroyed it is never logged)");
  }
  return out("A11", "fuel_explosion", "definitive", {
    weapon: raw, className: raw, evidence: [...blasts.slice(-2), ...expl0.slice(0, 1), kl], flags, notes,
  });
}

// ---- A05: an explosive on the kill line, no explosion at all, and a fatal punch with that item
function ruleClubbedWithExplosive({ c, kl, flags }: Killed, raw: string, meleeFatal: Hit[]): Draft {
  const h = meleeFatal[meleeFatal.length - 1]!;
  // ⚠️ The killer is read from the HP-0 hit line: this kill line drops the player and names only
  // the item in their hands. It is still a kill line, so the basis is `kill_line`.
  return out("A05", "pvp", "definitive", {
    weapon: `fists holding ${raw}`,
    attributed: att(h.det.attacker!.name, h.pid!, "killer", "kill_line", "definitive"),
    evidence: [h, kl], flags: [...flags, "pvp_fists_holding_item", "kill_line_drops_killer"],
  });
}

// ---- A06 / A06b: a claymore, with or without the victim's own TripWireHit
function ruleClaymore({ c, kl, expl0, flags }: Killed, trips: Hit[]): Draft {
  const tw = trips.filter((h) => c.t0 - h.ts <= 1);
  if (tw.length === 0) {
    return out("A06b", "explosive_claymore", "definitive", { weapon: "Claymore", className: "ClaymoreMine", evidence: [...expl0.slice(0, 1), kl], flags });
  }
  const trip = tw[tw.length - 1]!;
  const anchor = pos(trip.o) ?? c.pos;
  const owner = anchor ? trapOwner(c, anchor, new Set(["TripwireTrap"]), 5, "placement") : { a: null, lines: [], notes: [] };
  if (owner.a && anchor) {
    const same = c.server.placedNear(anchor, new Set(["ClaymoreMine"]), 10, c.firstSeq).find((x) => x.line.subject!.id === owner.a!.dayzId);
    if (same) {
      owner.notes.push(`the same player placed a Claymore ${f1(same.dist)} m away (${lineRef(same.line)})`);
      owner.lines.push(same.line);
    }
  }
  if (!owner.a) owner.notes.push("no tripwire placement line within 5 m; owner unknown");
  return out("A06", "explosive_trap", "definitive", {
    weapon: "Tripwire + Claymore", className: "TripwireTrap", attributed: owner.a,
    evidence: [trip, ...expl0.slice(0, 1), kl, ...owner.lines], flags, notes: owner.notes,
  });
}

// ---- A07: a frag grenade 3 to 5 s after the victim's own TripWireHit (the fuse is 4 s)
function ruleFragTrap({ c, kl, expl0, flags }: Killed, gname: string, tw: Hit[]): Draft {
  const trip = tw[tw.length - 1]!;
  const anchor = pos(trip.o) ?? c.pos;
  const owner = anchor ? trapOwner(c, anchor, new Set(["TripwireTrap"]), 5, "placement") : { a: null, lines: [], notes: [] };
  if (!owner.a) owner.notes.push("no tripwire placement line within 5 m; owner unknown");
  return out("A07", "explosive_trap", c.t0 - trip.ts === 4 ? "definitive" : "strong", {
    weapon: `Tripwire + ${gname}`, className: "TripwireTrap", attributed: owner.a,
    evidence: [trip, ...expl0.slice(0, 1), kl, ...owner.lines], flags: [...flags, "fuse_4s"], notes: owner.notes,
  });
}

// ---- A08: any other frag kill. The thrower is never logged; the sub-rules are leads only.
function ruleFrag({ c, k, kl, expl0, flags }: Killed, raw: string, gname: string): Draft {
  const S = c.server;
  const notes: string[] = [], tags: string[] = [];
  let a: Draft["attribution"] = null;
  // Blasts on THIS body only: older corpses of the same player are not counted.
  const { mine: body, otherBodies } = c.bodyBlasts();
  const nBody = Math.max(expl0.length, body.length);
  const multi = nBody >= 2 || c.nKillLines > 1;
  const mix = ammoMix(body);
  if (multi) tags.push(`multi_grenade_x${nBody}`);
  if (otherBodies) notes.push(`${otherBodies} more blast line(s) of that second are on older corpses of the same player (earlier deaths at this spot) and are not counted`);
  const near50 = c.pos ? S.othersNear(c.pid, c.pos, c.t0 - 60, c.t0 + 2, 50, { livingAt: { ts: c.t0, seq: c.firstSeq } }) : new Map<string, { name: string; dist: number }>();
  let near300 = new Map<string, { name: string; dist: number }>();
  if (near50.size) {
    tags.push("players_within_50m_60s");
    notes.push(`living players logged within 50 m in the last 60 s: ${[...near50.values()].slice(0, 5).map((v) => `${v.name} (${f0(v.dist)} m)`).join(", ")}`);
  } else if (c.pos) near300 = S.othersNear(c.pid, c.pos, c.t0 - 300, c.t0 + 300, 300, { aliveOnly: false });
  // victims of the same blast
  const co = S.window(c.t0 - 1, c.t0 + 1).filter((x) => x.kind === "killed" && x.subject!.id !== c.pid && pos(x) != null && c.pos != null
    && dist2d(pos(x)!, c.pos) <= 30 && Object.keys(FRAG).some((g) => x.tail!.includes(g)));
  if (co.length) {
    tags.push("co_killed");
    notes.push(`same blast also killed: ${names(co.map((x) => x.subject!.name))}`);
  }
  const conn = c.alive.filter((o) => o.kind === "connected");
  const sinceSpawn = conn.length === 1 && c.fresh ? c.t0 - conn[0]!.ts : null;
  if (c.lifeStart != null && c.t0 - c.lifeStart <= 30) tags.push(`spawned_${c.t0 - c.lifeStart}s_before`);
  const ptrip = c.pos ? S.placedNear(c.pos, new Set(["TripwireTrap"]), 10, c.firstSeq) : [];
  if (ptrip.length) {
    notes.push(`a tripwire was placed ${f1(ptrip[0]!.dist)} m away by ${ptrip[0]!.line.subject!.name} (${lineRef(ptrip[0]!.line)}) but the victim has no TripWireHit; a wire tripped by an infected or an animal writes no line`);
    tags.push("tripwire_placed_within_10m_no_trip_line");
  }
  const contributors = [...c.playersIn(recentPlayerContrib(c, 120))].map(([id, name]) => contributor(name, id, "assist", "inferred"));
  let pev: StampedLine[] = [];
  // An improvised explosive placed nearby in the last hour: its grenade payload logs as ordinary
  // grenade hits and the kill line names the grenade.
  const ied = c.pos ? S.placedNear(c.pos, new Set(["ImprovisedExplosive"]), 25, c.firstSeq, 3600, c.t0) : [];
  const hf = heldFrag(c);
  const dmn = deadMan(c, c.t0, c.pos, kl.seq);
  const priorDmg = c.dmg.filter((h) => c.t0 - h.ts > 1);
  if (ied.length) {
    const recent = ied.reduce((m, x) => (x.line.seq > m.line.seq ? x : m));
    const po = recent.line;
    const self = po.subject!.id === c.pid;
    tags.push("improvised_explosive_within_25m_1h");
    if (self) tags.push("own_improvised_explosive");
    a = att(self ? c.victimName : po.subject!.name, po.subject!.id, self ? "self (own device)" : "device_owner (inferred)", "not_stated", "inferred");
    const others = names(ied.filter((x) => x.line.subject!.id !== po.subject!.id).map((x) => x.line.subject!.name));
    notes.push(`probably the payload of an improvised explosive, not a thrown grenade: most recent \`placed Improvised Explosive\` within 25 m and 1 h is ${f1(recent.dist)} m away, ${c.t0 - po.ts} s earlier (${lineRef(po)})${others ? `; other placers there in the last hour: ${others}` : ""}. Who triggered it is not logged`);
    pev = [po];
    const post = S.window(c.t0, c.t0 + 5).filter((x) => x.kind === "hit" && x.subject!.id === po.subject!.id && x.subject!.id !== c.pid && x.text.includes("hit by explosion"));
    if (post.length) {
      notes.push(`the placer ${po.subject!.name} was hit by ${post.length} more blast(s) within 5 s (${lineRef(post[0]!)})`);
      pev.push(post[0]!);
    }
  } else if (hf) {
    a = att(c.victimName, c.pid, "self (own held grenade)", "not_stated", "inferred");
    notes.push(`the victim is logged with a frag grenade in hand ${c.t0 - hf.ts} s before the blast (${lineRef(hf)}); the log never says a grenade was primed or thrown`);
    tags.push("held_frag_before_blast");
    pev = [hf];
  } else if (dmn) {
    const x = dmn.line;
    const third = [...S.othersNear(c.pid, pos(x)!, c.t0 - 10, c.t0, 10, { livingAt: { ts: c.t0, seq: c.firstSeq } })].filter(([id]) => id !== x.subject!.id);
    a = att(x.subject!.name, x.subject!.id, "grenade_holder (inferred)", "not_stated", "inferred");
    notes.push(`the victim killed ${x.subject!.name} ${f1(dmn.dist)} m away ${dmn.dt} s before the blast (${lineRef(x)})${dmn.corpseHit ? " and the same blast hit that fresh corpse" : ""}: a live grenade dropped by the dying player is the likeliest source`
      + (third.length ? `. Weak: ${third.map(([, v]) => `${v.name} (${f0(v.dist)} m)`).join(", ")} was alive within 10 m in the 10 s before and could have thrown it` : ""));
    tags.push("dead_man_grenade");
    if (third.length) tags.push("dead_man_weak_third_player_near");
    pev = [x];
  } else if (sinceSpawn != null && sinceSpawn <= 30 && priorDmg.length === 0 && near50.size === 0) {
    // A frag seconds after respawning, no damage in the life, nobody near: probably their own.
    a = att(c.victimName, c.pid, "self (spawn reset)", "not_stated", "inferred");
    notes.push(`died to a frag ${sinceSpawn} s after respawning, with no damage in that life and no living player logged within 50 m in the last 60 s; an unlogged thrower cannot be excluded`);
    tags.push("fresh_spawn_self_grenade");
    pev = conn.slice(-1);
  } else if (near50.size === 0 && near300.size === 0 && c.pos) {
    tags.push("isolated_300m_300s");
    a = att(c.victimName, c.pid, "self (probable)", "not_stated", "inferred");
    notes.push("no other player logged within 300 m in the 5 min either side; own grenade is the likeliest source");
  }
  if (multi && ied.length === 0 && !dmn) {
    notes.push(`several blasts on this body in one second (${mix.text || `${nBody} blast lines`}${c.nKillLines > 1 ? `, ${c.nKillLines} kill lines` : ""}): not one thrown grenade but a stash, a set charge, a device payload or a volley`);
    if (mix.classes > 1) tags.push("mixed_ammo_same_second");
  }
  return out("A08", "explosive_grenade", "definitive", {
    weapon: gname, className: k.entity ?? raw, attributed: a, contributors,
    evidence: [...expl0.slice(0, 1), kl, ...pev], flags: [...flags, ...tags], notes,
  });
}

// ---- A09: a land mine
function ruleLandMine({ c, kl, expl0, flags }: Killed): Draft {
  const owner = c.pos ? trapOwner(c, c.pos, new Set(["LandMineTrap"]), 5, "placement") : { a: null, lines: [], notes: [] };
  if (!owner.a) owner.notes.push("no mine placement line within 5 m; owner unknown");
  return out("A09", "landmine", "definitive", {
    weapon: "Land mine", className: "LandMineTrap", attributed: owner.a,
    evidence: [...expl0.slice(0, 1), kl, ...owner.lines], flags, notes: owner.notes,
  });
}

// ---- A10: a plastic-explosive charge
function ruleCharge({ c, kl, expl0, flags }: Killed, raw: string): Draft {
  // ⚠️ Not in scope for a trap kill: a raid charge, searched 25 m and one hour. Basis `not_stated`.
  const owner = c.pos ? trapOwner(c, c.pos, new Set(["ImprovisedExplosive", "Plastic_Explosive"]), 25, "not_stated", 3600) : { a: null, lines: [], notes: [] };
  if (!owner.a) owner.notes.push("no placement within 25 m and 1 h; owner unknown");
  return out("A10", "explosive_charge", "definitive", {
    weapon: "Plastic explosive", className: raw, attributed: owner.a,
    evidence: [...expl0.slice(0, 1), kl, ...owner.lines], flags, notes: owner.notes,
  });
}

// ---- A12: an empty killer `with 40mm Explosive Grenade`: the round went off as an item
function rule40mm({ c, kl, expl0, flags }: Killed): Draft {
  const S = c.server;
  const ied = c.pos ? S.placedNear(c.pos, new Set(["ImprovisedExplosive"]), 25, c.firstSeq, 3600, c.t0) : [];
  const ied24 = c.pos ? S.placedNear(c.pos, new Set(["ImprovisedExplosive"]), 25, c.firstSeq, 86400, c.t0) : [];
  const ownIed = ied.filter((x) => x.line.subject!.id === c.pid);
  const { mine: ex1, otherBodies } = c.bodyBlasts();
  const mix = ammoMix(ex1);
  let a: Draft["attribution"] = null;
  let pev: StampedLine[] = [];
  const notes: string[] = [], tags: string[] = [];
  if (otherBodies) notes.push(`${otherBodies} more blast line(s) of that second are on older corpses of the same player and are not counted`);
  if (ownIed.length) {
    const { dist, line: po } = ownIed[0]!;
    a = att(c.victimName, c.pid, "self (own device)", "not_stated", "strong");
    notes.push(`the victim placed an Improvised Explosive ${f1(dist)} m away, ${c.t0 - po.ts} s earlier (${lineRef(po)})`);
    pev = [po];
    tags.push("own_improvised_explosive");
  } else if (ex1.length >= 2 && mix.classes > 1) {
    // Different ammo classes in one second: a mixed payload, not several 40mm rounds.
    tags.push("multi_explosion_same_second", "mixed_ammo_same_second");
    notes.push(`${mix.text} on the victim in one second: a mixed payload or a stash`);
  } else if (ex1.length >= 2) {
    // One hit line is written per round: two or more in the death second are several rounds.
    tags.push("multi_explosion_same_second");
  } else tags.push("single_round");
  const pc = recentPlayerContrib(c, 2);
  if (pc.length) {
    notes.push(`shot by ${names(c.playersIn(pc).values())} in the same second; a round in the victim's gear destroyed by the bullet is one explanation`);
    tags.push("player_gunfire_same_second");
  }
  if (ied.length && ownIed.length === 0) notes.push(`improvised explosive placed within 25 m in the last hour by ${names(ied.map((x) => x.line.subject!.name))}`);
  const old = ied24.filter((x) => !ied.some((y) => y.line === x.line));
  if (old.length) {
    const ages = old.map((x) => (c.t0 - x.line.ts) / 3600), ds = old.map((x) => x.dist);
    const first = old[old.length - 1]!.line;
    notes.push(`${old.length} improvised explosive(s) were placed ${f0(Math.min(...ds))}-${f0(Math.max(...ds))} m away ${f1(Math.min(...ages))}-${f1(Math.max(...ages))} h earlier by ${names(old.map((x) => x.line.subject!.name))} (first ${lineRef(first)}); no single owner can be named`);
    tags.push("improvised_explosive_within_25m_24h");
  }
  // Nobody else logged within 300 m in the five minutes either side: the victim set it off.
  if (a == null && c.pos && pc.length === 0 && S.othersNear(c.pid, c.pos, c.t0 - 300, c.t0 + 300, 300, { aliveOnly: false }).size === 0) {
    tags.push("isolated_300m_300s");
    a = att(c.victimName, c.pid, "self (probable)", "not_stated", "inferred");
    notes.push(`no other player logged within 300 m in the 5 min either side; the victim is the only one who can have set the rounds off${ied24.length ? " (improvised explosives had been placed at this spot)" : ""}`);
  }
  return out("A12", "explosive_40mm", "definitive", {
    weapon: "40mm explosive round", attributed: a,
    contributors: [...c.playersIn(pc)].map(([id, name]) => contributor(name, id, "assist", "inferred")),
    evidence: [...expl0.slice(0, 1), kl, ...pev], flags: [...flags, ...tags], notes,
  });
}

// ---- A13: an empty killer `with Fireplace`
function ruleFire({ c, kl, flags }: Killed): Draft {
  const burns = c.hits.filter((h) => h.cat === "fire" && c.t0 - h.ts <= 300);
  const own = (c.pos ? c.server.placedNear(c.pos, new Set(["Fireplace"]), 5, c.firstSeq, 7 * 86400, c.t0) : []).filter((x) => x.line.subject!.id === c.pid);
  const notes: string[] = [];
  let a: Draft["attribution"] = null;
  if (own.length) {
    a = att(c.victimName, c.pid, "self (own fire)", "not_stated", "inferred");
    notes.push(`the victim placed a Fireplace ${f1(own[0]!.dist)} m away ${c.t0 - own[0]!.line.ts} s earlier (${lineRef(own[0]!.line)}); that it is the same fire is inferred`);
  }
  return out("A13", "fire", "definitive", {
    weapon: "Fireplace", attributed: a,
    evidence: [...burns.slice(0, 1), ...c.fatal.slice(0, 1), kl, ...own.slice(0, 1).map((x) => x.line)], flags, notes,
  });
}

// ---- A14: an empty killer `with <firearm> from N meters`: bullets whose owner had just been dropped
function ruleOwnerlessFirearm({ c, k, kl, flags }: Killed): Draft {
  const w = k.weapon!;
  // The shooter: someone seen using this weapon in the last 60 s who died or went down within
  // 6 s before the bullets landed.
  const cand = new Map<string, { name: string; used: StampedLine; down: StampedLine | null }>();
  const wl = c.server.window(c.t0 - 60, c.t0);
  for (const o of wl) {
    if ((o.kind !== "hit" && o.kind !== "killed") || !o.text.includes(` with ${w}`)) continue;
    const from = o.text.indexOf(" by Player");
    if (from < 0) continue;
    for (const b of identityBlocks(o.text.slice(from))) if (!cand.has(b.id)) cand.set(b.id, { name: b.name, used: o, down: null });
  }
  for (const o of wl) {
    const x = o.subject ? cand.get(o.subject.id) : undefined;
    if (!x || c.t0 - o.ts > 6) continue;
    if (o.kind === "killed" || o.kind === "died" || (o.kind === "unconscious" && !o.subject!.dead)) {
      if (x.down == null || o.kind === "killed") x.down = o;
    }
  }
  const shooters = [...cand].filter(([id, v]) => v.down != null && id !== c.pid);
  let a: Draft["attribution"] = null;
  let ev: StampedLine[] = [];
  const notes = ["the printed distance is the victim's distance to the map origin, not a range"];
  if (shooters.length === 1) {
    const [id, v] = shooters[0]!;
    // ⚠️ An inferred person: never a killer on a page.
    a = att(v.name, id, "killer (inferred)", "not_stated", "strong");
    notes.push(`only player seen using a ${w} in the last 60 s who died or went down within 6 s before the bullets landed (${lineRef(v.down!)}); the weapon had no owner when the rounds hit`);
    ev = [v.used, v.down!];
  }
  return out("A14", "pvp", a ? "strong" : "inferred", {
    weapon: w, attributed: a, evidence: [...ev, ...c.fatal.slice(0, 1), kl], flags: [...flags, "ownerless_firearm"], notes,
  });
}

// ---- A15: an infected or an animal
function ruleCreature({ c, k, kl, fatalAbove, flags }: Killed): Draft {
  const cls = k.weapon!;
  const cause =
    k.kind === "infected" ? "infected"
    : cls.startsWith("Animal_CanisLupus") ? "animal_wolf"
    : cls.startsWith("Animal_UrsusArctos") ? "animal_bear"
    : cls.startsWith("Animal_CanisFamiliaris") ? "animal_dog"
    : "animal_other";
  const fl = [...flags], notes: string[] = [];
  const pc = c.playersIn(recentPlayerContrib(c, 120));
  const contributors = [...pc].map(([id, name]) => {
    const hs = c.dmg.filter((h) => h.pid === id);
    const l = hs[hs.length - 1]!;
    notes.push(`${name} damaged the living victim ${c.t0 - l.ts} s before (HP ${f1(l.hp)} after); the creature is the stated killer`);
    return contributor(name, id, "assist", "inferred");
  });
  if (contributors.length) fl.push("player_damage_before_creature_kill");
  if (c.alive.slice(-40).some((o) => o.kind === "disconnected" && c.t0 - o.ts <= 20)) fl.push("killed_during_logout_timer");
  const fam = new Set(c.dmg.filter((h) => CREATURE.includes(h.cat) && c.t0 - h.ts <= 120).map((h) => h.name()));
  if (fam.size > 1) notes.push(`creature families that hit in the last 120 s: ${[...fam].sort().join(", ")}`);
  return out("A15", cause, "definitive", { weapon: cls, className: cls, contributors, evidence: [fatalAbove, kl], flags: fl, notes });
}

// ---- A16 / A17: a vehicle with nobody in the driver's seat
function ruleNoDriver({ c, k, kl, flags }: Killed): Draft {
  const S = c.server;
  const veh = k.weapon!;
  const burst = [...c.hits, ...c.chits].filter((h) => h.cat === "vehicle_no_driver" && c.t0 - h.ts <= 3);
  const b0 = burst.length ? Math.min(...burst.map((h) => h.ts)) : c.t0;
  const unc = c.eps.filter((ep) => b0 - 2 <= ep.u.ts && ep.u.ts <= c.t0);
  const near = c.pos ? S.othersNear(c.pid, c.pos, c.t0 - 30, c.t0 + 30, 100) : new Map<string, { name: string; dist: number }>();
  const notes = [`other players within 100 m / +-30 s: ${[...near.values()].map((v) => v.name).join(", ") || "none"}`];
  const fs = c.finalSpeed();
  if (fs) notes.push(`own-position speed before the burst: ${f1(fs.speed)} m/s over ${fs.secs} s${fs.speed <= 3.2 ? " (no travel: a fall-over or a burst at a standstill, not a crash at speed)" : ""}`);
  const same = S.window(c.t0 - 300, c.t0 + 300).filter((x) => x.kind === "killed" && x.subject!.id !== c.pid && x.tail!.includes(veh)
    && pos(x) != null && c.pos != null && dist2d(pos(x)!, c.pos) <= 15);
  if (same.length) notes.push(`the same vehicle class killed ${names(same.map((x) => x.subject!.name))} within 15 m and 300 s (${same.slice(0, 3).map((x) => lineRef(x)).join(", ")})`);
  if (veh.startsWith("Motorbike") && unc.length) {
    // Knocked out, then hit by the riderless bike: that the victim was on it is inferred.
    return out("A16", "vehicle_own_crash", "strong", {
      weapon: veh, className: veh, evidence: [unc[unc.length - 1]!.u, ...burst.slice(0, 1), kl], flags, notes,
    });
  }
  return out("A17", "vehicle_impact", "definitive", { weapon: veh, className: veh, evidence: [...burst.slice(0, 1), kl], flags, notes });
}

// ---- A17, the old log format: a vehicle class where a killer would be. The driver is never named.
function ruleVehicle({ c, k, kl, above, flags }: Killed): Draft {
  const veh = k.weapon!;
  const near = c.pos ? c.server.othersNear(c.pid, c.pos, c.t0 - 30, c.t0 + 30, 100) : new Map<string, { name: string; dist: number }>();
  const burst = c.hits.filter((h) => h.cat === "vehicle" && c.t0 - h.ts <= 5);
  const notes = [`driver unknown; candidates by proximity only: ${[...near.values()].map((v) => `${v.name} (${f0(v.dist)} m)`).join(", ") || "nobody logged within 100 m / +-30 s"}`];
  return out("A17", "vehicle_impact", "definitive", { weapon: veh, className: veh, evidence: [...burst.slice(0, 1), above, kl], flags, notes });
}

export function classifyKilled(c: DeathContext): Draft {
  const k = c.killer!;
  const kl = c.prim;
  const above = kl.seq > 0 ? c.server.lines[kl.seq - 1]! : null;
  let fatalAbove: Hit | null = null;
  if (above && above.subject?.id === c.pid && above.subject.dead && above.kind === "hit" && above.hit) {
    const h = new Hit(above);
    if (h.hp != null && h.hp <= 0) fatalAbove = h;
  }
  const expl0 = c.fatal.filter((h) => h.cat === "explosion");
  const flags: string[] = [];
  if (c.nKillLines > 1) flags.push(`kill_lines_x${c.nKillLines}`);
  const K: Killed = { c, k, kl, above, fatalAbove, expl0, flags };

  // ---------------- a player on the kill line
  if (k.kind === "vehicle_driver") return ruleDriver(K);
  if (k.kind === "player" || k.kind === "player_unparsed") {
    if (k.dead) flags.push("killer_dead_flag");
    const fistExpl = k.weapon === "(MeleeFist)" && expl0.length > 0 && !c.fatal.some((h) => h.cat === "player" || h.cat === "self");
    if (k.self) return ruleSelf(K, fistExpl);
    if (fistExpl) return ruleHeldGrenade(K);
    return rulePvp(K);
  }

  // ---------------- an explosive on the kill line
  const raw = (k.weapon ?? "").trim();
  if (k.kind === "explosive" || Object.hasOwn(FRAG, raw) || CLAY.has(raw) || PLAS.has(raw) || raw === "LandMineTrap" || raw.startsWith("Land_FuelStation")) {
    if (raw.startsWith("Land_FuelStation")) return ruleFuelPump(K, raw);
    const meleeFatal = c.fatal.filter((h) => h.cat === "player" && (h.det.weapon ?? "") === raw);
    if (expl0.length === 0 && meleeFatal.length) return ruleClubbedWithExplosive(K, raw, meleeFatal);
    const trips = c.hits.filter((h) => h.cat === "trap" && h.det.source === "TripwireTrap" && c.t0 - h.ts >= 0 && c.t0 - h.ts <= 6);
    if (CLAY.has(raw)) return ruleClaymore(K, trips);
    if (Object.hasOwn(FRAG, raw)) {
      const tw = trips.filter((h) => c.t0 - h.ts >= 3 && c.t0 - h.ts <= 5);
      return tw.length ? ruleFragTrap(K, FRAG[raw]!, tw) : ruleFrag(K, raw, FRAG[raw]!);
    }
    if (raw === "LandMineTrap") return ruleLandMine(K);
    if (PLAS.has(raw)) return ruleCharge(K, raw);
    return out("A08x", "explosive_other", "definitive", { weapon: raw, className: k.entity, evidence: [kl], flags });
  }

  // ---------------- the empty-killer forms (`killed by  with X`, two spaces)
  if (k.kind === "unnamed") {
    if (k.subkind === "explosive_item") return rule40mm(K);
    if (k.subkind === "fire") return ruleFire(K);
    if (k.subkind === "ownerless_firearm") return ruleOwnerlessFirearm(K);
    return out("A14x", "unknown", "unknown", { evidence: [kl] });
  }

  if (k.kind === "infected" || k.kind === "animal") return ruleCreature(K);
  if (k.kind === "vehicle_no_driver") return ruleNoDriver(K);
  if (k.kind === "vehicle") return ruleVehicle(K);
  return out("A99", "unknown", "unknown", { evidence: [kl], mech: false });
}
