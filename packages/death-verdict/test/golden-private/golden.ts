import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { goldenLayout, loadCorpora, readFixtures, type Fixture, type Project } from "../../scripts/golden-io.js";
import {
  dist2d, isDetonation, lowerBound, refKey, trapAnchors, upperBound,
  type DeathContext, type Hit, type ServerCorpus, type StampedLine,
} from "../../src/index.js";
import type { GoldenOutcome } from "../../scripts/golden-reporter.js";

declare module "vitest" {
  interface TaskMeta {
    /** Set by the parity test; the golden reporter carries it into the run file. Counts only. */
    goldenOutcome?: GoldenOutcome;
  }
}

/**
 * Shared by the private suites of the evidence port: where the golden data is, how it is loaded,
 * and the digest of a death context that is compared with the reference's.
 *
 * ⚠️ PRIVATE DATA. A failure message here may hold a count and the name of a field, never a uid,
 * a callsign, an id, a position or a line. Set `DEATH_GOLDEN_DEBUG=1` on your own machine to see
 * which deaths differ; never paste that output anywhere public.
 */
export const GOLD = process.env.DEATH_GOLDEN_DIR;
export const layout = GOLD ? goldenLayout(GOLD) : null;

/** True when the named inputs exist. Unset or incomplete: the suite skips with a notice — or
 *  fails, under `pnpm run golden`, which sets DEATH_GOLDEN_REQUIRED. */
export function goldenReady(suite: string, ...paths: (string | null | undefined)[]): boolean {
  const ready = GOLD != null && paths.every((p) => p != null && existsSync(p));
  if (ready) return true;
  if (process.env.DEATH_GOLDEN_REQUIRED) throw new Error(`[${suite}] DEATH_GOLDEN_REQUIRED is set but the private golden data is not available.`);
  console.warn(GOLD
    ? `[${suite}] SKIPPED — DEATH_GOLDEN_DIR is set but an input of this suite is missing.`
    : `[${suite}] SKIPPED — DEATH_GOLDEN_DIR is unset. This gate runs only where the private golden data is.`);
  return false;
}

const corpora = new Map<Project, Map<number, ServerCorpus>>();
export function corpusOf(project: Project): Map<number, ServerCorpus> {
  let c = corpora.get(project);
  if (!c) { c = loadCorpora(project === "OL" ? layout!.ol : layout!.cw); corpora.set(project, c); }
  return c;
}

let ol: Fixture[] | null = null, cw: Fixture[] | null = null;
export const olFixtures = (): Fixture[] => (ol ??= readFixtures(layout!.olFixtures));
export const cwFixtures = (): Fixture[] => (cw ??= readFixtures(layout!.cwFixtures));

export const readGz = <T,>(path: string): T => JSON.parse(gunzipSync(readFileSync(path)).toString("utf8")) as T;

/** Reports which deaths failed without naming them, unless asked to on a private machine. */
export function report(what: string, failed: { uid: string; why: string }[]): string {
  if (failed.length === 0) return "";
  if (process.env.DEATH_GOLDEN_DEBUG) for (const f of failed.slice(0, 40)) console.error(`[debug] ${what}: ${f.uid}: ${f.why}`);
  const fields = [...new Set(failed.map((f) => f.why.split(" ")[0]))].sort().slice(0, 12).join(", ");
  return `${what}: ${failed.length} death(s) differ (${fields})`;
}

const ref = (o: StampedLine | null | undefined): string | null => (o ? refKey(o) : null);
const refs = (xs: readonly StampedLine[]): (string | null)[] => xs.map(ref);
const hitRefs = (xs: readonly Hit[]) => refs(xs.map((h) => h.o));
const digestOf = (xs: readonly StampedLine[]) => [xs.length, createHash("sha1").update(refs(xs).join(",")).digest("hex")];

/**
 * Everything a death context holds, in the shape `tools/dump_context.py` (private) writes for the
 * reference. Field names are the reference's, so the two files can be compared key by key.
 */
