import { species, type DeathContext, type Episode, type Hit } from "../context/build.js";
import type { StampedLine } from "../context/server.js";
import { dist2d, type Pos } from "../evidence/parse.js";
import type { Confidence } from "../types.js";
import { recentPlayerContrib } from "./killed.js";
import { CREATURE, HEAT_BUILD_TS } from "./tables.js";
import { classifyInferred } from "./bare-inferred.js";
import { att, contributor, f0, f1, lineRef, out, type Draft } from "./verdict.js";

/**
 * The rules for a death with no kill line (` died. Stats>` / ` drowned. Stats>`), as far as the
 * log STATES something: B01 to B08. A port of the reference's `suicide`, `upstream_of_ko` and the
 * first half of `classify_bare`, in its order: the first rule that matches answers.
 *
 * Below B08 nothing is stated: the rest (B09 to B23, `classifyInferred` in `bare-inferred.ts`)
 * reads timing, speed and health bookkeeping.
 *
 * ⚠️ Every person named by these rules has basis `not_stated`: there is no kill line.
 */

const pos = (o: StampedLine): Pos | null => o.subject!.pos;
const isPlayerHit = (h: Hit): boolean => h.cat === "player" || h.cat === "vehicle_driver";
const last = <T,>(xs: readonly T[]): T | undefined => xs[xs.length - 1];
const hp = (h: Hit): number => h.hp ?? 0;

