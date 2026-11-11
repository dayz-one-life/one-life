import { species, type DeathContext, type Hit } from "../context/build.js";
import { pySum, type StampedLine } from "../context/server.js";
import { deadMan, recentPlayerContrib } from "./killed.js";
import { AMMO_NAME, CO_KEY, HEAT_BUILD_TS, SAND_MAPS } from "./tables.js";
import { contributor, EVIDENCE_MAX, f0, f1, lineRef, type Draft } from "./verdict.js";

/**
 * The post-pass every rule's answer goes through. A port of the reference's `finish`,
 * `nonplayer_cocauses`, `_co_owner` and `heat_cycle`: one list of assists, earlier attackers,
 * what else wounded the victim before a kill, the state the victim was in, and the heat faint
 * cycle as a co-cause.
 *
 * ⚠️ Everyone added here is a CONTRIBUTOR: context for the operator, never a killer and never
 * printed. None of it changes the cause, the confidence or the attribution.
 */

/**
 * The heat faint cycle: two or more closed knock-outs with no hit beside them, each 13 s or
 * shorter, 55 to 130 s apart, the last ended no more than 135 s before death, on or after the
 * build that brought heatstroke. Returns the run as `[unconscious, regained]` seconds.
 */
export function heatCycle(c: DeathContext): [number, number][] | null {
  if (c.t0 < HEAT_BUILD_TS) return null;
  const fa = c.eps.filter((ep) => ep.r != null && ep.r.kind === "regained" && ep.r.ts - ep.u.ts <= 13 && c.koHits(ep).length === 0)
    .map((ep) => [ep.u.ts, ep.r!.ts] as [number, number]);
  const run: [number, number][] = [];
  for (let i = fa.length - 1; i >= 0; i--) {
    const [a, b] = fa[i]!;
    if (run.length === 0) {
      if (c.t0 - b > 135) break;
      run.push([a, b]);
    } else {
      const gap = run[run.length - 1]![0] - b;
      if (gap < 55 || gap > 130) break;
      run.push([a, b]);
    }
  }
  run.reverse();
  return run.length >= 2 ? run : null;
}

type Placed = ReturnType<DeathContext["server"]["placedNear"]>;

/** Whose device wounded the victim before the kill, in words; the sole placer near it becomes an
 *  inferred contributor unless they are the victim or the killer. */
function coOwner(c: DeathContext, v: Draft, cands: Placed, killerId: string | null, h: Hit): string {
  if (cands.length === 0) return " (no `placed` line within 5 m; owner unknown)";
  // the placers, the most recent placement of each
  const placers = new Map<string, { line: StampedLine; dist: number }>();
  for (const x of [...cands].sort((a, b) => b.line.seq - a.line.seq)) {
    if (!placers.has(x.line.subject!.id)) placers.set(x.line.subject!.id, { line: x.line, dist: x.dist });
  }
  if (placers.size > 1) {
    const fresh = cands.filter((x) => h.ts - x.line.ts <= 600);
    if (fresh.length === 1) {
      const po = fresh[0]!.line;
      const who = po.subject!.id === c.pid ? "the victim's own" : po.subject!.id === killerId ? "probably the killer's own" : `probably ${po.subject!.name}'s`;
      return ` (${who}: the only one placed there in the 10 min before the hit, ${h.ts - po.ts} s earlier ${f1(fresh[0]!.dist)} m away; ${cands.length - 1} older placement(s) within 5 m, so inferred)`;
    }
    return ` (owner ambiguous: ${cands.length} placements within 5 m by ${[...placers.values()].map((p) => p.line.subject!.name).join(", ")})`;
  }
  const { line: po, dist } = [...placers.values()][0]!;
  const ageS = h.ts - po.ts;
  if (po.subject!.id === c.pid) return ` (the victim's own, placed ${ageS} s earlier ${f1(dist)} m away)`;
  if (po.subject!.id === killerId) return ` (probably the killer's own: only ${po.subject!.name} placed one within 5 m, ${ageS} s earlier ${f1(dist)} m away; inferred)`;
  if (!v.contributors.some((y) => y.dayzId === po.subject!.id)) {
    v.contributors.push(contributor(po.subject!.name, po.subject!.id, "trap_owner (co-cause)", "inferred"));
  }
  return ` (owner by proximity: ${po.subject!.name}, ${lineRef(po)}, inferred)`;
}

/**
 * Non-player damage shortly before a kill. A source counts when, in the last 120 s, it left the
 * victim at HP 25 or less or took 50 HP or more in one hit, or when up to 600 s before it left
 * HP 25 or less and no later reading shows a recovery. The kill stands; this is context.
 */
