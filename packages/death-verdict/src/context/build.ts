import { dist2d, parseEvidenceLine, type HitCategory, type HitInfo, type Pos } from "../evidence/parse.js";
import type { LineRef } from "../types.js";
import { buildRecord, type DeathCluster, type DeathFeatures, type DeathRecord, type DeathRole } from "./cluster.js";
import { indexOf, pyRound, pySum, refKey, type ServerIndex, type StampedLine } from "./server.js";
import { CREATURE, NET_DRAIN, ZONE_F, type SpawnBaseline } from "../classify/tables.js";

export { NET_DRAIN, ZONE_F };

/**
 * The death context: one death and the timeline of the life it ended, as the rules read it.
 * A port of the reference classifier's `Case` (and, through `server`, its `Server`). Members
 * keep the reference's names in camelCase so the two can be read side by side.
 *
 * Nothing here decides a cause. It answers questions the rules ask: what hit the victim and when,
 * how much health each hit took, how long they were online, how fast they were moving.
 */

/** Everything selected for one death. Built by `selectContextLines`; stored as a golden fixture. */
export interface ContextInput {
  serverId: number;
  map: string | null;
  /** The resolved primary line of the death. */
  deathRef: LineRef;
  cluster: DeathCluster;
  /**
   * The selected lines, by file, the files in the order the server wrote them, each line with its
   * UTC second. ⚠️ The time is stored, not recomputed: it can only be worked out from a whole
   * file (see log-clock.ts), and these are a selection.
   */
  files: {
    admFileId: number; name: string; lines: [lineIndex: number, ts: number, text: string][];
    /**
     * The file's number in the order the server booted, counted over ALL the server's files, not
     * only the selected ones. Null or absent when the caller does not know it. Two of them give
     * how many times the server restarted between a trap being set and going off.
     */
    boot?: number | null;
  }[];
  /** Which of those lines were kept because they place a device near the death or near a hit. */
  placements: LineRef[];
  /** Up to 60 earlier deaths of the same player on the server, oldest first. */
  prevDeaths: { ts: number; pos: Pos | null }[];
  /**
   * The ids of the files that are in `files` only through a line handed over from outside the
   * loaded log (an old placement, an old detonation). Absent when there is none. ⚠️ A line of
   * such a file is never one of the victim's own lines, whoever it names: see `ownLinesOf`.
   */
  detached?: number[];
  /**
   * The server's spawn levels, when the caller has its own (see `spawnAt`). Absent: the
   * checked-in table for `serverId`. Not stored in a fixture: a replay of another project's log,
   * whose server ids collide with One Life's, passes that project's table.
   */
  spawnBaselines?: readonly SpawnBaseline[];
}

/**
 * The victim's own lines: the lines they are the subject of, without those from detached files.
 * A detached line is a stray from weeks earlier; spliced into the life it would move the life's
 * start and add a stale health reading.
 */
export function ownLinesOf(S: ServerIndex, pid: string, detached: Iterable<number> | null | undefined): StampedLine[] {
  const own = S.ownLines(pid);
  const skip = new Set(detached ?? []);
  return skip.size === 0 ? own : own.filter((o) => !skip.has(o.admFileId));
}

/** One hit line on the victim. */
export class Hit {
  readonly o: StampedLine;
  readonly ts: number;
  readonly hp: number | null;
  readonly dmg: number | null;
  readonly damaging: boolean;
  readonly cat: HitCategory;
  /** The attacker's id, for a hit by a player. */
  readonly pid: string | null;
  readonly det: HitInfo;

  constructor(o: StampedLine) {
    const h = o.hit!;
    this.o = o; this.ts = o.ts; this.hp = h.hp; this.dmg = h.damage; this.damaging = h.damaging;
    this.cat = h.category; this.pid = h.attacker?.id ?? null; this.det = h;
  }

  /** What the hit was, in the reference's words. INTERNAL: it can hold a gamertag. */
  name(): string {
    const d = this.det;
    switch (this.cat) {
      case "player": case "vehicle_driver": case "self": return `player ${d.attacker!.name}`;
      case "infected": return "infected";
      case "animal": return species(d.source ?? "");
      case "explosion": return `explosion (${d.ammo})`;
      case "fall": return "fall";
      case "trap": return ({ BearTrap: "bear trap", TripwireTrap: "tripwire", LandMineTrap: "land mine" } as Record<string, string>)[d.source ?? ""] ?? String(d.source);
      case "barbed_wire": return `barbed wire (${d.source})`;
      case "enviro": return `hot food (${d.source})`;
      case "vehicle": case "vehicle_no_driver": return `vehicle (${d.source})`;
      default: return `${this.cat} (${d.source ?? "None"})`;
    }
  }
}