// ---- B01: a `committed suicide` line in the death cluster
export function suicide(c: DeathContext): Draft {
  const S = c.server;
  const sl = c.dl.filter((d) => d.role.startsWith("suicide")).map((d) => d.line);
  const died = c.dl.filter((d) => d.line.kind === "died" || d.line.kind === "drowned").map((d) => d.line);
  // The living-form suicide line written before the death line is the firearm order.
  const method = sl.some((o) => !o.subject!.dead && o.seq < c.prim.seq) ? "firearm" : "blade/tool";
  const em = c.alive.filter((o) => o.kind === "emote" && o.tail!.includes("EmoteSuicide"));
  const lastEm = last(em);
  const item = lastEm ? /EmoteSuicide(?: with (\w+))?/.exec(lastEm.tail!)?.[1] ?? null : null;
  const refTs = lastEm ? lastEm.ts : c.t0 - 5;
  // From the first living line of THIS life that is not the old corpse's disconnect or the queue.
  const fa0 = c.life.find((o) => !o.subject!.dead && o.kind !== "disconnected" && o.kind !== "connecting");
  const lifeLen = fa0 ? c.t0 - fa0.ts : null;
  const contributors: Draft["contributors"] = [], flags: string[] = [], notes: string[] = [];
  const ph = c.dmg.filter((h) => isPlayerHit(h) && c.t0 - h.ts <= 180).filter((h) => refTs - h.ts <= 120);
  if (ph.length) {
    const lastHit = last(ph)!;
    const g = Math.max(0, refTs - lastHit.ts);
    const ko = c.eps.some((ep) => ep.u.ts - lastHit.ts >= 0 && ep.u.ts - lastHit.ts <= 2);
    const minHp = Math.min(...ph.filter((h) => h.hp != null).map((h) => h.hp!));
    const conf: Confidence = g <= 60 && (ko || hp(lastHit) <= 25) ? "strong" : "inferred";
    const downed = minHp <= 25 || c.eps.some((ep) => ep.u.ts >= ph[0]!.ts);
    contributors.push(contributor(lastHit.det.attacker!.name, lastHit.pid!, "last_attacker_before_suicide", conf));
    flags.push(`suicide_after_player_damage:${downed ? "downed" : "wounded"}`);
    // Was the attacker still alive when the suicide started? A dead attacker cannot be denied a
    // kill. (A trade: their death line can be written just before their last bullet lands, so
    // look five seconds back.)
    let dd = S.diedIn(lastHit.pid!, lastHit.ts - 5, refTs, c.firstSeq);
    if (dd && S.aliveAgain(lastHit.pid!, dd.seq, lastHit.o.seq)) dd = null;
    if (dd) {
      const byVictim = dd.text.replaceAll("(DEAD) ", "").includes(`killed by Player "${c.victimName}" (id=${c.pid}`);
      flags.push("attacker_dead_before_suicide");
      if (byVictim) flags.push("attacker_killed_by_victim");
      notes.push(`the attacker ${lastHit.det.attacker!.name} was already dead when the suicide started (${byVictim ? "killed by the victim" : "died"}, ${lineRef(dd)}), so this is not a kill-denial`);
    } else flags.push("attacker_alive_at_suicide");
    // Every other player who damaged the living victim in the same 120 s.
    const seen = new Set([lastHit.pid]);
    for (let i = ph.length - 1; i >= 0; i--) {
      const h = ph[i]!;
      if (seen.has(h.pid)) continue;
      seen.add(h.pid);
      contributors.push(contributor(h.det.attacker!.name, h.pid!, "attacker_before_suicide", "inferred"));
    }
    // Non-player damage between the player's last hit and the suicide is the last wound, not the player.
    const later = c.dmg.filter((h) => h.ts > lastHit.ts && !isPlayerHit(h));
    if (later.length) {
      // ⚠️ The reference downgrades the LAST contributor listed, which is the last attacker only
      // when no other player hit the victim. Kept as it is: the answers were made this way.
      last(contributors)!.confidence = "inferred";
      flags.push("later_non_player_damage");
      notes.push(`non-player damage after the last player hit: ${c.srcLabel(later)} (HP ${f1(last(later)!.hp)} after the last)`);
    }
  } else {
    const cre = c.dmg.filter((h) => CREATURE.includes(h.cat) && c.t0 - h.ts <= 60);
    const oth = c.dmg.filter((h) => !CREATURE.includes(h.cat) && h.cat !== "fall" && !isPlayerHit(h) && c.t0 - h.ts <= 120);
    const fal = c.dmg.filter((h) => h.cat === "fall" && c.t0 - h.ts <= 120);
    const { water: w, energy: e } = c.stats, b = c.stats.bleedSources ?? 0;
    if (cre.length) flags.push("suicide_under_creature_attack");
    else if (oth.length) flags.push("suicide_after_env_damage");
    else if (fal.length) flags.push("suicide_after_fall");
    else if ((e != null && e < 1) || (w != null && w < 1)) flags.push("suicide_starving_or_dehydrated");
    else if (b > (method !== "firearm" ? 1 : 0)) flags.push("suicide_bleeding");
    else if (c.eps.some((ep) => c.t0 - ep.u.ts <= 600)) flags.push("suicide_after_blackout");
    else if (lifeLen != null && lifeLen <= 60) flags.push("suicide_fresh_spawn");
    else if (lifeLen != null && lifeLen <= 300) flags.push("suicide_early_life");
    else flags.push("suicide_no_context");
  }
  return out("B01", "suicide", "definitive", {
    weapon: item, contributors,
    evidence: [...em.slice(-1), ...sl, ...died.slice(0, 1), ...ph.slice(-1)],
    flags: [...flags, `method_${method.split("/")[0]}`], notes,
  });
}

/** What knocked the victim out: a word for the cause, how sure, the hits it rests on, and the
 *  player who did it when a player did. */
