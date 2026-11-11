import { dist2d, isPlayerId, type KillerInfo, type Pos } from "../evidence/parse.js";
import type { LineRef } from "../types.js";
import { indexOf, lowerBound, PRIMARY_KINDS, pyRound, refKey, refOf, type ServerIndex, type StampedLine } from "./server.js";

/**
 * The death cluster: the one to several lines the server writes for one death, and the facts the
 * rules dispatch on. A port of the reference's `group_deaths`, the record half of
 * `build_records`, `own_segments` and `life_features`.
 *
 * One death is often several lines: `committed suicide` then `died.`; `died.` then `bled out`;
 * the same `killed by` line four times. The cluster says which lines are one death and which of
 * them is the PRIMARY line — the line the verdict is stored under and every key joins on.
 *
 * ⚠️ The primary is the first `killed`, `died` or `drowned` line, a `killed by` line preferred.
 * A `committed suicide` line is NEVER the primary, although the event parser treats it as a
 * death and for a firearm suicide it is the first line written. So the line a death was folded
 * from is not always its primary: always resolve the cluster from whatever line you hold.
 */

/** The roles the reference gives a line. The first eight are the ones a stored verdict can hold. */
export type DeathRole =
  | "primary" | "primary_extra" | "suicide_before" | "suicide_after" | "bled_out"
  | "disconnect_uncon" | "disconnect_restrained" | "respawn_alive"
  // rare orders the reference also names
  | "suicide_alive_late" | "suicide_dead_before" | "bled_out_before" | "respawn_alive_late"
  | "disconnect_uncon_late" | "disconnect_restrained_late"
  // ⚠️ never part of a cluster: a corpse's owner pressing respawn. Kept only on the full group.
  | "respawn_dead";

export interface DeathCluster {
  /** The resolved primary line. */
  primary: LineRef;
  /** Every line of the death in log order, `respawn_dead` left out. */
  lines: { ref: LineRef; role: DeathRole }[];
}

/** A marker counts toward a death that follows within this many seconds. */
export const CLUSTER_BEFORE_S = 120;
/** A second death line, a `bled out` or a `committed suicide` joins a death this soon after it. */
export const CLUSTER_JOIN_S = 30;

interface Group { pid: string; lines: { line: StampedLine; role: DeathRole }[] }

/**
 * Groups ONE player's lines into deaths. The reference walks a whole server, but keeps its state
 * per id, so walking one id's lines gives the same groups.
 *
 * ⚠️ Port, not a design: the odd corners are the reference's and the golden answers depend on
 * them. The gap that decides `primary_extra` is measured from the group's FIRST line, which can
 * be a marker written up to two minutes before the death line.
 */
export function groupDeaths(victimLines: readonly StampedLine[]): Group[] {
  const groups: Group[] = [];
  let open: Group | null = null;                       // dead, awaiting the respawn connect
  let pending: { line: StampedLine; role: DeathRole }[] = [];   // markers awaiting a death line
  for (const o of victimLines) {
    if (!o.subject || !isPlayerId(o.subject.id)) continue;
    const k = o.kind, dead = o.subject.dead;
    if (k === "connected" || k === "connecting") { open = null; pending = []; continue; }
    if (PRIMARY_KINDS.has(k)) {
      if (open) {
        if (o.ts - open.lines[0]!.line.ts <= CLUSTER_JOIN_S) { open.lines.push({ line: o, role: "primary_extra" }); continue; }
        // Dead, no connect seen, and another death line much later: the log lost the respawn.
        open = null;
      }
      const g: Group = { pid: o.subject.id, lines: [] };
      for (const p of pending) {
        const gap = o.ts - p.line.ts;
        if ((gap >= 0 && gap <= CLUSTER_BEFORE_S) || Math.abs(gap) <= 2) g.lines.push(p);
      }
      pending = [];
      g.lines.push({ line: o, role: "primary" });
      groups.push(g);
      open = g;
      continue;
    }
    const sinceLast = open ? Math.abs(o.ts - open.lines[open.lines.length - 1]!.line.ts) : Infinity;
    const sinceFirst = open ? o.ts - open.lines[0]!.line.ts : Infinity;
    if (k === "suicide") {
      if (open && sinceLast <= CLUSTER_JOIN_S) open.lines.push({ line: o, role: dead ? "suicide_after" : "suicide_alive_late" });
      else pending.push({ line: o, role: dead ? "suicide_dead_before" : "suicide_before" });
      continue;
    }
    if (k === "bled_out") {
      if (open && sinceLast <= CLUSTER_JOIN_S) open.lines.push({ line: o, role: "bled_out" });
      else pending.push({ line: o, role: "bled_out_before" });
      continue;
    }
    if (k === "respawn") {
      if (dead) { if (open) open.lines.push({ line: o, role: "respawn_dead" }); }
      else if (open && sinceFirst <= 2) open.lines.push({ line: o, role: "respawn_alive_late" });
      else pending.push({ line: o, role: "respawn_alive" });
      continue;
    }
    if (k === "disc_uncon" || k === "disc_restrained") {
      const base = k === "disc_restrained" ? "disconnect_restrained" : "disconnect_uncon";
      if (open && sinceFirst <= 2) open.lines.push({ line: o, role: `${base}_late` });
      else pending.push({ line: o, role: base });
      continue;
    }
    // Any other line of this player: stale markers are forgotten.
    if (pending.length) pending = pending.filter((p) => o.ts - p.line.ts <= CLUSTER_BEFORE_S);
    // An alive line from a player believed dead: a new life whose connect was never logged.
    if (open && !dead && k !== "disconnected" && sinceFirst > 5) open = null;
  }
  return groups;
}