export function species(src: string): "infected" | "wolf" | "bear" | "dog" {
  if (src === "Infected") return "infected";
  if (src === "Wolf") return "wolf";
  if (src.includes("Bear")) return "bear";
  return "dog";
}

export interface Episode { u: StampedLine; r: StampedLine | null }

export interface Descent {
  startHp: number | null;
  startTs: number | null;
  /** Health lost to logged hits, by category. */
  logged: Map<HitCategory, number>;
  /** Health that went with no damaging line; null when no reading lies inside the window. */
  silent: number | null;
  silentS: number;
  segs: [lost: number, seconds: number, endTs: number][];
  finalHp: number | null;
  finalS: number | null;
  n: number;
  gain: number;
  total: number | null;
}

export class DeathContext {
  readonly serverId: number;
  readonly map: string | null;
  readonly server: ServerIndex;
  readonly record: DeathRecord;
  readonly cluster: DeathCluster;
  /** The victim's id. */
  readonly pid: string;
  readonly victimName: string;
  readonly prim: StampedLine;
  readonly t0: number;
  readonly pos: Pos | null;
  readonly dl: { line: StampedLine; role: DeathRole }[];
  readonly shape: ReadonlySet<string>;
  readonly killer: DeathRecord["killer"];
  readonly nKillLines: number;
  readonly firstSeq: number;
  readonly lifeStart: number | null;
  readonly features: DeathFeatures;
  readonly prevDeaths: { ts: number; pos: Pos | null }[];
  /** The victim's own lines of this life, before the death lines. */
  readonly life: StampedLine[];
  /** The victim's own lines from the first death line to two seconds after the death. */
  readonly around: StampedLine[];
  /** The alive-form lines of the life, and of the death second up to the primary line. */
  readonly alive: StampedLine[];
  /** The `(DEAD)` lines that are THIS death's body, not an older corpse. */
  readonly corpse: StampedLine[];
  /** Hits on the living victim, by time, the higher HP reading first within a second. */
  readonly hits: Hit[];
  /** The damaging ones, not self-inflicted. */
  readonly dmg: Hit[];
  /** Hits written on the corpse. */
  readonly chits: Hit[];
  /** The lethal-blow candidates: HP 0 on this body within a second of the death, within 0.35 m. */
  readonly fatal: Hit[];
  readonly fatalBefore: Hit[];
  /** Knock-out episodes: the `is unconscious` line and what ended it. */
  readonly eps: Episode[];
  readonly openUnc: Episode | null;
  readonly stats: { water?: number; energy?: number; bleedSources?: number };
  /** Every hit on the living victim that carries an HP reading. */
  readonly hpr: Hit[];
  /** Logged-out intervals of the life. */
  readonly offline: [number, number][];
  readonly firstAliveTs: number | null;
  /** The life began at a death line, so at full health and spawn stats. */
  readonly fresh: boolean;
  /** How many of Water and Energy are at or below 300. */
  readonly nLow: number;
  /** The spawn levels the caller handed over, or null for the checked-in table (see `spawnAt`). */
  readonly spawnTable: readonly SpawnBaseline[] | null;
  private readonly boots: ReadonlyMap<number, number>;

