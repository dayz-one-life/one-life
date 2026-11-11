import {
  orderFiles, stampDetached, stampLines, zoneForServer, bootFromName, type LogFile, type ZoneRule,
} from "../evidence/log-clock.js";
import { dist2d, isDetonation, parseEvidenceLine, type Pos, type TrapClass } from "../evidence/parse.js";
import type { LineRef } from "../types.js";
import { DeathContext, ownLinesOf, type ContextInput } from "./build.js";
import { allClusters, buildRecord, CLUSTER_BEFORE_S, deathAnchors, resolveCluster, type DeathCluster } from "./cluster.js";
import { indexOf, lowerBound, refKey, refOf, upperBound, type StampedLine } from "./server.js";

/**
 * The ONE rule for which lines of a server's log a death needs. The fixture builder and (later)
 * the database loader both call it, so what is tested is what runs.
 *
 * Selection is anchored on the victim's whole LIFE, not only on where they died: rules look at
 * the hit that first left them low an hour earlier, at who stood beside them when they were tied
 * up, at a trap set weeks before.
 *
 * ⚠️ Changing a window here changes what the classifier can see. The private sufficiency suite
 * classifies every golden death from the selection and from the whole log and requires the same
 * answer; run it after any change.
 */

/** Every line on the server this long before the death, whoever it is about. */
export const SERVER_WINDOW_BEFORE_S = 600;
/** ... and this long after it. */
export const SERVER_WINDOW_AFTER_S = 300;
/** Another player's line is "company" when it is this close to one of the victim's own lines ... */
export const COMPANY_RADIUS_M = 20;
/** ... and this near it in time, anywhere in the life. */
export const COMPANY_WINDOW_S = 60;
/** Lines that mention the victim without being about them, this far back. */
export const MENTION_WINDOW_S = 1200;
/** A placement is kept when it is this near the death or any hit on the victim, at any age. */
export const PLACEMENT_RADIUS_M = 30;
/** How many earlier deaths of the same player are carried as (time, place). */
export const PREV_DEATHS_MAX = 60;
/** A trap's placement is a candidate for the kill within this distance of where it went off. */
export const CREDIT_RADIUS_M = 5;
/** Other placements of the same kind are looked for this far out. */
export const CREDIT_RING_M = 15;
export { CLUSTER_BEFORE_S };

/** The files of one server, each whole. */
export interface ServerCorpus {
  serverId: number;
  map: string | null;
  /** The zone the log's clock is in. Defaults to the table in log-clock.ts, by server id. */
  zone?: ZoneRule;
  /**
   * `servers.clock_offset_ms`, when the caller has it. Read ONLY for a server the zone table does
   * not know, and only to choose a zone rule (see `zoneForServer`). ⚠️ A loader should pass it,
   * and log when `isKnownServer(serverId)` is false, so a new server gets a line in the table.
   */
  clockOffsetMs?: number | null;
  files: LogFile[];
}

/**
 * A line from a file that is NOT in the corpus: an old `placed` line, or an old line of a trap
 * going off. Traps outlive restarts by weeks, so the loader finds these by position and hands
 * them over one by one, in any order. `approxTs` is any rough time for the line (a day's accuracy
 * is enough); the second comes from the line itself.
 *
 * - `fileName` must carry the file's start date (`DayZServer_X1_x64_<date>_<time>.ADM`): it is how
 *   the file is placed among the others. ⚠️ A line that cannot be dated is REFUSED with an error,
 *   never dropped: a second placer's wire that silently vanished would leave "exactly one placer".
 * - `ts` is the line's exact UTC second, for a caller that stamped the line's whole file with
 *   `stampLines`. Needed only when `detachedIsAmbiguous` says the line is in the hour written
 *   twice on a clock-change night; without it such a line may be stamped an hour early.
 * - A line whose subject is the victim is kept as a placement or a detonation like any other,
 *   but it never joins the victim's life (see `ContextInput.detached`).
 */
export interface ExtraLine { admFileId: number; fileName: string; lineIndex: number; text: string; approxTs?: number | null; ts?: number | null }