const bySeq = (g: Group) => [...g.lines].sort((a, b) => a.line.seq - b.line.seq);

/** The line the death is keyed on: the first death line, a `killed by` line preferred. */
function primaryOf(g: Group): StampedLine {
  const rl = bySeq(g);
  const prims = rl.filter((x) => x.role === "primary" || x.role === "primary_extra").map((x) => x.line);
  return prims.find((o) => o.kind === "killed") ?? rl.find((x) => x.role === "primary")!.line;
}

function groupOf(victimLines: readonly StampedLine[], ref: LineRef): { groups: Group[]; at: number } {
  const groups = groupDeaths(victimLines);
  const key = refKey(ref);
  const at = groups.findIndex((g) => g.lines.some((x) => x.role !== "respawn_dead" && refKey(x.line) === key));
  return { groups, at };
}

function toCluster(g: Group): DeathCluster {
  const primary = primaryOf(g);
  return {
    primary: refOf(primary),
    lines: bySeq(g).filter((x) => x.role !== "respawn_dead")
      .map((x) => ({ ref: refOf(x.line), role: x.line === primary ? "primary" : x.role })),
  };
}

/**
 * The death a line belongs to. Any line of the cluster is a valid seed — the `committed suicide`
 * line, the `bled out` line and the death line all resolve to the same cluster.
 *
 * `victimLines` are the lines the victim is the subject of, in log order, reaching back at least
 * to the first line of the victim's previous death. Throws when the seed is not part of a death.
 */
export function resolveCluster(victimLines: readonly StampedLine[], seed: LineRef): DeathCluster {
  const { groups, at } = groupOf(victimLines, seed);
  if (at < 0) throw new Error(`resolveCluster: line ${refKey(seed)} is not part of a death`);
  return toCluster(groups[at]!);
}

/** Every death of this player in the lines, oldest first. */
export const allClusters = (victimLines: readonly StampedLine[]): DeathCluster[] => groupDeaths(victimLines).map(toCluster);

const lastSeqOf = (g: Group): number => Math.max(...g.lines.filter((x) => x.role !== "respawn_dead").map((x) => x.line.seq));

/**
 * Where the life that ended in this death began: the `seq` of the last line of the victim's
 * previous death, or null when the lines hold no earlier death. The life is every line after it.
 *
 * ⚠️ The LAST line of the previous cluster, not its primary, and `respawn_dead` does not count:
 * a `bled out` written a second after the previous death belongs to that death, while the
 * corpse's `is choosing to respawn` is already the new life's business.
 */
export function previousClusterEnd(victimLines: readonly StampedLine[], cluster: DeathCluster): number | null {
  const { groups, at } = groupOf(victimLines, cluster.primary);
  if (at < 0) throw new Error(`previousClusterEnd: line ${refKey(cluster.primary)} is not part of a death`);
  return at === 0 ? null : lastSeqOf(groups[at - 1]!);
}