export function upstreamOfKo(c: DeathContext, ep: Episode): { key: string; conf: Confidence; hits: Hit[]; a: Draft["attribution"] } {
  const src = c.koSource(ep);
  if (src.hits.length === 0) {
    if (c.dmg.length && c.dmg.every((h) => CREATURE.includes(h.cat))) {
      // A knock-out with no hit beside it, in a life whose only damage was from creatures: blood loss.
      return { key: c.dmg.some((h) => h.cat === "infected") ? "infected" : "animal", conf: "inferred", hits: c.dmg.slice(-1), a: null };
    }
    const si = c.speedInto(ep.u);
    // A knock-out with no hit, reached at vehicle speed: a crash as an occupant writes no hit line.
    if (si && si.speed >= 7 && si.speed <= 45) return { key: "vehicle_crash", conf: "inferred", hits: [], a: null };
    return { key: "unknown", conf: "unknown", hits: [], a: null };
  }
  const cats = new Set(src.hits.map((h) => h.cat));
  let a: Draft["attribution"] = null;
  let key: string;
  if ([...cats].every((x) => CREATURE.includes(x))) key = cats.has("infected") ? "infected" : "animal";
  else if (cats.has("player") || cats.has("vehicle_driver")) {
    key = "player";
    const pl = last(src.hits.filter(isPlayerHit))!;
    a = att(pl.det.attacker!.name, pl.pid!, "knocked_out_by", "not_stated", src.confidence);
  } else key = [...cats].sort()[0]!;
  return { key, conf: src.confidence, hits: src.hits, a };
}

// ---- B02: the primary line is ` drowned.`
function ruleDrowned(c: DeathContext): Draft {
  const notes: string[] = [];
  let up: string | null = null, upc: Confidence | null = null;
  const falls = c.dmg.filter((h) => h.cat === "fall" && c.t0 - h.ts <= 300);
  if (c.openUnc) {
    const ku = c.t0 - c.openUnc.u.ts;
    notes.push(c.koHits(c.openUnc).length === 0 && ku <= 15
      ? `lost consciousness ${ku} s before death with no hit: the last stage of drowning, not an earlier knock-out`
      : `drowned while unconscious (knocked out ${ku} s earlier)`);
    if (falls.length) {
      up = "fall";
      upc = Math.abs(last(falls)!.ts - c.openUnc.u.ts) <= 5 ? "strong" : "inferred";
    }
  }
  const sit = c.alive.filter((o) => o.kind === "emote" && o.tail!.includes("EmoteSit") && c.t0 - o.ts <= 120);
  if (sit.length) notes.push(`performed ${last(sit)!.tail!.trim()} ${c.t0 - last(sit)!.ts} s before at the death position (sat down in water)`);
  return out("B02", "drowned", "definitive", {
    upstream: up, upstreamConf: upc,
    evidence: [...falls.slice(-1), c.openUnc?.u, ...sit.slice(-1), c.prim], notes,
  });
}