  constructor(lines: readonly StampedLine[], input: Pick<ContextInput, "serverId" | "map" | "cluster" | "prevDeaths" | "detached" | "spawnBaselines">,
    boots: ReadonlyMap<number, number> = new Map()) {
    this.boots = boots;
    this.spawnTable = input.spawnBaselines ?? null;
    const S = indexOf(lines);
    const primary = S.line(input.cluster.primary);
    if (!primary?.subject) throw new Error(`DeathContext: the primary line ${refKey(input.cluster.primary)} is not among the lines`);
    const pid = primary.subject.id;
    const own = ownLinesOf(S, pid, input.detached);
    const r = buildRecord(input.cluster, own, lines);
    this.serverId = input.serverId; this.map = input.map; this.server = S; this.record = r; this.cluster = input.cluster;
    this.pid = pid; this.victimName = r.victimName; this.prim = r.prim; this.t0 = r.t0; this.pos = r.pos; this.dl = r.dl;
    this.shape = new Set(r.shape); this.killer = r.killer; this.nKillLines = r.nKillLines; this.firstSeq = r.firstSeq;
    this.lifeStart = r.lifeStart; this.features = r.features; this.prevDeaths = [...input.prevDeaths];

    this.life = own.filter((o) => (r.prevEndSeq == null || o.seq > r.prevEndSeq) && o.seq < r.firstSeq);
    const after: StampedLine[] = [];
    for (const o of own) {
      if (o.seq < r.firstSeq) continue;
      if (o.ts - this.t0 > 2) break;
      after.push(o);
    }
    this.around = after;
    const dead = (o: StampedLine) => o.subject!.dead;
    this.alive = [...this.life.filter((o) => !dead(o)), ...after.filter((o) => !dead(o) && o.seq < this.prim.seq)];
    this.corpse = [...this.life, ...after].filter((o) => this.isThisCorpse(o));
    // A stable sort, as the reference's: equal keys keep log order.
    this.hits = this.alive.filter((o) => o.kind === "hit" && o.hit).map((o) => new Hit(o))
      .sort((a, b) => a.ts - b.ts || (b.hp ?? 0) - (a.hp ?? 0));
    this.dmg = this.hits.filter((h) => h.damaging && h.cat !== "self");
    this.chits = this.corpse.filter((o) => o.kind === "hit" && o.hit).map((o) => new Hit(o));
    this.fatal = this.chits.filter((h) => h.hp != null && h.hp <= 0 && Math.abs(h.ts - this.t0) <= 1
      && (!(h.o.subject!.pos && this.pos) || dist2d(h.o.subject!.pos, this.pos) <= 0.35));
    this.fatalBefore = this.fatal.filter((h) => h.o.seq < this.prim.seq);

    this.eps = [];
    for (const o of this.alive) {
      const last = this.eps[this.eps.length - 1];
      if (o.kind === "unconscious") this.eps.push({ u: o, r: null });
      // A relog while down ends the episode too: no longer provably unconscious.
      else if ((o.kind === "regained" || o.kind === "connected") && last && last.r == null) last.r = o;
    }
    const lastEp = this.eps[this.eps.length - 1];
    this.openUnc = lastEp && lastEp.r == null ? lastEp : null;
    this.stats = r.stats ?? {};
    this.hpr = this.hits.filter((h) => h.hp != null);

    this.offline = [];
    let prev: StampedLine | null = null;
    for (const o of this.alive) {
      if (o.kind === "connecting") continue;
      if (o.kind === "connected" && prev && o.ts > prev.ts) this.offline.push([prev.ts, o.ts]);
      prev = o;
    }
    // The life is online from `is connected`, not from `is connecting`: queue time is not lived.
    const fa0 = this.alive.find((o) => o.kind !== "connecting") ?? this.alive[0];
    this.firstAliveTs = fa0 ? fa0.ts : null;
    this.fresh = this.lifeStart != null;
    this.nLow = [this.stats.water, this.stats.energy].filter((v) => v != null && v <= 300).length;
  }

  /** A file's number in the order the server booted (see `ContextInput.files`); null when unknown. */
  bootOf(admFileId: number): number | null {
    return this.boots.get(admFileId) ?? null;
  }

  /** Seconds between two instants of this life with the logged-out time removed. */
  online(tA: number, tB: number): number {
    if (tB <= tA) return 0;
    let off = 0;
    for (const [a, b] of this.offline) off += Math.max(0, Math.min(b, tB) - Math.max(a, tA));
    return Math.max(0, tB - tA - off);
  }

  onlineLife(): number | null {
    return this.firstAliveTs == null ? null : this.online(this.firstAliveTs, this.t0);
  }

  /** The health a creature hit removes: printed damage times the zone factor; null when not computable. */
  hitLoss(h: Hit | null): number | null {
    if (!h || !h.damaging || h.dmg == null || !CREATURE.includes(h.cat)) return null;
    const zone = h.det.zone;
    let f = zone != null && Object.hasOwn(ZONE_F, zone) ? ZONE_F[zone] : undefined;
    if (f == null) return null;
    if (h.cat === "infected" && (zone === "Head" || zone === "Brain")) f = 1.0;
    return h.dmg * f;
  }