// ------------------------------------------------------------------------------------------------

export interface DeathRecord {
  victimId: string;
  /** The name on the primary line. */
  victimName: string;
  prim: StampedLine;
  /** The death second, UTC. */
  t0: number;
  /** The death position: the primary line's, else the victim's last readable one before it. */
  pos: Pos | null;
  posSource: "death_line" | "last_valid_before_death" | null;
  /** The death lines in log order, the resolved primary marked `primary`. Unlike the cluster this
   *  keeps `respawn_dead` lines, as the reference does. */
  dl: { line: StampedLine; role: DeathRole }[];
  /** The reference's shape tags, in its order. The rules dispatch on a few of them. */
  shape: string[];
  killer: KillerInfo | null;
  nKillLines: number;
  firstSeq: number;
  /** The `seq` of the last line of the victim's previous death; null for a first life. */
  prevEndSeq: number | null;
  /** When the life began: the time of that line. */
  lifeStart: number | null;
  stats: { water: number; energy: number; bleedSources: number } | null;
  features: DeathFeatures;
}

export interface DeathFeatures {
  knockouts: { uncDtS: number; regainDtS: number | null; koHitSources: string[]; koHitMinHp: number | null; ref: LineRef }[];
  /** The victim's last own-position segments: `[from, to, metres, m/s]`, times relative to death. */
  segments: [number, number, number, number][];
  finalSegment: { fromDtS: number; distM: number; speedMps: number; endsDtS?: number } | null;
  maxSpeed600s: number | null;
  /** Another player's bare death within 2 s and 15 m. */
  coDeaths: { victimId: string; name: string; dtS: number; distM: number; primaryKind: string; ref: LineRef }[];
  /** Another player knocked out within 2 s and 15 m. */
  coKnockouts: { id: string; name: string; dtS: number; distM: number; ref: LineRef }[];
  /** How far the body was later logged from where it died. A body only moves with a vehicle. */
  corpseDrift30sM: number;
  corpseDriftDtS: number | null;
}

const TRAP_HIT_WINDOW_S = 120;
const EXPLOSIVE_WORDS = /grenade|claymore|landmine|land mine|plastic[ _]explosive|improvised|fuelstation|explosive|firework|gascanister/i;

// The primaries of every death in a list of lines, and every knock-out, in ten-second buckets.
interface Nearby {
  deaths: Map<number, { ts: number; pos: Pos | null; pid: string; line: StampedLine }[]>;
  knockouts: Map<number, StampedLine[]>;
}
const nearbyCache = new WeakMap<ServerIndex, Nearby>();
function nearbyOf(S: ServerIndex): Nearby {
  let n = nearbyCache.get(S);
  if (n) return n;
  n = { deaths: new Map(), knockouts: new Map() };
  for (const [, seqs] of S.own) {
    for (const g of groupDeaths(seqs.map((s) => S.lines[s]!))) {
      const po = g.lines.find((x) => x.role === "primary")!.line;
      const b = Math.floor(po.ts / 10);
      if (!n.deaths.has(b)) n.deaths.set(b, []);
      n.deaths.get(b)!.push({ ts: po.ts, pos: po.subject!.pos, pid: g.pid, line: po });
    }
  }
  // The reference lists deaths in the order their groups were opened: by primary line.
  for (const list of n.deaths.values()) list.sort((a, b) => a.line.seq - b.line.seq);
  for (const o of S.lines) {
    if (o.kind !== "unconscious" || !o.subject || o.subject.dead) continue;
    const b = Math.floor(o.ts / 10);
    if (!n.knockouts.has(b)) n.knockouts.set(b, []);
    n.knockouts.get(b)!.push(o);
  }
  nearbyCache.set(S, n);
  return n;
}

/** Speed segments from the victim's own alive position lines, at least 3 s apart, never across a
 *  connect, a disconnect or a teleport. */