// ---- B03: an HP-0 FallDamage line on this body in the death second
function ruleFall(c: DeathContext, ffall: Hit[], sp: ReturnType<DeathContext["finalSpeed"]>, speed: number | null, speedNote: string | null): Draft {
  const notes: string[] = [], flags: string[] = [], contributors: Draft["contributors"] = [];
  const ph = recentPlayerContrib(c, 120);
  const lastPh = last(ph);
  const laterNp = c.dmg.filter((h) => lastPh != null && h.ts > lastPh.ts && !isPlayerHit(h) && h.cat !== "fall");
  if (lastPh && laterNp.length === 0) {
    // The fall is the stated killer; the player who hit them just before is context, not a kill.
    contributors.push(contributor(lastPh.det.attacker!.name, lastPh.pid!, "contributor", "inferred"));
    flags.push("fell_during_pvp");
  }
  let up: string | null = null, upc: Confidence | null = null;
  const mxs = c.maxRecentSpeed(900);
  if (sp && sp.secs >= 3 && speed != null && speed >= 8) {
    // Fall damage on leaving a moving vehicle. A companion at the previous snapshot makes it strong.
    const at = pos(sp.line);
    const comp = at ? c.server.othersNear(c.pid, at, sp.line.ts, sp.line.ts, 3) : new Map<string, { name: string; dist: number }>();
    if (mxs > 45) {
      flags.push("impossible_speed_before_fall");
      notes.push(`own positions give ${f1(speed)} m/s into the fall but up to ${f0(mxs)} m/s earlier, faster than any vehicle (unlogged relocation); not read as a vehicle`);
    } else {
      upc = comp.size ? "strong" : "inferred";
      up = "vehicle";
      flags.push("fall_at_vehicle_speed", "vehicle_death_inventory");
      notes.push(`travelling at ${f1(speed)} m/s over the last ${sp.secs} s${comp.size ? `, with ${[...comp.values()].map((v) => v.name).join(", ")} within 3 m at the previous snapshot` : ""}: left a moving vehicle (that the engine writes FallDamageHealth for a vehicle exit is inferred from these deaths)`);
    }
  }
  if (speedNote) notes.push(speedNote);
  if (c.openUnc) flags.push("fell_while_unconscious");
  const othr = c.dmg.filter((h) => (h.cat === "barbed_wire" || h.cat === "explosion" || h.cat === "trap") && c.t0 - h.ts <= 120);
  if (othr.length) notes.push(`earlier damage in the last 120 s: ${c.srcLabel(othr)} (HP ${f1(last(othr)!.hp)} after); the fall killed`);
  // Line order. The HP-0 fall line normally precedes the death line; after it, it has the shape
  // of a hit on a corpse, so the fall is then the likeliest reading and no more.
  let conf: Confidence = "definitive";
  if (!ffall.some((h) => h.o.seq < c.prim.seq)) {
    conf = "strong";
    flags.push("fall_line_after_death");
  }
  // The altitude drop from the last own positions, as a rough size of the fall.
  const prevp = c.alive.filter((o) => pos(o) != null && o.seq < ffall[0]!.o.seq && c.t0 - o.ts <= 15);
  if (prevp.length && c.pos && up == null) {
    const dz = Math.max(...prevp.slice(-3).map((o) => pos(o)![2])) - c.pos[2];
    if (dz >= 0 && dz < 8) {
      notes.push(`altitude dropped only ${f1(dz)} m from the own position line(s) of the last 15 s; a fall that short does not take 100 HP, so the victim was already badly hurt and the fall only finished them (inferred)`);
      flags.push("short_fall");
    }
  }
  return out("B03", "fall", conf, {
    contributors, upstream: up, upstreamConf: upc,
    evidence: [...ph.slice(-1), up ? sp!.line : null, ffall[0]!, c.prim], flags, notes,
  });
}

// ---- B04: `is disconnecting while being restrained`
function ruleRestrained(c: DeathContext): Draft {
  const mk = c.dl.filter((d) => d.role.startsWith("disconnect_restrained")).map((d) => d.line);
  const em = c.alive.filter((o) => o.kind === "emote" && c.t0 - o.ts <= 300);
  // A lead only: who was beside the victim when they stopped moving. The log never names who restrains.
  const notes: string[] = [], contributors: Draft["contributors"] = [];
  let ev0: StampedLine[] = [];
  let tStatic: StampedLine | null = null, anchor: Pos | null = null;
  for (let i = c.alive.length - 1; i >= 0; i--) {
    const o = c.alive[i]!;
    if (o.kind === "connected" || o.kind === "connecting" || o.kind === "disconnected") break;
    const p = pos(o);
    if (p && o.ts < c.t0) {
      anchor ??= p;        // the last position before the logout second
      if (dist2d(p, anchor) <= 1.5) tStatic = o;
      else break;
    }
  }
  if (tStatic && anchor && c.t0 - tStatic.ts >= 60) {
    const near = c.server.othersNear(c.pid, anchor, tStatic.ts - 60, tStatic.ts + 300, 10);
    notes.push(`did not move from this spot for the last ${c.t0 - tStatic.ts} s`);
    for (const [id, v] of near) {
      contributors.push(contributor(v.name, id, "possible_restrainer", "inferred"));
      notes.push(`${v.name} was logged ${f1(v.dist)} m from the victim around the moment the victim stopped moving; a lead only`);
    }
    if (near.size === 0) notes.push("no other player was logged within 10 m around the moment the victim stopped moving");
    ev0 = [tStatic];
  } else notes.push("no static period before the logout; no other evidence of who applied the restraint");
  return out("B04", "restrained_logout", "definitive", { contributors, evidence: [...ev0, ...em.slice(-1), ...mk, c.prim], notes });
}