function nonplayerCoCauses(c: DeathContext, v: Draft, killerId: string | null): void {
  const cause: string = v.cause;
  const skip = new Set<string>();
  if (cause === "infected" || cause.startsWith("animal")) { skip.add("infected"); skip.add("animal"); }
  if (cause.startsWith("vehicle")) { skip.add("vehicle"); skip.add("vehicle_no_driver"); }
  if (cause === "fire") skip.add("fire");
  const explDeath = cause.startsWith("explosive") || cause === "landmine" || cause === "self_inflicted_explosive" || cause === "fuel_explosion";
  type Entry = { h: Hit; drop: number | null };
  const found = new Map<string, Entry[]>();
  const allHits = new Map<string, Entry[]>();
  const hpAfter = c.hpr.map((h) => h.hp!);
  c.hpr.forEach((h, i) => {
    const age = c.t0 - h.ts;
    if (!h.damaging || h.cat === "player" || h.cat === "vehicle_driver" || h.cat === "self" || skip.has(h.cat) || age > 600 || age < 0) return;
    // a flashbang takes nothing; the blast that killed is the death, not a co-cause
    if (h.cat === "explosion" && (h.det.ammo === "FlashGrenade_Ammo" || (explDeath && age <= 1))) return;
    if (cause === "fuel_explosion" && h.cat === "explosion" && h.det.ammo === "LandFuelFeed_Ammo") return;
    if (cause === "explosive_trap" && h.cat === "trap") return;
    const prev = i > 0 ? hpAfter[i - 1]! : c.fresh ? 100.0 : null;
    const drop = prev != null ? prev - h.hp! : null;
    if (drop != null && drop < 1) return;
    const later = hpAfter.slice(i + 1);
    const recovered = (later.length ? Math.max(...later) : h.hp!) > h.hp! + 10;
    const key = h.cat === "explosion" ? `explosion\u0000${h.det.ammo}` : `${h.cat}\u0000${h.det.source ?? ""}`;
    let list = allHits.get(key);
    if (!list) { list = []; allHits.set(key, list); }
    list.push({ h, drop });
    if ((age <= 120 && (h.hp! <= 25 || (drop != null && drop >= 50))) || (h.hp! <= 25 && !recovered)) found.set(key, list);
  });
  // The source must itself have taken a material share: 10 HP or more over its hits.
  for (const [key, list] of [...found]) {
    if (list.every((x) => x.drop != null) && pySum(list.map((x) => x.drop!)) < 10) found.delete(key);
  }
  if (found.size === 0) return;
  for (const list of found.values()) {
    const { h } = list[list.length - 1]!;
    const age = c.t0 - h.ts;
    let name: string, ck: string, owner = "";
    if (h.cat === "explosion") {
      const ammo = h.det.ammo ?? "";
      name = `${AMMO_NAME[ammo] ?? ammo} blast`;
      ck = `explosion_${ammo.replace("_Ammo", "")}`;
      const tw = c.hits.filter((x) => x.cat === "trap" && x.det.source === "TripwireTrap" && h.ts - x.ts >= 3 && h.ts - x.ts <= 5);
      if (tw.length) {
        const trip = tw[tw.length - 1]!;
        name = `tripwire-rigged ${(AMMO_NAME[ammo] ?? ammo).replace(" frag", " grenade")}`;
        ck = "tripwire_grenade";
        const at = trip.o.subject!.pos ?? h.o.subject!.pos;
        owner = coOwner(c, v, at ? c.server.placedNear(at, new Set(["TripwireTrap"]), 5, trip.o.seq) : [], killerId, h);
      } else {
        const dm = deadMan(c, h.ts, h.o.subject!.pos, h.o.seq);
        if (dm) {
          const x = dm.line;
          owner = ` (went off ${dm.dt} s after the victim killed ${x.subject!.name} ${f1(dm.dist)} m away: dead-man grenade, holder inferred)`;
          if (x.subject!.id !== killerId && !v.contributors.some((y) => y.dayzId === x.subject!.id)) {
            v.contributors.push(contributor(x.subject!.name, x.subject!.id, "grenade_holder (inferred, co-cause)", "inferred"));
          }
        } else owner = " (thrower not logged)";
      }
    } else if (h.cat === "trap") {
      name = h.name();
      ck = name.replaceAll(" ", "_");
      const at = h.o.subject!.pos;
      owner = coOwner(c, v, at ? c.server.placedNear(at, new Set([h.det.source ?? ""]), 5, h.o.seq, 7 * 86400, h.ts) : [], killerId, h);
    } else if (h.cat === "animal") {
      name = `a ${species(h.det.source ?? "")}`;
      ck = `animal_${species(h.det.source ?? "")}`;
    } else {
      name = h.name();
      ck = CO_KEY[h.cat] ?? h.cat;
    }
    if (!v.coCauses.includes(ck)) v.coCauses.push(ck);
    const drops = list.filter((x) => x.drop != null).map((x) => x.drop!);
    v.notes.push(`before the kill, ${name} left HP ${f1(h.hp)} ${age} s earlier${list.length > 1 ? `, ${list.length} hits for ${f0(pySum(drops))} HP` : ""}${owner}`);
    v.evidence = [h.o, ...v.evidence].slice(0, EVIDENCE_MAX);
  }
  v.flags.push("non_player_damage_before_kill");
}