/** What only the caller can know about a death. */
export interface SelectOptions {
  /**
   * Earlier deaths of the same player from BEFORE the files in the corpus, in any order. The
   * corpus only yields the deaths written in its own files; a loader that starts at the previous
   * death's file must pass the older ones here (sixty are enough), or the older-corpse test of
   * `bodyBlasts` loses them. One the corpus also holds is ignored: the corpus's reading wins.
   */
  earlierDeaths?: readonly { ts: number; pos: Pos | null }[];
  /**
   * Each file's number in the order the server booted, counted over ALL the server's files: file
   * id -> number. Pass it when the corpus is only part of the server's log (a loader), and include
   * the files of the extra lines. Left out, the files of the corpus are numbered in their own
   * order — right when the corpus is the whole log — and a file known only through an extra line
   * has no number.
   */
  bootOrdinals?: ReadonlyMap<number, number>;
}

/** The boot number of each file (see `SelectOptions.bootOrdinals`). */
function bootsOf(corpus: ServerCorpus, opts: SelectOptions): ReadonlyMap<number, number> {
  return opts.bootOrdinals ?? new Map(orderFiles(corpus.files).map((f, i) => [f.admFileId, i]));
}

const stamped = new WeakMap<ServerCorpus, StampedLine[]>();

/** Every line of the corpus, parsed and time-stamped, in the order the server wrote it. */
export function stampCorpus(corpus: ServerCorpus, extraLines: readonly ExtraLine[] = []): StampedLine[] {
  if (extraLines.length === 0) {
    const hit = stamped.get(corpus);
    if (hit) return hit;
  }
  const zone = corpus.zone ?? zoneForServer(corpus.serverId, corpus.clockOffsetMs);
  const have = new Set(corpus.files.map((f) => f.admFileId));
  // Files only known through an extra line: placed among the others by the date in their name.
  const detached = new Map<number, { boot: number; lines: { lineIndex: number; text: string; ts: number }[] }>();
  for (const x of extraLines) {
    if (have.has(x.admFileId)) continue;
    const boot = bootFromName(x.fileName);
    const ts = boot == null ? null : x.ts ?? stampDetached(x.fileName, x.text, zone, x.approxTs ?? null);
    if (boot == null || ts == null) {
      throw new Error(`stampCorpus: the extra line ${x.admFileId}:${x.lineIndex} cannot be dated (its file name has no start date, or the line no clock)`);
    }
    if (!detached.has(x.admFileId)) detached.set(x.admFileId, { boot, lines: [] });
    const f = detached.get(x.admFileId)!;
    if (!f.lines.some((l) => l.lineIndex === x.lineIndex)) f.lines.push({ lineIndex: x.lineIndex, text: x.text, ts });
  }
  const parts: { boot: number; admFileId: number; lines: { lineIndex: number; text: string; ts: number }[] }[] = [];
  let previous: number | null = null;
  for (const f of orderFiles(corpus.files)) {
    const lines = stampLines(f, zone, previous);
    if (lines.length) previous = lines[lines.length - 1]!.ts;
    parts.push({ boot: f.bootLocal, admFileId: f.admFileId, lines });
  }
  for (const [admFileId, f] of detached) parts.push({ boot: f.boot, admFileId, lines: f.lines.sort((a, b) => a.lineIndex - b.lineIndex) });
  parts.sort((a, b) => a.boot - b.boot || a.admFileId - b.admFileId);
  const out: StampedLine[] = [];
  for (const p of parts) for (const l of p.lines) out.push({ ...parseEvidenceLine(p.admFileId, l.lineIndex, l.text), seq: out.length, ts: l.ts });
  if (extraLines.length === 0) stamped.set(corpus, out);
  return out;
}

interface Resolved {
  all: StampedLine[]; own: StampedLine[]; pid: string; cluster: DeathCluster;
  previous: DeathCluster | null; prevDeaths: { ts: number; pos: Pos | null }[];
  /** The ids of the files known only through an extra line. */
  detached: Set<number>;
}