// ---- B05, B05b, B05c, B06: the server killed an unconscious body (logout, or the respawn button)
function ruleUnconscious(c: DeathContext, lastDmg: Hit | null): Draft {
  const { water: w, energy: e } = c.stats;
  const isResp = c.shape.has("respawn_alive_form");
  const mk = c.dl.filter((d) => d.role.startsWith("disconnect_uncon") || d.role.startsWith("respawn_alive")).map((d) => d.line);
  let a: Draft["attribution"] = null;
  let ev: (StampedLine | Hit)[] = [];
  const notes: string[] = [], flags: string[] = [];
  let key = "unknown", uconf: Confidence = "unknown";
  if (c.openUnc) {
    const up = upstreamOfKo(c, c.openUnc);
    key = up.key; uconf = up.conf; a = up.a;
    ev = [...up.hits.slice(-2), c.openUnc.u];
    const ku = c.t0 - c.openUnc.u.ts;
    notes.push(`knock-out to death: ${ku} s`);
    // B05c. `performed EmoteSitA` is the menu-logout sit. A sit 13 to 17 s before the marker with
    // the knock-out AFTER it: the player pressed Exit while conscious and was knocked out during
    // the countdown.
    const sit = c.alive.filter((o) => o.kind === "emote" && o.tail!.includes("EmoteSitA") && c.t0 - o.ts >= 13 && c.t0 - o.ts <= 17);
    const st = last(sit);
    if (st && !isResp && c.openUnc.u.ts >= st.ts && c.openUnc.u.seq > st.seq) {
      const pre = c.dmg.filter((h) => st.ts - h.ts >= 0 && st.ts - h.ts <= 60 && h.o.seq < st.seq);
      const since = c.dmg.filter((h) => h.o.seq > st.seq);
      if (pre.length === 0) flags.push("attacked_after_logout_started");
      const emS = c.alive.filter((o) => o.kind === "emote" && o.tail!.includes("EmoteSuicide") && st.ts - o.ts >= 0 && st.ts - o.ts <= 30);
      if (emS.length) notes.push(`\`${last(emS)!.tail!.trim()}\` ${st.ts - last(emS)!.ts} s before the sit: a suicide emote was started and abandoned`);
      return out("B05c", "logout_under_attack", "strong", {
        upstream: key, upstreamConf: uconf, attributed: a,
        evidence: [st, ...since.slice(0, 1), ...ev, ...mk, c.prim], flags: [...flags, "logout_sit_before_knockout"], notes,
      });
    }
    if (!isResp && ku < 15 && sit.length === 0) {
      notes.push(`the knock-out is only ${ku} s before the marker and the logout timer is 15 s, so Exit was pressed at or before the knock-out; with no sit line the log cannot say whether the player was conscious when they pressed it`);
      flags.push("exit_pressed_at_or_before_knockout");
    }
  } else {
    // No open `is unconscious` line: the body was downed during the logout timer.
    const disc = last(c.alive.filter((o) => o.kind === "disconnected" && c.t0 - o.ts >= 10 && c.t0 - o.ts <= 20));
    let hs: Hit[] = [];
    if (disc) {
      const since = c.dmg.filter((h) => h.ts >= disc.ts - 10);
      if (since.length && since.every((h) => CREATURE.includes(h.cat))) {
        key = since.some((h) => h.cat === "infected") ? "infected" : "animal";
        uconf = "strong"; hs = since;
        flags.push("logged_out_under_attack");
        if (!isResp) {
          // B05b. The player left conscious: "logged out while unconscious" would be false.
          const afterD = since.filter((h) => h.o.seq > disc.seq);
          return out("B05b", "logout_under_attack", "strong", {
            upstream: key, upstreamConf: "strong",
            evidence: [since[0]!, disc, ...afterD.slice(-2), ...mk, c.prim], flags, notes,
          });
        }
      } else if (since.length) {
        key = last(since)!.cat; uconf = "inferred"; hs = since;
      }
      ev = [disc, ...hs.slice(-2)];
    } else if (lastDmg && c.t0 - lastDmg.ts <= 30) {
      key = lastDmg.cat; uconf = "inferred";
      ev = [lastDmg];
    }
    if (c.eps.some((ep) => ep.r != null && c.t0 - ep.r.ts <= 5)) notes.push("`regained consciousness` shortly before the marker; the last knock-out on record had ended");
  }
  const zero = ([["dehydration", w], ["starvation", e]] as const).filter(([, v]) => v != null && v < 1).map(([n]) => n);
  if (zero.length) notes.push("Water/Energy at 0 on the Stats line (health was already draining)");
  // A knock-out with no nearby hit is not left unknown when the Stats line or the faint pattern explains it.
  if (key === "unknown" && c.openUnc) {
    const closed = c.eps.filter((ep) => ep.r != null && ep.r.kind === "regained" && c.koHits(ep).length === 0 && c.t0 - ep.u.ts <= 900)
      .map((ep) => [ep.u.ts, ep.r!.ts] as const);
    const lastClosed = last(closed);
    const cyc = c.t0 >= HEAT_BUILD_TS && lastClosed != null && lastClosed[1] - lastClosed[0] <= 13
      && c.openUnc.u.ts - lastClosed[1] >= 55 && c.openUnc.u.ts - lastClosed[1] <= 130;
    if (zero.length) {
      key = zero.length === 2 ? "starvation_and_dehydration" : zero[0]!;
      uconf = "inferred";
    } else if (cyc) {
      key = "heatstroke"; uconf = "inferred";
      notes.push(`no damaging hit near the knock-out; a hit-less faint of ${lastClosed![1] - lastClosed![0]} s ended ${c.openUnc.u.ts - lastClosed![1]} s before this one (heatstroke cycle, inferred)`);
    }
  }
  const ownTrap = last(c.dmg.filter((h) => h.cat === "trap" && h.det.source === "BearTrap" && c.t0 - h.ts <= 120));
  if (ownTrap) {
    const at = pos(ownTrap.o) ?? c.pos;
    const pl = (at ? c.server.placedNear(at, new Set(["BearTrap"]), 5, c.firstSeq, 600, c.t0) : []).filter((x) => x.line.subject!.id === c.pid);
    if (pl.length) {
      notes.push(`stepped in their own bear trap (placed ${ownTrap.ts - pl[0]!.line.ts} s before the hit, ${lineRef(pl[0]!.line)}), HP ${f1(ownTrap.hp)} after`);
      ev = [pl[0]!.line, ownTrap, ...ev];
      if (["unknown", "trap", "starvation", "dehydration", "starvation_and_dehydration"].includes(key)) {
        const gap = c.openUnc ? c.openUnc.u.ts - ownTrap.ts : null;
        // Strong only inside the knock-out window used everywhere else, and never with a zero stat competing.
        key = "own_bear_trap";
        uconf = gap != null && gap >= -1 && gap <= 3 && zero.length === 0 ? "strong" : "inferred";
      }
    }
  }
  return out(isResp ? "B06" : "B05", isResp ? "respawn_while_unconscious" : "unconscious_logout", "definitive", {
    upstream: key, upstreamConf: uconf, attributed: a, evidence: [...ev, ...mk, c.prim], flags, notes,
  });
}

