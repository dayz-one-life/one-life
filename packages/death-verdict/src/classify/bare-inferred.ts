import { species, type DeathContext, type Hit } from "../context/build.js";
import { pySum, type StampedLine } from "../context/server.js";
import { dist2d, type HitCategory, type Pos } from "../evidence/parse.js";
import type { Confidence, InternalCause } from "../types.js";
import { upstreamOfKo } from "./bare.js";
import { COLD_MAPS, CREATURE, FIT_TOL, HEAT_BUILD_TS, SAND_MAPS, spawnAt } from "./tables.js";
import { att, contributor, f0, f1, out, type Draft } from "./verdict.js";

/**
 * The rules for a bare death line that nothing in the log explains: B09 to B23. A port of the
 * second half of the reference's `classify_bare` (classify.py, after B08), in its order — the
 * first rule that matches answers:
 *
 *   B10  B09, B09h  B20f  B11  B12  B13  B14  B20a  B15  B20c  B16, B16h, B20b  B21  B17  B22  B20d  B23  B18  B19
 *
 * ⚠️ NOTHING HERE IS STATED. Every verdict has `mechanismStated: false`; the cause is read from
 * the health bookkeeping (`descent`), the Stats line, the spawn levels, the faint pattern, speed
 * and altitude. Every person named has basis `not_stated` and is never printed.
 *
 * ⚠️ Thresholds and arithmetic are the reference's, operation for operation (left-to-right
 * multiplication, compensated sums): a golden death can sit exactly on a threshold.
 *
 * Helper names follow the reference: `coOf`, `heatInfo`, `heatOut`, `coldOut`, `starv`,
 * `starvFlow`, `wshare`, `budgetFits`, `crashKo`. Notes are the operator's reading aid; no golden
 * answer depends on their text.
 */

type Low = "dehydration" | "starvation";
const last = <T,>(xs: readonly T[]): T | undefined => xs[xs.length - 1];
const isPlayerHit = (h: Hit): boolean => h.cat === "player" || h.cat === "vehicle_driver";
const isCreature = (h: Hit): boolean => CREATURE.includes(h.cat);
/** Python truthiness of a number that may be missing: null, undefined and 0 are false. */
const truthy = (x: number | null | undefined): x is number => x != null && x !== 0;

interface HeatRun {
  run: [number, number][];
  gaps: number[];
  conf: Confidence;
  notes: string[];
  open: boolean;
  ev: StampedLine[];
}

