import { dist2d, identityBlocks, isPlayerId, type EvidenceLine, type Pos } from "../evidence/parse.js";
import type { LineRef } from "../types.js";

/**
 * A parsed line with its place in the list it is read in and its UTC second.
 *
 * ⚠️ `seq` is the line's index in ONE list of lines (a whole server's log, or the lines selected
 * for one death). It orders lines and says which line sits directly above another. It is not
 * stable between lists: never store one, never compare two from different lists.
 */
export interface StampedLine extends EvidenceLine { seq: number; ts: number }

export const refOf = (l: LineRef): LineRef => ({ admFileId: l.admFileId, lineIndex: l.lineIndex });
export const refKey = (l: LineRef): string => `${l.admFileId}:${l.lineIndex}`;

/** The kinds that are a death on their own. `committed suicide` is not one: it is a marker. */
export const PRIMARY_KINDS: ReadonlySet<string> = new Set(["killed", "died", "drowned", "drowned_uncon"]);

/** First index whose value is >= x, in a sorted list. */
export function lowerBound(xs: readonly number[], x: number): number {
  let lo = 0, hi = xs.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (xs[mid]! < x) lo = mid + 1; else hi = mid; }
  return lo;
}
/** First index whose value is > x, in a sorted list. */
export function upperBound(xs: readonly number[], x: number): number {
  let lo = 0, hi = xs.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (xs[mid]! <= x) lo = mid + 1; else hi = mid; }
  return lo;
}

export interface PlacedEntry { line: StampedLine; display: string; className: string }

/**
 * One list of lines (a server's log, or the part of it selected for a death) indexed the way the
 * rules ask about it. A port of the reference's `Server`.
 */
export class ServerIndex {
  readonly lines: readonly StampedLine[];
  /** `file:line` -> seq. */
  readonly idx = new Map<string, number>();
  /** id -> seqs of the lines that id is the subject of. */
  readonly own = new Map<string, number[]>();
  /** id -> seqs of the lines that mention the id anywhere. */
  readonly any = new Map<string, number[]>();
  /** Every `placed` line that carries a position, any class. */
  readonly placed: PlacedEntry[] = [];
  private readonly tsOrder: number[];
  private readonly tsKeys: number[];

  constructor(lines: readonly StampedLine[]) {
    this.lines = lines;
    lines.forEach((o, i) => {
      if (o.seq !== i) throw new Error("ServerIndex: a line's seq must be its index in the list");
      this.idx.set(refKey(o), i);
      if (o.subject && isPlayerId(o.subject.id)) push(this.own, o.subject.id, i);
      for (const id of o.ids) push(this.any, id, i);
      if (o.kind === "placed" && o.placed && o.subject?.pos) this.placed.push({ line: o, display: o.placed.display, className: o.placed.className });
    });
    this.tsOrder = lines.map((_, i) => i).sort((a, b) => lines[a]!.ts - lines[b]!.ts || a - b);
    this.tsKeys = this.tsOrder.map((s) => lines[s]!.ts);
  }

  line(ref: LineRef): StampedLine | undefined {
    const s = this.idx.get(refKey(ref));
    return s == null ? undefined : this.lines[s];
  }

  ownLines(id: string): StampedLine[] { return (this.own.get(id) ?? []).map((s) => this.lines[s]!); }

  /** Every line with `tLo <= ts <= tHi`, by time then by position in the log. */
  window(tLo: number, tHi: number): StampedLine[] {
    return this.tsOrder.slice(lowerBound(this.tsKeys, tLo), upperBound(this.tsKeys, tHi)).map((s) => this.lines[s]!);
  }

  /** Placements of the given classes within `radius` m of `pos`, written before `beforeSeq`,
   *  nearest first (the later line first at equal distance). */
  placedNear(pos: Pos, classes: ReadonlySet<string>, radius: number, beforeSeq: number,
    maxAgeS: number | null = null, t0: number | null = null): { dist: number; line: StampedLine; className: string }[] {
    const out: { dist: number; line: StampedLine; className: string }[] = [];
    for (const p of this.placed) {
      if (p.line.seq >= beforeSeq || !classes.has(p.className)) continue;
      if (maxAgeS != null && t0! - p.line.ts > maxAgeS) continue;
      const d = dist2d(p.line.subject!.pos!, pos);
      if (d <= radius) out.push({ dist: d, line: p.line, className: p.className });
    }
    return out.sort((a, b) => a.dist - b.dist || b.line.seq - a.line.seq);
  }