// ---- B07: an HP-0 blow written BEFORE the died line, and no kill line. Never definitive.
function ruleFatalBlow(c: DeathContext, h: Hit): Draft {
  const pv = last(c.dmg.filter((x) => x.ts <= h.ts)) ?? null;
  if (h.cat === "player") {
    const ok = pv != null && h.dmg != null && h.dmg >= hp(pv) && h.ts - pv.ts <= 10;
    // ⚠️ A (DEAD)[HP: 0] hit has the same shape as a hit on a corpse. The player it names is an
    // inferred killer: basis `not_stated`, never printed.
    return out("B07", "pvp", "strong", {
      weapon: h.det.weapon, mech: false,
      attributed: att(h.det.attacker!.name, h.pid!, "killer (inferred)", "not_stated", ok ? "strong" : "inferred"),
      evidence: [pv, h, c.prim], flags: ["no_kill_line"],
      notes: ok ? [] : ["the hit damage does not exceed the previous HP reading"],
    });
  }
  const cause = h.cat === "infected" ? "infected" : (`animal_${species(h.det.source ?? "")}` as "animal_infected" | "animal_wolf" | "animal_bear" | "animal_dog");
  return out("B07", cause, "strong", { mech: false, evidence: [pv, h, c.prim], flags: ["no_kill_line"] });
}