  /**
   * Health bookkeeping. Splits the health lost into what hit lines account for, by category, and
   * what went with no damaging line ("silent"). Online seconds only.
   *
   * `window` null: the final descent, from the last local maximum of the HP readings to the death.
   * `window` N: the last N online seconds only.
   *
   * Crediting: a creature hit removes its printed damage times the zone factor and the rest of the
   * drop to that reading is silent. A drop that ends on a 0-damage line is silent. A player hit up
   * to 5 online seconds after the previous reading owns the drop; after a longer gap, at most
   * twice its printed damage. Fire, hot food and wire: at most 10. Sources that print no figure
   * own the drop less what the low stats drain over the gap. The last reading to the death is
   * always silent: no line took it.
   *
   * `nLow` is the number of low stats the drain allowance counts. The bare-death rules pass their
   * own count, which leaves out a stat that crossed 300 too recently to drain anything (the
   * reference overwrites `c.n_low` before it measures the descent).
   */
  descent(window: number | null = null, nLow: number = this.nLow): Descent {
    const pts: { ts: number; hp: number; h: Hit | null }[] = this.hpr.map((h) => ({ ts: h.ts, hp: h.hp!, h }));
    if (this.fresh && this.firstAliveTs != null) pts.unshift({ ts: this.firstAliveTs, hp: 100.0, h: null });
    const res: Descent = {
      startHp: null, startTs: null, logged: new Map(), silent: 0.0, silentS: 0, segs: [], finalHp: null, finalS: null,
      n: pts.length, gain: 0.0, total: null,
    };
    if (pts.length === 0) return res;
    let k = pts.length - 1;
    if (window == null) while (k > 0 && pts[k - 1]!.hp >= pts[k]!.hp - 2.0) k -= 1;
    else k = 0;
    res.startHp = pts[k]!.hp; res.startTs = pts[k]!.ts;
    let silent = 0.0;
    for (let i = k; i < pts.length - 1; i++) {
      const a = pts[i]!, b = pts[i + 1]!, h = b.h!;
      const ageB = this.online(b.ts, this.t0);
      if (window != null && ageB > window) continue;
      const loss = Math.max(0.0, a.hp - b.hp);
      let dt = this.online(a.ts, b.ts);
      let lg = 0.0;
      if (h.damaging && h.cat !== "self") {
        const exact = this.hitLoss(h);
        if (exact != null) {
          lg = dt > 1 ? Math.min(loss, exact) : loss;
          // A same-second drop far above the hit: something else took the rest.
          if (dt <= 1 && loss > exact * 1.3 + 0.5) lg = exact;
        } else if (dt <= 5) lg = loss;
        else if (h.dmg != null) lg = Math.min(loss, 2 * h.dmg);
        else if (h.cat === "fire" || h.cat === "enviro" || h.cat === "barbed_wire" || h.cat === "heat") lg = Math.min(loss, 10.0);
        else lg = Math.max(0.0, loss - NET_DRAIN[Math.min(nLow, 2)]! * dt);
        res.logged.set(h.cat, (res.logged.get(h.cat) ?? 0) + lg);
      }
      let sil = loss - lg;
      if (window != null && dt > 0) {
        const inside = Math.min(dt, Math.max(0, window - ageB));
        sil = sil * inside / dt;
        dt = inside;
      }
      if (a.hp < b.hp && (window == null || this.online(a.ts, this.t0) <= window)) res.gain += b.hp - a.hp;
      if (sil > 1.0) {
        silent += sil;
        res.silentS += dt;
        res.segs.push([pyRound(sil, 1), dt, b.ts]);
      } else if (window != null) silent += sil;
    }
    const lastPt = pts[pts.length - 1]!;
    res.finalHp = lastPt.hp;
    res.finalS = this.online(lastPt.ts, this.t0);
    if (window == null || res.finalS <= window) {
      silent += res.finalHp;
      res.silentS += res.finalS;
    } else {
      res.silent = null;      // no reading inside the window: nothing can be split
      return res;
    }
    res.silent = silent;
    res.total = silent + pySum(res.logged.values());
    return res;
  }

  /** The damaging hit that first brought HP to 15 or less in the trailing run of readings that
   *  never recovered above 30. Null when no logged hit left the victim that low. */
  lowOrigin(): Hit | null {
    const run: Hit[] = [];
    for (let i = this.hpr.length - 1; i >= 0; i--) {
      if (this.hpr[i]!.hp! > 30) break;
      run.push(this.hpr[i]!);
    }
    run.reverse();
    return run.find((h) => h.hp! <= 15 && h.damaging && h.cat !== "self") ?? null;
  }