  /**
   * Other ids logged (in any identity block) within `radius` m of `pos` between two instants:
   * id -> name and nearest distance. With `livingAt`, an id whose own death line lies between its
   * last living line in the window and that point of the log is dropped: it was a corpse by then.
   */
  othersNear(pid: string, pos: Pos, tLo: number, tHi: number, radius: number,
    opts: { aliveOnly?: boolean; livingAt?: { ts: number; seq: number } | null } = {}): Map<string, { name: string; dist: number }> {
    const aliveOnly = opts.aliveOnly ?? true;
    const res = new Map<string, { name: string; dist: number }>();
    const lastAlive = new Map<string, number>();
    for (const o of this.window(tLo, tHi)) {
      if (o.positions.length === 0) continue;
      for (const b of identityBlocks(o.text)) {
        if (b.id === pid || (aliveOnly && b.dead) || !b.pos) continue;
        const d = dist2d(b.pos, pos);
        if (d > radius) continue;
        const cur = res.get(b.id);
        if (!cur || d < cur.dist) res.set(b.id, { name: b.name, dist: pyRound(d, 1) });
        if (!b.dead) lastAlive.set(b.id, Math.max(lastAlive.get(b.id) ?? -1, o.seq));
      }
    }
    if (opts.livingAt && aliveOnly) {
      for (const id of [...res.keys()]) if (this.diedBetween(id, lastAlive.get(id) ?? -1, opts.livingAt.seq)) res.delete(id);
    }
    return res;
  }

  /** The first own death line of `pid` with `seqLo < seq < seqHi`. */
  diedBetween(pid: string, seqLo: number, seqHi: number): StampedLine | null {
    const own = this.own.get(pid) ?? [];
    for (let i = upperBound(own, seqLo); i < own.length; i++) {
      if (own[i]! >= seqHi) break;
      const o = this.lines[own[i]!]!;
      if (o.subject!.dead && PRIMARY_KINDS.has(o.kind)) return o;
    }
    return null;
  }

  /** The last own death line of `pid` with `tLo <= ts <= tHi`, written before `seqHi`. */
  diedIn(pid: string, tLo: number, tHi: number, seqHi: number): StampedLine | null {
    const own = this.own.get(pid) ?? [];
    for (let i = lowerBound(own, seqHi) - 1; i >= 0; i--) {
      const o = this.lines[own[i]!]!;
      if (o.ts < tLo) break;
      if (o.ts <= tHi && o.subject!.dead && PRIMARY_KINDS.has(o.kind)) return o;
    }
    return null;
  }

  /** True when `pid` has an `is connected` line with `seqLo < seq < seqHi`. */
  aliveAgain(pid: string, seqLo: number, seqHi: number): boolean {
    const own = this.own.get(pid) ?? [];
    for (let i = upperBound(own, seqLo); i < own.length; i++) {
      if (own[i]! >= seqHi) break;
      if (this.lines[own[i]!]!.kind === "connected") return true;
    }
    return false;
  }
}

function push(m: Map<string, number[]>, k: string, v: number): void {
  const a = m.get(k);
  if (a) a.push(v); else m.set(k, [v]);
}

const indexes = new WeakMap<readonly StampedLine[], ServerIndex>();
/** The index of a list of lines, built once per list. */
export function indexOf(lines: readonly StampedLine[]): ServerIndex {
  let s = indexes.get(lines);
  if (!s) { s = new ServerIndex(lines); indexes.set(lines, s); }
  return s;
}

/**
 * Rounds the way the reference does: to the nearest, and an exact half to the even neighbour.
 * The rules compare rounded distances with thresholds, so a different rounding of a tie would be
 * a different verdict.
 */
export function pyRound(x: number, digits: number): number {
  if (!Number.isFinite(x)) return x;
  const neg = x < 0, a = Math.abs(x);
  let r = Number(a.toFixed(digits));
  // toFixed rounds an exact half up. Find the exact halves and send them to the even side.
  const exact = a.toFixed(Math.min(100, digits + 60));
  const rest = exact.slice(exact.indexOf(".") + 1 + digits);
  if (/^50*$/.test(rest)) {
    const unit = 10 ** -digits;
    const down = Number((r - unit).toFixed(digits));
    const lastDigit = (v: number) => Number(v.toFixed(digits).slice(-1));
    if (lastDigit(r) % 2 !== 0) r = down;
  }
  return neg ? -r : r;
}