function resolve(corpus: ServerCorpus, seed: LineRef, extraLines: readonly ExtraLine[], opts: SelectOptions): Resolved {
  const all = stampCorpus(corpus, extraLines);
  const S = indexOf(all);
  const seedLine = S.line(seed);
  if (!seedLine?.subject) throw new Error(`selectContextLines: line ${refKey(seed)} is not in the corpus or names no player`);
  const pid = seedLine.subject.id;
  const have = new Set(corpus.files.map((f) => f.admFileId));
  const detached = new Set(extraLines.map((x) => x.admFileId).filter((id) => !have.has(id)));
  // ⚠️ The victim's OWN lines come from the corpus only. A stray old line of theirs from outside
  // (their own trap, a wire they tripped in another life) is evidence about the place, not a
  // piece of this life: it must not move the life's start or add a stale health reading.
  const own = ownLinesOf(S, pid, detached);
  const cluster = resolveCluster(own, seed);
  const clusters = allClusters(own);
  const at = clusters.findIndex((c) => refKey(c.primary) === refKey(cluster.primary));
  const inCorpus = deathAnchors(clusters.slice(Math.max(0, at - PREV_DEATHS_MAX), at), own);
  // Handed-over deaths count only when they are older than every death the corpus itself holds.
  const before = deathAnchors([clusters[0]!], own)[0]!.ts;
  const older = [...(opts.earlierDeaths ?? [])].filter((d) => d.ts < before).sort((a, b) => a.ts - b.ts)
    .map((d) => ({ ts: d.ts, pos: d.pos }));
  const prevDeaths = [...older, ...inCorpus].slice(-PREV_DEATHS_MAX);
  return { all, own, pid, cluster, previous: at > 0 ? clusters[at - 1]! : null, prevDeaths, detached };
}

/** What the death's own lines say could have been a trap, and where it went off. `victimAlive` are
 *  the victim's living-form lines of this life, before the primary line. */
export function trapAnchors(victimAlive: readonly StampedLine[], record: ReturnType<typeof buildRecord>): { cls: TrapClass; anchor: Pos }[] {
  const out: { cls: TrapClass; anchor: Pos }[] = [];
  if (!record.killer) return out;
  const trips = victimAlive.filter((o) => o.hit?.label === "trap" && o.hit.source === "TripwireTrap" && record.t0 - o.ts >= 0 && record.t0 - o.ts <= 6);
  const trip = trips[trips.length - 1];
  const tripAnchor = trip ? trip.subject!.pos ?? record.pos : null;
  if (tripAnchor) out.push({ cls: "TripwireTrap", anchor: tripAnchor });
  if (record.killer.weapon === "LandMineTrap" && record.pos) out.push({ cls: "LandMineTrap", anchor: record.pos });
  return out;
}

/**
 * Selects the lines one death needs. `seed` is any line of the death's cluster. `extraLines` are
 * lines from files outside the corpus that may matter (see `ExtraLine`); they go through the same
 * distance tests as everything else.
 *
 * ⚠️ What a database loader must hand over, because the corpus cannot know it:
 * - `opts.earlierDeaths`: the player's deaths from before the first file loaded;
 * - `corpus.clockOffsetMs` (or `corpus.zone`) for a server the zone table does not name;
 * - `extraLines` for placements and detonations in files it did not load, each with a dated file
 *   name, and with `ts` when `detachedIsAmbiguous` is true for it;
 * - `opts.bootOrdinals` when the corpus is only part of the server's log, or the restarts between
 *   a trap being set and going off cannot be counted.
 */