  /** Metres along the victim's own position lines in this life; null if a relog or teleport breaks it. */
  pathLen(): number | null {
    let tot = 0.0, prev: Pos | null = null;
    for (const o of this.alive) {
      if (o.kind === "disconnected" || o.kind === "teleported") return null;
      if (o.kind === "connected" && prev) return null;
      const p = o.subject!.pos;
      if (p) {
        if (prev) tot += dist2d(prev, p);
        prev = p;
      }
    }
    if (!prev || !this.pos) return null;
    return tot + dist2d(prev, this.pos);
  }

  /**
   * The explosion hit lines of the death second that are on THIS body: living-form lines, (DEAD)
   * lines within 0.35 m of the death position, and (DEAD) lines within 1 m (ragdoll drift) unless
   * an earlier death of the same player lies within 1 m of that line — an older corpse.
   */
  bodyBlasts(): { mine: Hit[]; otherBodies: number } {
    const mine: Hit[] = [];
    let other = 0;
    for (const h of this.hits) if (h.cat === "explosion" && Math.abs(h.ts - this.t0) <= 1) mine.push(h);
    for (const o of [...this.life, ...this.around]) {
      if (!o.subject!.dead || o.kind !== "hit" || Math.abs(o.ts - this.t0) > 1 || !o.text.includes("hit by explosion") || !o.hit) continue;
      const h = new Hit(o);
      if (h.cat !== "explosion") continue;
      const sp = o.subject!.pos;
      const d = sp && this.pos ? dist2d(sp, this.pos) : 0.0;
      if (d <= 0.35) mine.push(h);
      else if (d <= 1.0
        && !this.prevDeaths.some((p) => this.t0 - p.ts <= 6 * 3600 && p.pos && dist2d(p.pos, sp!) <= 1.0)
        && !this.life.some((q) => q.subject!.dead && q.subject!.pos && q.ts < this.t0 - 1 && dist2d(q.subject!.pos, sp!) <= 0.5)) mine.push(h);
      else other += 1;
    }
    return { mine, otherBodies: other };
  }

  /** Own alive position lines of the current session in the last `secs` seconds. */
  ownPositions(secs: number): { ts: number; pos: Pos }[] {
    const out: { ts: number; pos: Pos }[] = [];
    for (let i = this.alive.length - 1; i >= 0; i--) {
      const o = this.alive[i]!, p = o.subject!.pos;
      if (this.t0 - o.ts > secs || o.kind === "connected" || o.kind === "connecting" || o.kind === "disconnected" || o.kind === "teleported") {
        if (o.kind === "connected" && p && this.t0 - o.ts <= secs) out.push({ ts: o.ts, pos: p });
        break;
      }
      if (p) out.push({ ts: o.ts, pos: p });
    }
    return out.reverse();
  }

  /** Straight-line speed from the previous own position (at least `minS` earlier, same session) to line `o`. */
  speedInto(o: StampedLine, minS = 3, maxS = 330): { speed: number; dt: number } | null {
    const to = o.subject!.pos;
    if (!to) return null;
    for (let i = this.alive.length - 1; i >= 0; i--) {
      const p = this.alive[i]!;
      if (p.seq >= o.seq) continue;
      if (p.kind === "disconnected" || p.kind === "teleported" || p.kind === "connecting") return null;
      const dt = o.ts - p.ts;
      if (dt > maxS) return null;
      if (p.subject!.pos && dt >= minS) return { speed: dist2d(p.subject!.pos, to) / dt, dt };
      if (p.kind === "connected") return null;
    }
    return null;
  }

  /** A (DEAD) line of the victim that belongs to this death's body, not an older corpse. */
  isThisCorpse(o: StampedLine): boolean {
    if (!o.subject!.dead || o.ts < this.t0 - 1) return false;
    return !(this.pos && o.subject!.pos && dist2d(o.subject!.pos, this.pos) > 2.0);
  }

  /** The last damaging hit, when it lies within `within` seconds of the death. */
  lastDmg(within: number | null = null): Hit | null {
    const h = this.dmg[this.dmg.length - 1];
    if (!h) return null;
    return within == null || this.t0 - h.ts <= within ? h : null;
  }