function ownSegments(ownLife: readonly StampedLine[], t0: number, maxAgeS = 900): { segs: [number, number, number, number][]; last: StampedLine | null } {
  const segs: [number, number, number, number][] = [];
  let prev: StampedLine | null = null;
  for (const o of ownLife) {
    if (o.kind === "connected" || o.kind === "connecting" || o.kind === "disconnected" || o.kind === "teleported") {
      prev = o.kind === "connected" && o.subject!.pos ? o : null;
      continue;
    }
    if (o.subject!.dead || !o.subject!.pos || t0 - o.ts > maxAgeS) continue;
    if (!prev) { prev = o; continue; }
    const dt = o.ts - prev.ts;
    if (dt < 3) continue;
    const d = dist2d(prev.subject!.pos!, o.subject!.pos);
    segs.push([prev.ts - t0, o.ts - t0, pyRound(d, 1), pyRound(d / dt, 2)]);
    prev = o;
  }
  return { segs, last: prev };
}

function lifeFeatures(S: ServerIndex, ownLife: readonly StampedLine[], pid: string, t0: number, pos: Pos | null,
  ownAfter: readonly StampedLine[]): DeathFeatures {
  const eps: DeathFeatures["knockouts"] = [];
  const hitTs = ownLife.filter((o) => o.kind === "hit" && !o.subject!.dead && o.hit?.damaging).map((o) => ({ ts: o.ts, h: o.hit! }));
  for (const o of ownLife) {
    if (t0 - o.ts > 1800 || o.subject!.dead) continue;
    if (o.kind === "unconscious") {
      const near = hitTs.filter((x) => o.ts - 3 <= x.ts && x.ts <= o.ts + 1).map((x) => x.h);
      const hps = near.map((h) => h.hp).filter((v): v is number => v != null);
      eps.push({
        uncDtS: o.ts - t0, regainDtS: null,
        koHitSources: [...new Set(near.map((h) => h.label + (h.label === "player" ? `:${h.attacker!.id}` : "")))].sort(),
        koHitMinHp: hps.length ? Math.min(...hps) : null, ref: refOf(o),
      });
    } else if (o.kind === "regained" && eps.length && eps[eps.length - 1]!.regainDtS == null) {
      eps[eps.length - 1]!.regainDtS = o.ts - t0;
    }
  }
  const { segs, last } = ownSegments(ownLife, t0);
  let final: DeathFeatures["finalSegment"] = null;
  if (last && pos && last.subject!.pos && !last.subject!.dead) {
    const dt = t0 - last.ts;
    if (dt >= 3) {
      const d = dist2d(last.subject!.pos, pos);
      final = { fromDtS: -dt, distM: pyRound(d, 1), speedMps: pyRound(d / dt, 2) };
    } else if (segs.length) {
      const [a, b, d, v] = segs[segs.length - 1]!;
      final = { fromDtS: a, distM: d, speedMps: v, endsDtS: b };
    }
  }
  // Co-deaths: another id's death within 2 s and 15 m. Co-knock-outs likewise.
  const coDeaths: DeathFeatures["coDeaths"] = [], coKnockouts: DeathFeatures["coKnockouts"] = [];
  if (pos) {
    const near = nearbyOf(S), b = Math.floor(t0 / 10);
    for (const bucket of [b, b - 1, b + 1]) {
      for (const d of near.deaths.get(bucket) ?? []) {
        if (d.pid !== pid && Math.abs(d.ts - t0) <= 2 && d.pos && dist2d(d.pos, pos) <= 15) {
          coDeaths.push({ victimId: d.pid, name: d.line.subject!.name, dtS: d.ts - t0, distM: pyRound(dist2d(d.pos, pos), 1), primaryKind: d.line.kind, ref: refOf(d.line) });
        }
      }
    }
    for (const bucket of [b, b - 1, b + 1]) {
      for (const o of near.knockouts.get(bucket) ?? []) {
        const p2 = o.subject!.pos;
        if (o.subject!.id !== pid && Math.abs(o.ts - t0) <= 2 && p2 && dist2d(p2, pos) <= 15) {
          coKnockouts.push({ id: o.subject!.id, name: o.subject!.name, dtS: o.ts - t0, distM: pyRound(dist2d(p2, pos), 1), ref: refOf(o) });
        }
      }
    }
  }
  // Corpse drift. ⚠️ The post-death `has been disconnected` line never carries (DEAD) but reports
  // the body's position, so it is measured too — but only within 60 s and 60 m: later or further
  // it is not always the body.
  let drift = 0, driftDt: number | null = null;
  if (pos) {
    for (const o of ownAfter) {
      if (o.kind === "connected" || o.kind === "connecting") break;
      const after = o.ts - t0, sp = o.subject!.pos, dead = o.subject!.dead;
      if (sp && ((dead && after >= 0 && after <= 30) || (o.kind === "disconnected" && !dead && after > 0 && after <= 120))) {
        const d = dist2d(sp, pos);
        if (o.kind === "disconnected" && !dead && (after > 60 || d > 60)) continue;
        if (d > drift) { drift = d; driftDt = after; }
      }
    }
  }
  const speeds = segs.filter(([a]) => a >= -600).map(([, , , v]) => v).concat(final ? [final.speedMps] : []);
  return {
    knockouts: eps.slice(-12), segments: segs.slice(-6), finalSegment: final,
    maxSpeed600s: speeds.length ? Math.max(...speeds) : null,
    coDeaths, coKnockouts, corpseDrift30sM: pyRound(drift, 1), corpseDriftDtS: driftDt,
  };
}