// ---- B08a to B08d: a `bled out` line with the death line. Whose wounds is worked out.
function ruleBledOut(c: DeathContext): Draft {
  const S = c.server;
  const { water: w, energy: e } = c.stats, b = c.stats.bleedSources ?? 0;
  const mk = c.dl.filter((d) => d.role.startsWith("bled_out")).map((d) => d.line);
  const ph = c.dmg.filter(isPlayerHit);
  const notes: string[] = [];
  if (c.openUnc) notes.push(`died while unconscious (down for ${c.t0 - c.openUnc.u.ts} s)`);
  const sf = c.spontFaints();
  if (sf.length) notes.push(`${sf.length} hit-less knock-out(s) before death (low-blood signature)`);
  const zero = ([["dehydration", w], ["starvation", e]] as const).filter(([, v]) => v != null && v < 1).map(([n]) => n as string);
  const ld = last(c.dmg) ?? null;
  // No open bleed source at death and no fresh wound: the wound source cannot be named.
  if (b === 0 && (ld == null || c.t0 - ld.ts > 120)) {
    return out("B08d", "bled_out_other", "definitive", {
      upstream: "unknown", upstreamConf: "unknown", evidence: [ld, ...mk, c.prim], notes, co: zero,
    });
  }
  const p = last(ph);
  if (p) {
    const gap = c.t0 - p.ts;
    const laterNp = c.dmg.filter((h) => h.ts > p.ts && !isPlayerHit(h));
    if (gap <= 300 && laterNp.length === 0) {
      const eng = c.dmg.filter((h) => c.t0 - h.ts <= 900);
      const pe = eng.filter(isPlayerHit);
      const first = pe[0]!;
      const one = new Set(pe.map((h) => h.pid)).size === 1;
      const npSince = eng.filter((h) => h.ts >= first.ts && !isPlayerHit(h));
      const conf: Confidence = one && npSince.length === 0 ? "strong" : "inferred";
      if (npSince.length) notes.push(`other damage during the fight: ${c.srcLabel(npSince)}`);
      const npBefore = c.dmg.filter((h) => h.ts < first.ts && c.t0 - h.ts <= 1200 && !isPlayerHit(h));
      if (npBefore.length && hp(last(npBefore)!) <= 95) {
        notes.push(`earlier wound(s) in the last 20 min, before the player's first hit: ${c.srcLabel(npBefore)}; with ${b} bleed sources at death these may have been bleeding too`);
      }
      const key = `hit by Player "${c.victimName}" (id=${c.pid}`;
      const vfirst = S.window(first.ts - 30, first.ts).filter((x) => x.kind === "hit" && x.subject!.id === p.pid && !x.subject!.dead
        && x.seq < first.o.seq && x.text.includes(key));
      if (vfirst.length) notes.push(`the victim struck first (${vfirst.length} hit(s) on ${p.det.attacker!.name} in the 30 s before)`);
      // ⚠️ The last player to wound the victim, not a killer: basis `not_stated`.
      return out("B08a", "pvp_bleedout", conf, {
        weapon: p.det.weapon, upstream: "player", upstreamConf: conf,
        attributed: att(p.det.attacker!.name, p.pid!, "killer (inferred, bleed-out)", "not_stated", conf),
        evidence: [pe[0]!, p, ...mk, c.prim], notes,
      });
    }
    notes.push(`a player hit exists in this life (${p.det.attacker!.name}, ${gap} s before) but is stale or superseded`);
  }
  const recent = c.dmg.filter((h) => c.t0 - h.ts <= 300);
  // Wound sources: damaging hits in the last 20 min of this life (a bleed does not outlast that).
  const wd = c.dmg.filter((h) => c.t0 - h.ts <= 1200);
  if (wd.length && wd.every((h) => CREATURE.includes(h.cat))) {
    const lc = last(wd)!;
    const conf: Confidence = b > 0 && c.t0 - lc.ts <= 300 ? "strong" : "inferred";
    const infected = c.srcLabel(wd).includes("infected");
    return out("B08b", infected ? "bled_out_infected" : "bled_out_animal", conf, {
      upstream: infected ? "infected" : "animal", upstreamConf: conf, evidence: [lc, ...mk, c.prim], notes,
    });
  }
  if (recent.length && recent.every((h) => h.cat === "barbed_wire")) {
    return out("B08c", "bled_out_barbed_wire", "strong", {
      upstream: "barbed_wire", upstreamConf: "strong", weapon: `Barbed wire (${last(recent)!.det.source})`, className: last(recent)!.det.source,
      evidence: [recent[0]!, last(recent)!, ...mk, c.prim], notes,
    });
  }
  const mixed = wd.length > 0;
  if (mixed) notes.push(`wounds from mixed sources in the last 20 min: ${c.srcLabel(wd)}`);
  return out("B08d", "bled_out_other", "definitive", {
    upstream: mixed ? "mixed" : "unknown", upstreamConf: mixed ? "inferred" : "unknown",
    evidence: [...wd.slice(-2), ...mk, c.prim], notes,
  });
}