export function contextDigest(c: DeathContext): Record<string, unknown> {
  const r = c.record, S = c.server, k = r.killer, f = r.features;
  const d = (x: ReturnType<DeathContext["descent"]>) => ({
    start_hp: x.startHp, start_ts: x.startTs, logged: Object.fromEntries(x.logged), silent: x.silent, silent_s: x.silentS,
    segs: x.segs, final_hp: x.finalHp, final_s: x.finalS, n: x.n, gain: x.gain, total: x.total,
  });
  const classes = new Set(S.placed.map((p) => p.className));
  const fs = c.finalSpeed(), si = c.speedInto(c.prim), lo = c.lowOrigin(), bb = c.bodyBlasts();
  const prev = r.prevEndSeq == null ? null : S.lines[r.prevEndSeq]!;
  const out = {
    record: {
      shape: r.shape, pos: r.pos, pos_source: r.posSource,
      stats: r.stats ? { water: r.stats.water, energy: r.stats.energy, bleed_sources: r.stats.bleedSources } : null,
      n_kill_lines: r.nKillLines, victim_id: r.victimId, victim: r.victimName,
      prev_death_ref: prev ? [prev.admFileId, prev.lineIndex] : null,
      killer: k ? {
        kind: k.kind, subkind: k.subkind, raw: k.raw, id: k.id, gamertag: k.name, dead: k.dead, self: k.self,
        weapon: k.weapon, distance: k.distance, distance_raw: k.distanceRaw,
      } : null,
      features: {
        knockouts: f.knockouts.map((e) => [e.uncDtS, e.regainDtS, e.koHitSources, e.koHitMinHp, refKey(e.ref)]),
        segments: f.segments,
        final_segment: f.finalSegment ? {
          from_dt_s: f.finalSegment.fromDtS, dist_m: f.finalSegment.distM, speed_mps: f.finalSegment.speedMps,
          ...(f.finalSegment.endsDtS != null ? { ends_dt_s: f.finalSegment.endsDtS } : {}),
        } : null,
        max_speed_600s: f.maxSpeed600s,
        co_deaths: f.coDeaths.map((x) => [x.victimId, x.dtS, x.distM, x.primaryKind, refKey(x.ref)]),
        co_knockouts: f.coKnockouts.map((x) => [x.id, x.dtS, x.distM, refKey(x.ref)]),
        corpse_drift_30s_m: f.corpseDrift30sM, corpse_drift_dt_s: f.corpseDriftDtS,
      },
      death_lines: r.dl.map((x) => [refKey(x.line), x.role]),
    },
    t0: c.t0, prim: ref(c.prim), life_start: c.lifeStart,
    prev_deaths: c.prevDeaths.map((p) => [p.ts, p.pos]),
    life: digestOf(c.life), around: refs(c.around), alive: digestOf(c.alive), corpse: refs(c.corpse),
    hits: c.hits.map((h) => [ref(h.o), h.hp, h.cat, h.dmg, h.damaging, h.pid, h.name(), c.hitLoss(h)]),
    dmg: hitRefs(c.dmg), chits: hitRefs(c.chits), fatal: hitRefs(c.fatal), fatal_before: hitRefs(c.fatalBefore),
    eps: c.eps.map((e) => [ref(e.u), ref(e.r)]),
    open_unc: c.openUnc ? ref(c.openUnc.u) : null,
    hpr: c.hpr.length, offline: c.offline, first_alive_ts: c.firstAliveTs, fresh: c.fresh, n_low: c.nLow,
    online_life: c.onlineLife(),
    descent: d(c.descent()), descent600: d(c.descent(600)),
    low_origin: lo ? ref(lo.o) : null,
    path_len: c.pathLen(),
    body_blasts: [hitRefs(bb.mine), bb.otherBodies],
    own_positions600: c.ownPositions(600).map((p) => [p.ts, p.pos]),
    speed_into_prim: si ? [si.speed, si.dt] : null,
    final_speed: fs ? [fs.speed, fs.secs, fs.dist, ref(fs.line)] : null,
    max_recent_speed: c.maxRecentSpeed(),
    spont_faints: c.spontFaints(),
    last_dmg: ref(c.lastDmg()?.o), last_dmg120: ref(c.lastDmg(120)?.o),
    ko_source: c.eps.map((e) => { const s = c.koSource(e); return [s.label, s.confidence, hitRefs(s.hits)]; }),
    players_in_dmg: Object.fromEntries(c.playersIn(c.dmg)),
    others_150: c.pos ? Object.fromEntries([...S.othersNear(c.pid, c.pos, c.t0 - 120, c.t0 + 2, 150)].map(([id, v]) => [id, v.dist])) : {},
    others_50_living: c.pos ? [...S.othersNear(c.pid, c.pos, c.t0 - 60, c.t0 + 2, 50, { livingAt: { ts: c.t0, seq: c.firstSeq } }).keys()].sort() : [],
    others_300_any: c.pos ? [...S.othersNear(c.pid, c.pos, c.t0 - 300, c.t0 + 300, 300, { aliveOnly: false }).keys()].sort() : [],
    placed_25: c.pos ? S.placedNear(c.pos, classes, 25, c.firstSeq).map((p) => [ref(p.line), p.dist, p.className]) : [],
    placed_25_1h: c.pos ? S.placedNear(c.pos, classes, 25, c.firstSeq, 3600, c.t0).map((p) => [ref(p.line), p.dist, p.className]) : [],
    window_60: refs(S.window(c.t0 - 60, c.t0)),
    above_prim: c.prim.seq > 0 ? ref(S.lines[c.prim.seq - 1]) : null,
  };
  return JSON.parse(JSON.stringify(out)) as Record<string, unknown>;
}