export function selectContextLines(corpus: ServerCorpus, seed: LineRef, extraLines: readonly ExtraLine[] = [], opts: SelectOptions = {}): ContextInput {
  const { all, own, pid, cluster, previous, prevDeaths, detached } = resolve(corpus, seed, extraLines, opts);
  const S = indexOf(all);
  const record = buildRecord(cluster, own, all);
  const { t0, pos, firstSeq, prevEndSeq } = record;
  const keep = new Set<number>();

  // 1. The victim's life, whole, in every file — and the lines of the previous death, so the
  //    cluster and the start of the life resolve the same way from the selection. After the
  //    death, the victim's lines as far as the server window reaches.
  const fromSeq = previous ? S.idx.get(refKey(previous.lines[0]!.ref))! : -1;
  for (const o of own) if (o.seq >= fromSeq && (o.seq < firstSeq || o.ts <= t0 + SERVER_WINDOW_AFTER_S)) keep.add(o.seq);

  // 2. The whole server around the death, no distance filter.
  for (const o of S.window(t0 - SERVER_WINDOW_BEFORE_S, t0 + SERVER_WINDOW_AFTER_S)) keep.add(o.seq);

  // 3. Company along the life: anyone logged close to one of the victim's own lines, close in time.
  const life = own.filter((o) => (prevEndSeq == null || o.seq > prevEndSeq) && o.ts <= t0 + 2);
  const pts = life.filter((o) => o.subject!.pos).map((o) => ({ ts: o.ts, pos: o.subject!.pos! })).sort((a, b) => a.ts - b.ts);
  if (pts.length) {
    const ptTs = pts.map((p) => p.ts);
    for (const o of S.window(ptTs[0]! - COMPANY_WINDOW_S, t0 + COMPANY_WINDOW_S)) {
      if (o.positions.length === 0 || o.subject?.id === pid || keep.has(o.seq)) continue;
      const lo = lowerBound(ptTs, o.ts - COMPANY_WINDOW_S), hi = upperBound(ptTs, o.ts + COMPANY_WINDOW_S);
      company: for (let i = lo; i < hi; i++) {
        for (const p of o.positions) if (dist2d(p, pts[i]!.pos) <= COMPANY_RADIUS_M) { keep.add(o.seq); break company; }
      }
    }
  }

  // 4. Lines that mention the victim without being about them (the victim as the attacker).
  for (const s of S.any.get(pid) ?? []) {
    const o = all[s]!;
    if (o.subject?.id !== pid && o.ts >= t0 - MENTION_WINDOW_S && o.ts <= t0 + SERVER_WINDOW_AFTER_S) keep.add(s);
  }

  // 5. Placements, at any age: near the death, or near any hit on the victim in this life.
  //    ⚠️ EVERY hit line, not only the damaging ones: a tripwire's own `TripWireHit` takes no
  //    health, and it is the line a trap's owner is looked for around.
  const placements: LineRef[] = [];
  const anchors: Pos[] = pos ? [pos] : [];
  for (const o of life) if (o.kind === "hit" && o.subject!.pos) anchors.push(o.subject!.pos);
  for (const p of S.placed) {
    const at = p.line.subject!.pos!;
    if (anchors.some((a) => dist2d(a, at) <= PLACEMENT_RADIUS_M)) { keep.add(p.line.seq); placements.push(refOf(p.line)); }
  }

  // 6. The credit ring (a death by tripwire or land mine only): every placement of that kind of
  //    device around the spot, and every time one went off there since the oldest of them.
  const victimAlive = life.filter((o) => !o.subject!.dead && o.seq < record.prim.seq);
  for (const { cls, anchor } of trapAnchors(victimAlive, record)) {
    const ring = S.placed.filter((p) => p.className === cls && p.line.seq < firstSeq && dist2d(p.line.subject!.pos!, anchor) <= CREDIT_RING_M);
    if (ring.length === 0) continue;
    for (const p of ring) if (!keep.has(p.line.seq)) { keep.add(p.line.seq); placements.push(refOf(p.line)); }
    const since = Math.min(...ring.map((p) => p.line.seq));
    const spots = [anchor, ...ring.map((p) => p.line.subject!.pos!)];
    for (let s = since; s < firstSeq; s++) {
      const o = all[s]!;
      const at = o.subject?.pos;
      if (at && isDetonation(o, cls) && spots.some((sp) => dist2d(sp, at) <= CREDIT_RADIUS_M)) keep.add(s);
    }
  }

  // Back to files, in the order the server wrote them.
  const names = new Map(corpus.files.map((f) => [f.admFileId, f.name]));
  for (const x of extraLines) if (!names.has(x.admFileId)) names.set(x.admFileId, x.fileName);
  const boots = bootsOf(corpus, opts);
  const files: ContextInput["files"] = [];
  for (const s of [...keep].sort((a, b) => a - b)) {
    const o = all[s]!;
    let f = files[files.length - 1];
    if (!f || f.admFileId !== o.admFileId) {
      f = { admFileId: o.admFileId, name: names.get(o.admFileId) ?? "", lines: [], boot: boots.get(o.admFileId) ?? null };
      files.push(f);
    }
    f.lines.push([o.lineIndex, o.ts, o.text]);
  }
  placements.sort((a, b) => S.idx.get(refKey(a))! - S.idx.get(refKey(b))!);
  const input: ContextInput = { serverId: corpus.serverId, map: corpus.map, deathRef: cluster.primary, cluster, files, placements, prevDeaths };
  const keptDetached = files.map((f) => f.admFileId).filter((id) => detached.has(id));
  if (keptDetached.length) input.detached = keptDetached;
  return input;
}

/**
 * The same death read from the WHOLE corpus, with nothing left out. Only for checking that the
 * selection is sufficient: the two contexts must give the same verdict.
 */
export function wholeCorpusContext(corpus: ServerCorpus, seed: LineRef, extraLines: readonly ExtraLine[] = [], opts: SelectOptions = {}): DeathContext {
  const { all, cluster, prevDeaths, detached } = resolve(corpus, seed, extraLines, opts);
  return new DeathContext(all, { serverId: corpus.serverId, map: corpus.map, cluster, prevDeaths, detached: [...detached] }, bootsOf(corpus, opts));
}