export function classifyInferred(
  c: DeathContext, ld: Hit | null, sp: ReturnType<DeathContext["finalSpeed"]>, speed: number | null, speedNote: string | null,
): Draft {
  const prim = c.prim;
  const w = c.stats.water ?? null, e = c.stats.energy ?? null, b = c.stats.bleedSources ?? 0;
  const ldAge = ld ? c.t0 - ld.ts : null;
  const low0: Low[] = ([["dehydration", w], ["starvation", e]] as const).filter(([, v]) => v != null && v < 1).map(([n]) => n);
  const lifeOn = c.onlineLife();
  let { water: W0, energy: E0 } = spawnAt(c.serverId, c.t0, c.spawnTable);
  // This life's own stats are above the looked-up spawn levels: the higher spawn set applies.
  if (c.fresh && w != null && e != null && (w > W0 + 1 || e > E0 + 1) && w <= 751 && e <= 1001) { W0 = 750.0; E0 = 1000.0; }
  // A stat drains health only while it is at or below 300. How long it can have been there is
  // bounded by its burn rate: the rate since a known spawn, never less than the basal 0.0125/s. A
  // stat that crossed 300 less than 60 s before death is not a drain.
  const TLOW = new Map<Low, number | null>();
  const marginal: string[] = [];
  for (const [n, v, s0] of [["dehydration", w, W0], ["starvation", e, E0]] as const) {
    if (v == null || v > 300) continue;
    if (v < 1) { TLOW.set(n, null); continue; }
    let rate = 0.0125;
    if (c.fresh && truthy(lifeOn) && s0 > v) rate = Math.max(rate, (s0 - v) / lifeOn);
    const tl = (300 - v) / rate;
    if (tl >= 60) TLOW.set(n, tl);
    else marginal.push(`${n === "dehydration" ? "Water" : "Energy"} ${f1(v)} crossed the 300 threshold at most ${f0(tl)} s before death and is not counted as a drain`);
  }
  const low300: Low[] = (["dehydration", "starvation"] as const).filter((n) => TLOW.has(n));
  const nLow = low300.length;
  const drift = c.features.corpseDrift30sM || 0;
  const co = c.features.coDeaths.filter((x) => x.primaryKind === "died");
  const cok = c.features.coKnockouts;
  const sakhal = c.map != null && COLD_MAPS.has(c.map);
  const sand = c.map != null && SAND_MAPS.has(c.map);
  const heatWord: InternalCause = sand ? "heatstroke_or_silicosis" : "heatstroke";
  const hpl = last(c.hpr) ?? null;                         // the last HP reading of any kind
  const ageOn = hpl ? c.online(hpl.ts, c.t0) : null;        // online seconds since it
  const hplHp = hpl?.hp ?? 0;
  const DS = c.descent(null, nLow);
  const segOk = sp != null && sp.secs >= 3 && speed != null;
  const shortJump = sp != null && sp.secs < 3 && speed != null;
  const spd = speed ?? 0;

  const leadNotes: string[] = [];
  if (ld) leadNotes.push(`last damage: ${ld.name()} ${ldAge} s before death, HP ${f1(ld.hp)} after`);
  if (hpl && (!ld || hpl.o.seq !== ld.o.seq)) leadNotes.push(`last HP reading: ${f1(hpl.hp)} on a 0-damage line ${ageOn} online s before death`);
  leadNotes.push(...marginal);
  for (const [sil, dt, tb] of DS.segs.filter((x) => c.t0 - x[2] <= 3600).slice(-3)) {
    leadNotes.push(`unlogged HP loss: ${f1(sil)} HP over ${dt} online s ending ${c.t0 - tb} s before death, no damaging line for it`);
  }
  if (segOk) leadNotes.push(`final segment speed ${f1(speed)} m/s over ${sp!.secs} s (${f0(sp!.dist)} m)`);
  else if (shortJump) leadNotes.push(`displaced ${f0(sp!.dist)} m in the ${sp!.secs} s before death`);
  if (speedNote) leadNotes.push(speedNote);
  const sf = c.spontFaints().filter(([a]) => c.t0 - a <= 3600);   // older sessions are not part of the death sequence
  if (sf.length) leadNotes.push(`hit-less knock-outs: durations ${sf.slice(-6).map(([a, x]) => x - a).join("/")} s`);
  if (c.openUnc) leadNotes.push(`unconscious at death (down ${c.t0 - c.openUnc.u.ts} s)`);
  // A hit-less knock-out of 3 s or less (build 1.30 on) is the motorbike fall-over: a lead, never a cause.
  const spill = sf.filter(([a, x]) => x - a <= 3 && c.t0 >= HEAT_BUILD_TS);
  if (spill.length) leadNotes.push(`hit-less knock-out of ${last(spill)![1] - last(spill)![0]} s, ${c.t0 - last(spill)![0]} s before death: the motorbike fall-over signature (lead only)`);
  // Metabolism per metre on a respawn life where nothing was eaten or drunk: on foot the stats
  // fall 0.10 or more per metre travelled, in a vehicle 0.01 to 0.04.
  let metab: number | null = null;
  const plen = c.fresh ? c.pathLen() : null;
  if (truthy(plen) && plen >= 400 && w != null && e != null && Math.abs((W0 - w) - (E0 - e)) < 1 && W0 - w > 0) {
    metab = (W0 - w) / plen;
    leadNotes.push(`metabolism: ${f1(W0 - w)} Water/Energy over ${f0(plen)} m = ${metab.toFixed(3)} per metre (on foot >= 0.10, vehicle 0.01-0.04)`);
  }
  if (drift > 5) leadNotes.push(`corpse position moved ${f0(drift)} m within ${c.features.corpseDriftDtS} s after death`);
  const ownp = c.ownPositions(1500);
  const seaRun: { ts: number; pos: Pos }[] = [];
  for (let i = ownp.length - 1; i >= 0; i--) {
    if (ownp[i]!.pos[2] <= 0.1) seaRun.push(ownp[i]!);
    else break;
  }
  const inSea = !!(c.pos && c.pos[2] <= 0.1 && seaRun.length);
  const seaS = inSea ? c.t0 - last(seaRun)!.ts : 0;
  if (c.pos && c.pos[2] <= 0.1) leadNotes.push(`died at sea level (altitude ${f1(c.pos[2])})${seaS ? `, at or below sea level for at least ${seaS} s` : ""}`);
  const hotFood = c.dmg.filter((h) => h.cat === "enviro" && c.t0 - h.ts <= 120);
  const vehSig = (segOk && spd >= 7) || drift > 5;

  const coOf = (names: readonly string[]): string[] => [...names];

  // ---- the heat pattern (build 1.30 on): hit-less faints of 13 s or less, 55 to 130 s apart; the
  // last may still be open at death.
  const heatInfo = (allowHits = false): HeatRun | null => {
    if (c.t0 < HEAT_BUILD_TS || (!allowHits && c.dmg.some((h) => c.t0 - h.ts <= 60))) return null;
    // stage-4 heatstroke needs about 1700 s of life
    if (c.fresh && lifeOn != null && lifeOn < 1700) return null;
    const relog = new Set(c.eps.filter((ep) => ep.r != null && ep.r.kind === "connected").map((ep) => ep.u.ts));
    let fa = sf.filter(([a, x]) => x - a <= 13 || relog.has(a));
    let open = false;
    if (c.openUnc) {
      const u = c.openUnc.u;
      if (c.t0 - u.ts <= 13 && c.koHits(c.openUnc).length === 0) { fa = [...fa, [u.ts, c.t0]]; open = true; }
      else return null;
    }
    const run: [number, number][] = [];
    for (let i = fa.length - 1; i >= 0; i--) {
      const [a, x] = fa[i]!;
      if (run.length === 0) {
        if (c.t0 - x <= 135) run.push([a, x]);
        else break;
      } else {
        const gap = last(run)![0] - x;
        if (gap >= 55 && gap <= 130) run.push([a, x]);
        else break;
      }
    }
    run.reverse();
    if (run.length === 0) return null;
    const gaps = run.slice(1).map(([a], i) => a - run[i]![1]);
    let conf: Confidence = gaps.length >= 2 ? "strong" : "inferred";
    const notes: string[] = [];
    if (run.some(([a]) => relog.has(a))) {
      conf = "inferred";
      notes.push(`the last knock-out was open when the player disconnected, reconnected and died ${c.t0 - last(run)![1]} s later`);
    }
    const starts = new Set(run.map(([a]) => a));
    return { run, gaps, conf, notes, open, ev: c.eps.filter((ep) => starts.has(ep.u.ts)).map((ep) => ep.u).slice(-3) };
  };
  const HI0 = heatInfo();

  const heatOut = (rule: string, co_: readonly string[], HX: HeatRun | null = null): Draft => {
    const H = HX ?? HI0!;
    let conf = HX ? "inferred" : H.conf;
    const nts = [...leadNotes, ...H.notes];
    nts.push(`${H.run.length} hit-less faint(s) of ${H.run.map(([a, x]) => x - a).join("/")} s${H.gaps.length ? `, ${H.gaps.join("/")} s apart` : ""}, then died ${H.open ? "during the last one" : "awake"}`);
    if (hpl && truthy(ageOn) && ageOn > 0 && hplHp / ageOn > 0.15 + 0.05 * low300.length) {
      conf = "inferred";
      nts.push(`lost ${f1(hplHp)} HP in ${ageOn} s, more than heat${low300.length ? " plus the stat drain" : " alone"} can take`);
    }
    // a low stat that could have done the final stretch on its own is a competing explanation
    if (low300.length && (hpl == null || ageOn == null || ageOn > 1200 || hplHp / Math.max(ageOn, 1) <= 1.25 * 0.05 * low300.length)) {
      conf = "inferred";
      nts.push(`${low300.join(" and ")} (stat <= 300) was draining health too and could explain the last stretch alone`);
    }
    // On a sand map the engine's silicosis has the identical faint cycle: never better than inferred.
    if (sand) conf = "inferred";
    return out(rule, heatWord, conf, { mech: false, evidence: [...H.ev, prim], notes: nts, co: coOf(co_) });
  };

  const coldOut = (rule: string, conf: Confidence, co_: readonly string[] = [], ev: (StampedLine | null)[] = []): Draft =>
    out(rule, "cold_exposure", conf, { mech: false, evidence: [...ev, prim], notes: [...leadNotes], co: coOf(co_) });

  // The hit that first left HP 15 or less with no recovery above 30, over the whole life.
  const LO = c.lowOrigin();
  const loContrib = LO != null && isPlayerHit(LO) ? [contributor(LO.det.attacker!.name, LO.pid!, "contributor (earlier wound)", "inferred")] : [];
  const upKey = (h: Hit): string =>
    h.cat === "infected" ? "infected" : h.cat === "animal" ? "animal" : h.cat === "vehicle_driver" ? "vehicle_run_over" : h.cat === "player" ? "player" : h.cat;

  const starv = (rule: string, names: readonly Low[], conf: Confidence, co_: readonly string[] = [], upstream: string | null = null): Draft => {
    const cause: InternalCause = names.length === 2 ? "starvation_and_dehydration" : names[0]!;
    return out(rule, cause, conf, {
      mech: false, evidence: [LO?.o, hpl?.o, prim], notes: [...leadNotes], co: coOf(co_),
      upstream, upstreamConf: upstream ? "inferred" : null, contributors: [...loContrib],
    });
  };

  // ---- B10: who took the HP in the last 600 online seconds.
  const silentShare = truthy(DS.total) ? DS.silent! / DS.total : 0;
  const WD = c.descent(600, nLow);
  const wTot = WD.silent != null ? WD.total : null;
  const wshare = (cats: readonly HitCategory[]): number => truthy(wTot) ? pySum(cats.map((k) => WD.logged.get(k) ?? 0)) / wTot : 0.0;
  if (truthy(wTot)) leadNotes.push(`last 600 online s: ${f1(wTot)} HP lost, ${f1(WD.silent)} with no damaging line`);

  /** B09 (a stat below 1) and B16 (a stat at or below 300) share one budget test. */
  const starvFlow = (rule: "B09" | "B16"): Draft => {
    const names = low300;      // both drains are named whenever both stats are at or below 300
    let cap = 0.05 * names.length;
    let basis: "final" | "old" | "life" | null = null;
    let need: number | null = null, fits: boolean | null = null, lifecap: number | null = null;
    const capOver = (secs: number): number => {
      if (secs <= 0) return cap;
      return 0.05 * pySum(names.map((n) => { const t = TLOW.get(n)!; return t != null ? Math.min(secs, t) : secs; })) / secs;
    };
    const recent = hpl != null && ageOn! <= 1200;
    if (recent) {
      basis = "final"; need = hplHp / Math.max(ageOn!, 1);
      cap = capOver(ageOn!);
      fits = ageOn! <= 0 || need <= FIT_TOL * cap;
    } else if (c.fresh && lifeOn != null) {
      // A life that began at a respawn: 100 HP had to go. Each stat falls linearly from its spawn
      // value, so it drains health only for the share of the life it spent at or below 300.
      lifecap = 0.0;
      for (const [v, s0] of [[w, W0], [e, E0]] as const) {
        if (v != null && v <= 300) lifecap += 0.05 * lifeOn * (s0 > 300 ? Math.min(1.0, (300 - v) / (s0 - v)) : 1.0);
      }
      if (hpl != null && lifecap >= 100.0) {
        // an HP reading older than 1200 s is still a reading: a lower bound for the rate needed
        basis = "old"; need = hplHp / Math.max(ageOn!, 1);
        cap = capOver(ageOn!);
        fits = need <= FIT_TOL * cap;
      } else {
        basis = "life"; need = 100.0 / Math.max(lifeOn, 1);
        fits = lifecap >= 100.0;
      }
    } else if (!c.fresh && sakhal && lifeOn != null && c.alive.length > 0 && (c.alive[0]!.kind === "connecting" || c.alive[0]!.kind === "connected")
      && cap * lifeOn < 100 && c.pos && c.pos[2] <= 0.1) {
      // The id's first line opens this life: probably a new character (not provable).
      return coldOut("B20b", "inferred", names);
    } else if (hpl != null) {
      basis = "old"; need = hplHp / Math.max(ageOn!, 1);
      cap = capOver(ageOn!);
      fits = need <= FIT_TOL * cap;
    }
    // upstream: the hit that left HP 15 or less for good, else the last damage
    let up: string | null = null;
    if (LO != null) up = upKey(LO);
    else if (ld && ldAge! <= 600) up = upKey(ld);
    else if (basis === "old" && hpl!.damaging && hpl!.cat !== "self" && hplHp <= 60) up = upKey(hpl!);
    if (basis === "life" && hpl != null && hpl.damaging && hpl.cat !== "self" && up == null && hplHp <= 60) up = upKey(hpl);
    if (basis === "final" || basis === "old") leadNotes.push(`HP ${f1(hplHp)} at the last reading ${ageOn} online s earlier (needed ${need!.toFixed(3)} HP/s, the stat drain gives up to ${cap.toFixed(3)})`);
    else if (basis === "life") leadNotes.push(`${lifeOn} online s since the respawn: the stat drain can account for at most ${f0(lifecap!)} of the 100 HP`);
    // The cold-burn signature from a known spawn, tested before the budget so a low stat cannot hide it.
    let coldBurn = false;
    if (c.fresh && truthy(lifeOn) && lifeOn >= 300 && e != null && w != null && !c.alive.some((o) => o.kind === "teleported")) {
      const er = (E0 - e) / lifeOn, wr = (W0 - w) / lifeOn;
      if (er - wr >= 0.2 && er <= 0.6 && wr >= 0 && sakhal) coldBurn = true;
    }
    if (fits === false) {
      if (HI0 && HI0.run.length >= 2) return heatOut(`${rule}h`, names);
      // The same cycle while creatures were hitting: the silent loss beyond the stat drain needs a
      // second drain, and the faints name it.
      const HX = heatInfo(true);
      if (HX && HX.run.length >= 2 && truthy(wTot) && WD.silent! / wTot >= 0.5) {
        const cre = wshare(CREATURE) >= 0.2 ? [(WD.logged.get("infected") ?? 0) >= (WD.logged.get("animal") ?? 0) ? "infected" : "animal"] : [];
        return heatOut(`${rule}h`, [...names, ...cre], HX);
      }
      if (basis === "life") {
        // A fresh spawn cannot starve that fast; on Sakhal cold is the unlogged drain that fits.
        if (sakhal) return coldOut("B20b", "inferred", names);
        leadNotes.push("life budget does not fit: an unlogged drain or stats that were not reset at respawn are needed");
        if (inSea && seaS >= 290) return starv(rule, names, "inferred", ["cold_exposure"], up);
        return starv(rule, names, "inferred", [], up);
      }
      const ratio = need! / Math.max(cap, 1e-9);
      let second: string | null = null;
      if (HI0) second = heatWord;
      else if (sakhal) second = "cold_exposure";
      // the stat drain covers under half of the final rate: the second drain is the larger one
      if (second === "cold_exposure" && ratio > 2.0) return coldOut("B20f", "inferred", names, hpl ? [hpl.o] : []);
      if (second) return starv(rule, names, rule === "B09" && second === "cold_exposure" ? "strong" : "inferred", [second], up);
      leadNotes.push(`the stat drain covers only ${f0(100 / ratio)}% of the loss, the rest is unlogged`);
      return starv(rule, names, "inferred", [], up);
    }
    let conf: Confidence = rule === "B09" || (fits && basis === "final") ? "strong" : "inferred";
    if (vehSig) conf = "inferred";
    if (hotFood.length) {
      conf = "inferred";
      leadNotes.push(`ate hot food ${c.t0 - last(hotFood)!.ts} s before death: the hunger drain is suspended while digesting`);
    }
    const co_: string[] = [];
    let cyc: [number, number][] = [];
    if (c.t0 >= HEAT_BUILD_TS) {
      const hs = sf.filter(([a, x]) => x - a <= 13 && c.t0 - a <= 900);
      for (let i = 0; i < hs.length - 1; i++) {
        const gap = hs[i + 1]![0] - hs[i]![1];
        if (gap >= 55 && gap <= 130) {
          if (cyc.length === 0) cyc = [hs[i]!];
          cyc.push(hs[i + 1]!);
        }
      }
    }
    if (cyc.length) co_.push(heatWord);
    if (coldBurn) co_.push("cold_exposure");
    return starv(rule, names, conf, co_, up);
  };

  if (ld && ld.hp != null && hpl != null && truthy(wTot)) {
    const finOk = low300.length > 0 && ageOn != null && 0.05 * low300.length * Math.max(ageOn, 1) * FIT_TOL >= hplHp;
    // The creature is the cause when its hits took most of the HP lost in the window, left HP 15
    // or less, and the last stretch is short or covered by the low-stat drain.
    if (isCreature(ld) && ld.hp <= 15 && hplHp <= 15 && wshare(CREATURE) >= 0.5 && (ldAge! <= 120 || finOk)) {
      const cause = (ld.cat === "infected" ? "infected" : `animal_${species(ld.det.source ?? "")}`) as InternalCause;
      return out("B10", cause, ldAge! <= 10 || finOk ? "strong" : "inferred", { mech: false, evidence: [ld, prim], notes: [...leadNotes], co: coOf(low300) });
    }
    if (ld.hp <= 5 && hplHp <= 5 && ldAge! <= 120) {
      if (isPlayerHit(ld) && wshare(["player", "vehicle_driver"]) >= 0.5) {
        return out("B10", "pvp", ldAge! <= 10 || finOk ? "strong" : "inferred", {
          mech: false,
          // ⚠️ The last hit left HP 5 or less: an inferred killer, basis `not_stated`, never printed.
          attributed: att(ld.det.attacker!.name, ld.pid!, "killer (inferred)", "not_stated", ldAge! <= 10 ? "strong" : "inferred"),
          evidence: [ld, prim], notes: [...leadNotes], co: coOf(low300),
        });
      }
      const injury: Partial<Record<HitCategory, InternalCause>> = { fall: "fall", vehicle: "vehicle_impact", vehicle_no_driver: "vehicle_impact", fire: "fire" };
      const cause = injury[ld.cat];
      if (cause && wshare([ld.cat]) >= 0.5) {
        return out("B10", cause, "strong", { mech: false, evidence: [ld, c.openUnc?.u, prim], notes: [...leadNotes], co: coOf(low300) });
      }
    }
  }

  // ---- B09: a stat at zero
  if (low0.length) return starvFlow("B09");

  // ---- B11: finished by a player ("shot, then a tick finished it")
  const ph = c.dmg.filter(isPlayerHit);
  if (ph.length) {
    const p = last(ph)!;
    const gap = c.t0 - p.ts;
    const laterNp = c.dmg.filter((h) => h.ts > p.ts && !isPlayerHit(h));
    if (gap <= 300 && laterNp.length === 0) {
      const ko = c.eps.some((ep) => ep.u.ts - p.ts >= 0 && ep.u.ts - p.ts <= 2);
      const conf: Confidence = p.hp! <= 25 || ko ? "strong" : "inferred";
      return out("B11", "pvp", conf, {
        mech: false, attributed: att(p.det.attacker!.name, p.pid!, "killer (inferred)", "not_stated", conf),
        evidence: [p, prim], notes: [...leadNotes],
      });
    }
  }

  // ---- B12: died while unconscious after a known knock-out
  if (c.openUnc) {
    const u = upstreamOfKo(c, c.openUnc);
    if (u.hits.length && u.conf === "strong") {
      const lh = last(u.hits)!;
      const byKey: Record<string, string> = {
        infected: "infected", animal: lh.cat === "animal" ? `animal_${species(lh.det.source ?? "Wolf")}` : "animal", fall: "fall", player: "pvp",
      };
      const cause = Object.hasOwn(byKey, u.key) ? byKey[u.key] as InternalCause : null;
      if (cause) {
        return out("B12", cause, "inferred", { mech: false, attributed: u.a, evidence: [...u.hits.slice(-1), c.openUnc.u, prim], notes: [...leadNotes] });
      }
    }
  }

  // ---- B13: heatstroke, two or more faints in the run
  if (HI0 && HI0.run.length >= 2) return heatOut("B13", low300);

  const budgetFits = (): boolean | null => {
    if (!low300.length || hpl == null || ageOn! > 1200) return null;
    if (ageOn! <= 0) return true;
    return hplHp / ageOn! <= 1.25 * 0.05 * low300.length;
  };

  const noHit10 = !c.dmg.some((h) => c.t0 - h.ts <= 10 && h.cat !== "vehicle" && h.cat !== "vehicle_no_driver" && h.cat !== "vehicle_driver");
  // ---- B14: a crash killed the crew. Another death (or a knock-out at speed) in the same moment,
  // within 15 m. The other occupant is evidence only.
  if (noHit10 && (co.length || (cok.length && segOk && spd >= 7))) {
    const lines = (co.length ? co.map((x) => x.ref) : cok.map((x) => x.ref)).map((r) => c.server.line(r) ?? null);
    return out("B14", "vehicle_crash_occupant", "strong", { mech: false, evidence: [...lines, prim], notes: [...leadNotes] });
  }

  // ---- B20a: cold water. At or below sea level on consecutive own positions for 290 s or more,
  // healthy stats, no faint, not a drowning line.
  if (inSea && seaS >= 290 && seaRun.length >= 2 && !low300.length && !sf.length && !c.openUnc && noHit10) {
    const at = new Set(seaRun.map((x) => x.ts));
    return coldOut("B20a", "inferred", [], c.alive.filter((o) => o.subject!.pos && at.has(o.ts)).slice(-2));
  }

  const fits = budgetFits();
  // ---- B15: vehicle speed (only a segment of 3 s or more counts)
  if (noHit10 && segOk && spd >= 10 && !(low300.length && fits)) {
    return out("B15", "vehicle_crash_occupant", "inferred", {
      mech: false, evidence: [sp!.line, prim], notes: [...leadNotes, ...(low300.length ? ["a stat is <= 300 but the drain budget does not fit"] : [])],
    });
  }

  // ---- B20c: the cold signature from a known spawn. Energy burned far faster than Water.
  if (c.fresh && truthy(lifeOn) && lifeOn >= 300 && e != null && w != null && !low0.length) {
    const er = (E0 - e) / lifeOn, wr = (W0 - w) / lifeOn;
    if (er - wr >= 0.2 && er <= 0.6 && wr >= 0) {
      const pts = c.ownPositions(lifeOn + 5);
      const still = c.pos ? pts.length >= 3 && Math.max(...pts.slice(1).map((p) => dist2d(p.pos, c.pos!))) <= 3 : false;
      return coldOut("B20c", still && sakhal ? "strong" : "inferred", low300, c.alive.filter((o) => o.kind === "connected").slice(-1));
    }
  }

  // ---- B16: a stat at or below 300
  if (low300.length) return starvFlow("B16");

  // ---- B21: a crash knock-out. A healthy player knocked out with no hit line, then a bare death.
  const crashKo = (): { ep: (typeof c.eps)[number]; dur: number | null; sig: string[] } | null => {
    for (let i = c.eps.length - 1; i >= 0; i--) {
      const ep = c.eps[i]!, u = ep.u;
      if (c.t0 - u.ts > 600) break;
      if (c.koHits(ep).length || (ep.r != null && ep.r.kind === "connected")) continue;
      const dur = ep.r != null ? ep.r.ts - u.ts : null;
      const before = c.hpr.filter((h) => h.ts <= u.ts), after = c.hpr.filter((h) => h.ts > u.ts);
      const hb = before.length ? last(before)!.hp! : c.fresh ? 100.0 : null;
      const healthy = hb != null && hb >= 80;
      const si = c.speedInto(u);
      const arr = si != null && si.speed >= 7 && si.speed <= 45;
      const sig: string[] = [];
      if (arr) sig.push(`reached at ${f1(si!.speed)} m/s over the previous ${si!.dt} s`);
      const a0 = after[0];
      if (healthy && a0 && hb - a0.hp! > 10 && (!a0.damaging || hb - a0.hp! > 2 * (a0.dmg || 0) + 10)) {
        sig.push(`HP ${f0(hb)} before it, ${f1(a0.hp)} on the first hit line after it, with no damaging line for the difference`);
      }
      const onl = c.online(u.ts, c.t0);
      if (healthy && !a0 && onl > 0 && hb / onl > 0.35) sig.push(`HP ${f0(hb)} before it and dead ${c.t0 - u.ts} s after it with no hit line`);
      if (healthy && dur != null && dur >= 13 && dur <= 22) sig.push(`it lasted ${dur} s (crash knock-outs cluster at 19-20 s; heat faints are <= 12 s)`);
      const heatPossible = c.t0 >= HEAT_BUILD_TS && (!c.fresh || lifeOn == null || lifeOn >= 1700) && dur != null && dur <= 13;
      if (sig.length === 0 || (heatPossible && !arr)) continue;
      return { ep, dur, sig };
    }
    return null;
  };
  if (!low300.length && noHit10) {
    const ck = crashKo();
    if (ck) {
      return out("B21", "vehicle_crash_occupant", "inferred", {
        mech: false, evidence: [ck.ep.u, ck.ep.r, prim], notes: [...leadNotes, `knocked out with no hit line ${c.t0 - ck.ep.u.ts} s before death: ${ck.sig.join("; ")}`],
      });
    }
  }

  // ---- B17: a weak vehicle signal (8 m/s or more; 7 to 8 m/s needs a second signal)
  const koRecent = sf.some(([a]) => c.t0 - a <= 600);
  const vehMetab = metab != null && metab < 0.05;
  if (noHit10 && ((segOk && spd >= 8) || (segOk && spd >= 7 && (drift > 5 || koRecent || vehMetab)) || drift > 5 || shortJump)) {
    return out("B17", "vehicle_crash_occupant", "inferred", { mech: false, evidence: [sp?.line, prim], notes: [...leadNotes] });
  }

  // ---- B22 and B20d: a silent drain with healthy stats
  const hasTotal = truthy(DS.total);
  const silRate = hasTotal ? DS.silent! / Math.max(DS.silentS, 1) : 0;
  // `steady` needs at least one silent drop between two real readings
  const steady = hasTotal && DS.silent! >= 20 && silRate >= 0.02 && silRate <= 0.35 && DS.silentS >= 120 && DS.segs.some(([s]) => s >= 10);
  const infectedLogged = DS.logged.get("infected") ?? 0, animalLogged = DS.logged.get("animal") ?? 0;
  const creLogged = hasTotal ? infectedLogged + animalLogged : 0;
  // B22 pneumonia: the engine removes 0.10 HP/s and regen returns 0.005-0.03, so the net silent rate
  // is 0.07-0.095 HP/s whatever the player does.
  const rates: [rate: number, hp: number, secs: number][] = hasTotal
    ? DS.segs.filter(([s, d]) => s >= 3 && d >= 30).map(([s, d]) => [s / Math.max(d, 1), s, d]) : [];
  if (hasTotal && (DS.finalS ?? 0) >= 30 && (DS.finalHp ?? 0) >= 3) rates.push([DS.finalHp! / DS.finalS!, DS.finalHp!, DS.finalS!]);
  const inBand = (x: number): boolean => x >= 0.068 && x <= 0.097;
  const pneu = !low300.length && b === 0 && !sf.length && !c.openUnc && rates.length > 0 && inBand(last(rates)![0])
    && rates.every((x) => x[0] <= 0.097) && rates.some((x) => inBand(x[0]) && x[1] >= 20 && x[2] >= 240) && !marginal.length;
  if (pneu) {
    const up = creLogged >= 5 ? (infectedLogged >= animalLogged ? "infected" : "animal") : null;
    return out("B22", "pneumonia", "inferred", {
      mech: false, evidence: [hpl?.o, prim], notes: [...leadNotes], co: sakhal ? ["cold_exposure"] : [],
      upstream: up, upstreamConf: up ? "inferred" : null,
    });
  }
  if (steady && sakhal && !sf.length && !c.openUnc) {
    const cre = infectedLogged >= animalLogged ? "infected" : "animal";
    // The unlogged drain is the cause; a creature is the co-cause and upstream, never the cause here.
    if (silentShare >= 0.5 || creLogged / DS.total! >= 0.25) {
      const v = coldOut("B20d", "inferred", creLogged / DS.total! >= 0.25 ? [cre] : [], hpl ? [hpl.o] : []);
      if (creLogged >= 5) v.upstream = { cause: cre, confidence: "inferred" };
      return v;
    }
  }

  // ---- B23: seated travel for most of a respawn life (the metabolism), then nothing else logged
  if (vehMetab && noHit10 && !low300.length && !c.dmg.length && !sf.length && !c.openUnc) {
    return out("B23", "vehicle_crash_occupant", "inferred", { mech: false, evidence: [sp?.line, prim], notes: [...leadNotes] });
  }

  // ---- B18: weakened by a creature: a lead only
  if (ld && isCreature(ld) && ld.hp! <= 35 && ldAge! <= 600 && !sf.length) {
    return out("B18", "unknown", "unknown", {
      mech: false, evidence: [ld, prim], notes: [...leadNotes], upstream: ld.cat === "infected" ? "infected" : "animal", upstreamConf: "inferred",
    });
  }

  // ---- B19: unknown
  let up: string | null = null;
  if (ld && isCreature(ld) && ldAge! <= 1200 && ld.hp! <= 60) up = ld.cat === "infected" ? "infected" : "animal";
  if (steady) leadNotes.push(`a steady unlogged HP drain (${f0(DS.silent!)} HP over ${DS.silentS} online s) with healthy stats; illness or temperature would fit`);
  if (c.lifeStart != null && c.t0 - c.lifeStart <= 120) leadNotes.push(`died ${c.t0 - c.lifeStart} s into the life`);
  if (sakhal) leadNotes.push("Sakhal: cold is plausible but temperature is never logged");
  return out("B19", "unknown", "unknown", {
    mech: false, evidence: [...c.alive.slice(-3), prim], notes: [...leadNotes], upstream: up, upstreamConf: up ? "inferred" : null,
  });
}