export function finish(c: DeathContext, v: Draft): Draft {
  const rule = v.rule;
  const a = v.attribution;
  if (rule.startsWith("A") || rule === "B07") {
    const excl = new Set<string>([c.pid]);
    let killerId: string | null = null;
    if (a && (a.role.startsWith("killer") || a.role === "driver" || a.role === "grenade_holder")) {
      excl.add(a.dayzId);
      killerId = a.dayzId;
    }
    // One assist list for every kill: players who damaged the living victim in the last 120 s.
    let have = new Set(v.contributors.map((x) => x.dayzId));
    const by = new Map<string, Hit[]>();
    for (const h of recentPlayerContrib(c, 120)) {
      if (excl.has(h.pid!)) continue;
      if (!by.has(h.pid!)) by.set(h.pid!, []);
      by.get(h.pid!)!.push(h);
    }
    for (const [pid, hs] of by) {
      if (have.has(pid)) continue;
      v.contributors.push(contributor(hs[hs.length - 1]!.det.attacker!.name, pid, "assist", "inferred"));
    }
    if (v.contributors.some((x) => x.role === "assist") && !v.flags.includes("assist_other_player_hits")) v.flags.push("assist_other_player_hits");
    // A player who left the victim at HP 25 or less between 120 and 600 s earlier, with no recovery since.
    have = new Set([...v.contributors.map((x) => x.dayzId), ...excl]);
    const hpAfter = c.hpr.map((h) => h.hp!);
    c.hpr.forEach((h, i) => {
      const later = hpAfter.slice(i + 1);
      if ((h.cat === "player" || h.cat === "vehicle_driver") && h.damaging && c.t0 - h.ts > 120 && c.t0 - h.ts <= 600 && h.hp! <= 25
        && !have.has(h.pid!) && (later.length ? Math.max(...later) : h.hp!) <= h.hp! + 10) {
        have.add(h.pid!);
        v.contributors.push(contributor(h.det.attacker!.name, h.pid!, "earlier_attacker", "inferred"));
        if (!v.flags.includes("earlier_attacker_120_600s")) v.flags.push("earlier_attacker_120_600s");
      }
    });
    nonplayerCoCauses(c, v, killerId);
    // A melee kill by a single blow on a victim somebody else had brought down.
    if (rule === "A04" && killerId && ["pvp_fists", "pvp_fists_holding_item", "pvp_melee_weapon"].some((f) => v.flags.includes(f))) {
      const kh = c.dmg.filter((h) => h.pid === killerId && c.t0 - h.ts <= 120);
      const prior = c.hpr[c.hpr.length - 1] ?? null;
      const run: Hit[] = [];
      for (let i = c.hpr.length - 1; i >= 0; i--) {
        if (c.hpr[i]!.hp! > 30) break;
        run.push(c.hpr[i]!);
      }
      const brought = run.reverse().filter((h) => h.damaging && h.cat !== "self" && h.pid !== killerId && h.hp! <= 15);
      if (kh.length <= 1 && prior != null && prior.hp! <= 15 && c.t0 - prior.ts <= 600 && brought.length) {
        const lastB = brought[brought.length - 1]!;
        v.notes.push(`finished off at HP ${f1(prior.hp)} (${kh.length} earlier living hit(s) by the killer in the last 120 s); brought down by ${[...new Set(brought.map((h) => h.name().replace("player ", "")))].join(", ")}, HP ${f1(lastB.hp)} ${c.t0 - lastB.ts} s before`);
        v.flags.push("finishing_blow_only");
      }
    }
  }
  if (v.cause === "pvp" && rule !== "B10" && rule !== "B11") {
    if (c.openUnc && !v.flags.includes("victim_unconscious_before_kill")) v.flags.push("victim_unconscious_before_kill");
    const disc = c.alive.filter((o) => o.kind === "disconnected" && c.t0 - o.ts >= 0 && c.t0 - o.ts <= 20);
    const conn = c.alive.filter((o) => o.kind === "connected");
    const lastConn = conn[conn.length - 1];
    if (disc.length && !(lastConn && lastConn.seq > disc[disc.length - 1]!.seq)) v.flags.push("victim_disconnected_before_kill");
    if (lastConn && c.t0 - lastConn.ts >= 0 && c.t0 - lastConn.ts <= 10) {
      v.flags.push("killed_within_10s_of_spawn_in");
      v.notes.push(`killed ${c.t0 - lastConn.ts} s after \`is connected\``);
    }
  }
  // The heat faint cycle is a co-cause under any stated mechanism, not only in the bare-death rules.
  if (!v.cause.startsWith("heatstroke") && !v.coCauses.some((x) => x.startsWith("heatstroke"))) {
    const run = heatCycle(c);
    if (run) {
      // On a sand map the engine's silicosis has the identical faint cycle: the two cannot be told apart.
      const sand = c.map != null && SAND_MAPS.has(c.map);
      v.coCauses.push(sand ? "heatstroke_or_silicosis" : "heatstroke");
      v.notes.push(`${run.length} hit-less faints of ${run.map(([x, y]) => y - x).join("/")} s, the last ending ${c.t0 - run[run.length - 1]![1]} s before death: the ${sand ? "heatstroke / silicosis" : "heatstroke"} cycle, which was draining health (inferred co-cause)`);
      v.flags.push("heat_faint_cycle");
    }
  }
  return v;
}