  koHits(ep: Episode, lo = -3, hi = 1): Hit[] {
    return this.dmg.filter((h) => ep.u.ts + lo <= h.ts && h.ts <= ep.u.ts + hi);
  }

  /** What caused a knock-out: a label, how sure, and the hits it rests on. */
  koSource(ep: Episode): { label: string | null; confidence: "strong" | "inferred" | "unknown"; hits: Hit[] } {
    let hs = this.koHits(ep);
    let confidence: "strong" | "inferred" = "strong";
    if (hs.length === 0) {
      hs = this.dmg.filter((h) => ep.u.ts - 30 <= h.ts && h.ts < ep.u.ts - 3).slice(-1);
      confidence = "inferred";
    }
    if (hs.length === 0) return { label: null, confidence: "unknown", hits: [] };
    return { label: this.srcLabel(hs), confidence, hits: hs };
  }

  srcLabel(hs: readonly Hit[]): string {
    return [...new Set(hs.map((h) => h.name()))].join(" + ");
  }

  /** The players among some hits: id -> gamertag. */
  playersIn(hs: readonly Hit[]): Map<string, string> {
    const out = new Map<string, string>();
    for (const h of hs) if (h.cat === "player" || h.cat === "vehicle_driver") out.set(h.pid!, h.det.attacker!.name);
    return out;
  }

  /** Closed knock-outs with no hit around them: `[unconscious, regained]` seconds. */
  spontFaints(): [number, number][] {
    const out: [number, number][] = [];
    for (const ep of this.eps) {
      if (!ep.r) continue;
      if (this.dmg.some((h) => ep.u.ts - 3 <= h.ts && h.ts <= ep.u.ts + 1)) continue;
      out.push([ep.u.ts, ep.r.ts]);
    }
    return out;
  }

  /** Speed over the last own-position segment ending at the death. A 2 s segment is returned only
   *  for a jump of 20 m or more; callers must treat under 3 s as weak. */
  finalSpeed(): { speed: number; secs: number; dist: number; line: StampedLine } | null {
    if (!this.pos) return null;
    let best: { speed: number; secs: number; dist: number; line: StampedLine } | null = null;
    for (let i = this.alive.length - 1; i >= 0; i--) {
      const o = this.alive[i]!;
      if (o.kind === "disconnected" || o.kind === "teleported" || o.kind === "connecting") break;
      const dt = this.t0 - o.ts;
      if (dt > 900) break;
      if (o.subject!.pos && dt >= 2) {
        const d = dist2d(o.subject!.pos, this.pos);
        if (dt >= 3 || d >= 20) {
          const cand = { speed: d / dt, secs: dt, dist: d, line: o };
          if (!best || (cand.speed > best.speed && cand.speed <= 45)) best = cand;
          if (dt >= 3) break;
        }
      }
      if (o.kind === "connected") break;
    }
    return best;
  }

  maxRecentSpeed(secs = 600): number {
    let best = 0;
    let prev: StampedLine | null = null;
    for (const o of this.alive) {
      if (o.kind === "connected" || o.kind === "connecting" || o.kind === "disconnected" || o.kind === "teleported") {
        prev = o.kind === "connected" && o.subject!.pos ? o : null;
        continue;
      }
      if (!o.subject!.pos || this.t0 - o.ts > secs) continue;
      if (prev && o.ts - prev.ts >= 3) {
        best = Math.max(best, dist2d(prev.subject!.pos!, o.subject!.pos) / (o.ts - prev.ts));
        prev = o;
      } else if (!prev) prev = o;
    }
    return best;
  }
}

/** Turns a stored selection back into parsed, time-stamped lines, in log order. */
export function linesOfInput(input: Pick<ContextInput, "files">): StampedLine[] {
  const out: StampedLine[] = [];
  for (const f of input.files) {
    for (const [lineIndex, ts, text] of f.lines) out.push({ ...parseEvidenceLine(f.admFileId, lineIndex, text), seq: out.length, ts });
  }
  return out;
}

/** The context of one death, from the lines selected for it. */
export function buildDeathContext(input: ContextInput): DeathContext {
  const boots = new Map<number, number>();
  for (const f of input.files) if (f.boot != null) boots.set(f.admFileId, f.boot);
  return new DeathContext(linesOfInput(input), input, boots);
}