/**
 * The record of one death: the facts the rules dispatch on.
 *
 * `victimLines` are the victim's own lines and `serverLines` every line in hand (the selection
 * for this death, or a whole server's log); both carry the `seq` of `serverLines`.
 */
export function buildRecord(cluster: DeathCluster, victimLines: readonly StampedLine[], serverLines: readonly StampedLine[]): DeathRecord {
  const S = indexOf(serverLines);
  const { groups, at } = groupOf(victimLines, cluster.primary);
  if (at < 0) throw new Error(`buildRecord: line ${refKey(cluster.primary)} is not part of a death`);
  const g = groups[at]!;
  const pid = g.pid;
  const rl = bySeq(g);
  const primary = primaryOf(g);
  const allPrim = rl.filter((x) => x.role === "primary" || x.role === "primary_extra").map((x) => x.line);
  const t0 = primary.ts;
  const firstSeq = rl[0]!.line.seq;
  const roles = rl.map((x) => x.role);
  const has = (...r: DeathRole[]) => r.some((x) => roles.includes(x));

  const shape: string[] = [];
  const killer = primary.kind === "killed" ? primary.killer ?? null : null;
  if (killer) {
    shape.push(`killed_by:${killer.kind}`);
    if (killer.self) shape.push("self_kill");
    if (killer.dead) shape.push("killer_dead_flag");
  } else shape.push(primary.kind);
  for (const o of allPrim) if (o !== primary) shape.push(`extra_primary:${o.kind}`);
  if (has("suicide_before")) shape.push("suicide_alive_then_died");          // firearm order
  if (has("suicide_after", "suicide_dead_before")) shape.push("suicide_died_then_dead_line");   // blade order
  if (has("suicide_alive_late")) shape.push("suicide_alive_line_after_death");
  if (roles.some((r) => r.startsWith("suicide"))) shape.push("suicide");
  if (roles.some((r) => r.startsWith("bled_out"))) shape.push("bled_out");
  if (has("respawn_alive", "respawn_alive_late")) shape.push("respawn_alive_form");
  if (has("respawn_dead")) shape.push("respawn_dead_form");
  if (has("disconnect_uncon", "disconnect_uncon_late")) shape.push("disconnect_unconscious");
  if (has("disconnect_restrained", "disconnect_restrained_late")) shape.push("disconnect_restrained");

  const stats = allPrim.find((o) => o.stats)?.stats ?? null;

  const own = victimLines;
  const cut = lowerBound(own.map((o) => o.seq), firstSeq);
  let pos = primary.subject!.pos;
  let posSource: DeathRecord["posSource"] = pos ? "death_line" : null;
  if (!pos) {
    for (let i = cut - 1; i >= 0; i--) {
      if (own[i]!.subject!.pos) { pos = own[i]!.subject!.pos; posSource = "last_valid_before_death"; break; }
    }
  }

  // The life: the victim's own lines after the previous death's last line.
  const prevEndSeq = at === 0 ? null : lastSeqOf(groups[at - 1]!);
  const ownLife = own.slice(0, cut).filter((o) => prevEndSeq == null || o.seq > prevEndSeq);
  const lifeStart = prevEndSeq == null ? null : S.lines[prevEndSeq]!.ts;

  const isThisCorpse = (o: StampedLine): boolean => {
    if (!o.subject!.dead || o.ts < t0 - 1) return false;
    return !(pos && o.subject!.pos && dist2d(o.subject!.pos, pos) > 2.0);
  };

  // A mechanical digest of the victim's hit lines in the last two minutes, only as far as the
  // shape tags need it: explosion and trap hits, and the HP-0 lines of the death second on this body.
  const mentions = S.any.get(pid) ?? [];
  const mCut = lowerBound(mentions, firstSeq);
  const seenAfter = mentions.slice(mCut).filter((s) => S.lines[s]!.ts - t0 <= 2).slice(0, 400)
    .map((s) => S.lines[s]!).filter((o) => o.subject?.id === pid);
  const lastDt = new Map<string, number>();
  const fatalSources: string[] = [];
  for (const o of [...ownLife, ...seenAfter]) {
    const dt = o.ts - t0;
    if (o.subject!.dead && o.kind !== "emote" && !isThisCorpse(o)) continue;
    if (o.kind === "emote" && o.tail!.includes("EmoteSuicide") && o.seq < firstSeq) continue;
    if (dt < -TRAP_HIT_WINDOW_S || o.kind !== "hit" || !o.hit) continue;
    const h = o.hit;
    const key = h.label === "player" ? `player:${h.attacker!.id}`
      : h.label === "explosion" ? `explosion:${h.ammo}`
      : h.label === "fall" ? "fall"
      : `${h.label}:${h.source}${h.ammo ? `/${h.ammo}` : ""}`;
    lastDt.set(key, dt);
    if (o.subject!.dead && h.hp != null && h.hp <= 0) {
      const d = o.subject!.pos && pos ? pyRound(dist2d(o.subject!.pos, pos), 2) : null;
      if (Math.abs(dt) <= 1 && (d == null || d <= 0.35) && fatalSources.length < 12) fatalSources.push(key);
    }
  }
  const isExpl =
    (killer != null && (killer.kind === "explosive" || (killer.kind === "unnamed" && killer.subkind === "explosive_item")))
    || (killer != null && killer.kind === "entity_other" && EXPLOSIVE_WORDS.test(killer.weapon ?? ""))
    || [...lastDt].some(([k, dt]) => (k.startsWith("explosion:") || k.startsWith("trap:")) && dt >= -30);
  if (isExpl) shape.push("explosive_or_trap_context");

  const nKillLines = allPrim.filter((o) => o.kind === "killed").length;
  if (nKillLines > 1) shape.push("multi_kill_lines");
  const fatalExpl = fatalSources.some((s) => s.startsWith("explosion:")), fatalPlayer = fatalSources.some((s) => s.startsWith("player:"));
  if (killer?.weapon === "(MeleeFist)" && fatalExpl && !fatalPlayer) shape.push("fist_kill_with_fatal_explosion");
  if (killer?.kind === "explosive" && !fatalExpl && fatalPlayer) shape.push("explosive_kill_line_with_fatal_player_hit");

  const ownAfter = mentions.slice(mCut, mCut + 400).map((s) => S.lines[s]!).filter((o) => o.subject?.id === pid);
  return {
    victimId: pid, victimName: primary.subject!.name, prim: primary, t0, pos, posSource,
    dl: rl.map((x) => ({ line: x.line, role: x.line === primary ? "primary" : x.role })), shape, killer, nKillLines,
    firstSeq, prevEndSeq, lifeStart, stats,
    features: lifeFeatures(S, ownLife, pid, t0, pos, ownAfter),
  };
}

/** The time and place of a death, which is all a later death needs to know about an earlier one. */
export function deathAnchor(cluster: DeathCluster, victimLines: readonly StampedLine[]): { ts: number; pos: Pos | null } {
  const byKey = new Map(victimLines.map((o) => [refKey(o), o]));
  const primary = byKey.get(refKey(cluster.primary))!;
  let pos = primary.subject!.pos;
  if (!pos) {
    const first = byKey.get(refKey(cluster.lines[0]!.ref))!;
    for (let i = victimLines.indexOf(first) - 1; i >= 0; i--) {
      if (victimLines[i]!.subject!.pos) { pos = victimLines[i]!.subject!.pos; break; }
    }
  }
  return { ts: primary.ts, pos };
}