/**
 * What the SELECTION exists to keep, read straight off a context: the lines the rules of the later
 * steps will ask for along the whole life, not only around the death. The sufficiency suite
 * compares it between the selected lines and the whole log.
 *
 * ⚠️ The numbers are written out here on purpose (20 m and 60 s, 1200 s, 30 m, 15 m and 5 m, 600 s) and
 * NOT imported from select.ts: they are what the design says the rules may read. Narrow a window
 * in select.ts and this probe finds lines in the whole log that the selection no longer holds.
 * `contextDigest` cannot see that: everything it probes lies within five minutes of the death.
 */
export function selectionProbe(c: DeathContext): Record<string, unknown> {
  const S = c.server, pid = c.pid, t0 = c.t0;
  const lived = [...c.life, ...c.around];
  // company: another player's line within 20 m and 60 s of one of the victim's own, anywhere in the life
  const pts = lived.filter((o) => o.subject!.pos).map((o) => ({ ts: o.ts, pos: o.subject!.pos! })).sort((a, b) => a.ts - b.ts);
  const ptTs = pts.map((p) => p.ts);
  const company: string[] = [];
  if (pts.length) {
    for (const o of S.window(ptTs[0]! - 60, t0 + 60)) {
      if (o.positions.length === 0 || o.subject?.id === pid) continue;
      const lo = lowerBound(ptTs, o.ts - 60), hi = upperBound(ptTs, o.ts + 60);
      let near = false;
      for (let i = lo; i < hi && !near; i++) near = o.positions.some((p) => dist2d(p, pts[i]!.pos) <= 20);
      if (near) company.push(refKey(o));
    }
  }
  // mentions: lines that name the victim without being about them, twenty minutes back
  const mentions = (S.any.get(pid) ?? []).map((s) => S.lines[s]!)
    .filter((o) => o.subject?.id !== pid && o.ts >= t0 - 1200 && o.ts <= t0 + 300).map(refKey);
  // placements of any age within 30 m of the death or of any hit line on the victim
  const anchors = [...(c.pos ? [c.pos] : []), ...lived.filter((o) => o.kind === "hit" && o.subject!.pos).map((o) => o.subject!.pos!)];
  const placements = S.placed.filter((p) => anchors.some((a) => dist2d(a, p.line.subject!.pos!) <= 30)).map((p) => refKey(p.line));
  // the credit ring of a trap death: that kind of device within 15 m, and every time one went off within 5 m since
  const ring: Record<string, unknown> = {};
  const victimAlive = c.life.filter((o) => !o.subject!.dead && o.seq < c.prim.seq);
  for (const { cls, anchor } of trapAnchors(victimAlive, c.record)) {
    const placed = S.placed.filter((p) => p.className === cls && p.line.seq < c.firstSeq && dist2d(p.line.subject!.pos!, anchor) <= 15);
    const spots = [anchor, ...placed.map((p) => p.line.subject!.pos!)];
    const since = placed.length ? Math.min(...placed.map((p) => p.line.seq)) : c.firstSeq;
    const spent: string[] = [];
    for (let s = since; s < c.firstSeq; s++) {
      const o = S.lines[s]!, at = o.subject?.pos;
      if (at && isDetonation(o, cls) && spots.some((sp) => dist2d(sp, at) <= 5)) spent.push(refKey(o));
    }
    ring[cls] = { placed: placed.map((p) => refKey(p.line)), spent };
  }
  // the whole server, whoever the line is about, from ten minutes before the death to five after
  const server = S.window(t0 - 600, t0 + 300).map(refKey);
  return { company, mentions, placements, ring, server };
}

/**
 * The paths at which two JSON values differ. ⚠️ Numbers are compared EXACTLY, floats included: the
 * port's arithmetic is the reference's to the last bit (see `pyHypot`), and the rules compare
 * distances with thresholds, so "nearly equal" would hide a different verdict.
 */
export function differences(a: unknown, b: unknown, path = ""): string[] {
  if (typeof a === "number" && typeof b === "number") return a === b ? [] : [path];
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return a === b ? [] : [path];
  if (Array.isArray(a) !== Array.isArray(b)) return [path];
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return [`${path}.length`];
    return a.flatMap((x, i) => differences(x, b[i], `${path}[]`));
  }
  const ka = Object.keys(a as object), kb = Object.keys(b as object);
  const keys = [...new Set([...ka, ...kb])];
  return keys.flatMap((key) => differences((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${path ? `${path}.` : ""}${/^[0-9A-F]{40}$/.test(key) ? "*" : key}`));
}