export function classifyBare(c: DeathContext): Draft {
  const sh = c.shape;
  // ⚠️ A stated suicide wins over everything, including hits in the same seconds.
  if (sh.has("suicide")) return suicide(c);

  const lastDmg = c.lastDmg();
  const sp = c.finalSpeed();
  let speed = sp ? sp.speed : null;
  let speedNote: string | null = null;
  if (speed != null && speed > 45) {
    speedNote = `final segment ${f0(speed)} m/s is impossible for a vehicle (unlogged relocation); ignored`;
    speed = null;
  }

  if (c.prim.kind === "drowned") return ruleDrowned(c);

  const ffall = c.fatal.filter((h) => h.cat === "fall");
  if (ffall.length) return ruleFall(c, ffall, sp, speed, speedNote);

  if (sh.has("disconnect_restrained")) return ruleRestrained(c);
  // ⚠️ Only the alive-form respawn line makes `respawn_alive_form`. The (DEAD) form is a corpse's
  // owner pressing the button after dying of something else, and is not this rule.
  if (sh.has("disconnect_unconscious") || sh.has("respawn_alive_form")) return ruleUnconscious(c, lastDmg);

  const fb = c.fatalBefore.filter((h) => h.cat === "player" || h.cat === "infected" || h.cat === "animal");
  if (fb.length && !sh.has("bled_out")) return ruleFatalBlow(c, last(fb)!);

  if (sh.has("bled_out")) return ruleBledOut(c);

  // ------------------------------------------------------------------ nothing below is stated
  return classifyInferred(c, lastDmg, sp, speed, speedNote);
}
