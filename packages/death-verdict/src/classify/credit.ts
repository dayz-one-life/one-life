import type { DeathContext } from "../context/build.js";
import { CREDIT_RADIUS_M, CREDIT_RING_M } from "../context/select.js";
import { pyRound, refOf, type StampedLine } from "../context/server.js";
import { dist2d, isDetonation, type Pos, type TrapClass } from "../evidence/parse.js";
import type { CreditEvidence, InternalVerdict } from "../types.js";
import { LIFETIME_H, WIPES } from "./tables.js";

/**
 * The evidence half of the trap-kill bar: whether the log supports reading a death by tripwire or
 * land mine as a kill by the player who set the device. Pure: it reads the death's context and
 * nothing else.
 *
 * The log never says whose device fired. What it has is `placed` lines, and lines for a device
 * going off. The bar, in order — the first test that fails is the answer:
 *
 *   1  the cause is `explosive_trap` or `landmine`, at definitive or strong (rules A06, A07, A09)
 *   2  exactly one player has a placement of that kind within 5 m of where it went off
 *   3  no other player has an UNSPENT placement of that kind within 15 m
 *   4  that one player is not the victim
 *   5  one of their placements is later than the last time a device went off at that spot
 *
 * ⚠️ `outcome: "credited"` here means ONLY that tests 1 to 5 hold. Two more tests need the
 * database (the placer is a known player; the victim's life counts in its own right) and an
 * operator can deny or grant. Whoever stores the verdict applies those and sets the final
 * outcome; nothing may write a kill from this result alone.
 *
 * ⚠️ It never counts placement lines: one device often writes several. And it never changes the
 * verdict's cause, confidence or attribution.
 */

/** `others_present`: another living player logged this close to the death, this long either side
 *  of it. Wide in time because a player who does nothing is only logged every few minutes. */
export const OTHERS_RADIUS_M = 50;
export const OTHERS_WINDOW_S = 300;
/** A mine's blast lines this many seconds up to the kill line are the death's own detonation. */
export const OWN_BLAST_WINDOW_S = 2;

const NOT_APPLICABLE: CreditEvidence = {
  outcome: "not_applicable", refusedBy: null, placerDayzId: null, placement: null, distanceM: null, ageHours: null, boots: null, flags: [],
};

/** The rules whose deaths the bar is asked about. A claymore with no trip line, a plastic charge
 *  and everything else are out of scope: no credit is ever read for them. */
export function inCreditScope(v: Pick<InternalVerdict, "rule">): boolean {
  return v.rule === "A06" || v.rule === "A07" || v.rule === "A09";
}

const posOf = (o: StampedLine): Pos | null => o.subject?.pos ?? null;

/** Where the device went off, and the lines that are this death's own detonation. */
function anchorOf(c: DeathContext, v: Pick<InternalVerdict, "rule">): { cls: TrapClass; anchor: Pos; own: Set<StampedLine> } | null {
  if (v.rule === "A09") {
    // A mine: the victim's position on the kill line itself.
    const anchor = posOf(c.prim);
    if (!anchor) return null;
    const own = new Set(c.server.window(c.t0 - OWN_BLAST_WINDOW_S, c.t0).filter((o) => isDetonation(o, "LandMineTrap")));
    return { cls: "LandMineTrap", anchor, own };
  }
  // A tripwire: the victim's position on their own TripWireHit line, the one the rule fired on.
  const [lo, hi] = v.rule === "A06" ? [0, 1] : [3, 5];
  const trips = c.hits.filter((h) => h.cat === "trap" && h.det.source === "TripwireTrap" && c.t0 - h.ts >= lo && c.t0 - h.ts <= hi);
  const trip = trips[trips.length - 1];
  const anchor = trip ? posOf(trip.o) : null;
  if (!trip || !anchor) return null;
  return { cls: "TripwireTrap", anchor, own: new Set([trip.o]) };
}

export interface CreditOptions {
  /** World wipes by server id, UTC ISO instants. Defaults to the checked-in table. */
  wipes?: Readonly<Record<number, readonly string[]>>;
}

export function creditEvidence(c: DeathContext, v: Pick<InternalVerdict, "rule" | "cause" | "confidence">, opts: CreditOptions = {}): CreditEvidence {
  // ---- test 1: scope
  if (!inCreditScope(v) || (v.cause !== "explosive_trap" && v.cause !== "landmine") || (v.confidence !== "definitive" && v.confidence !== "strong")) {
    return { ...NOT_APPLICABLE };
  }
  const found = anchorOf(c, v);
  if (!found) return { ...NOT_APPLICABLE };       // no anchor, no kill
  const { cls, anchor, own } = found;
  const S = c.server;

  // A placement from before the server's last wipe is gone, whatever the log still says.
  const wipes = (opts.wipes ?? WIPES)[c.serverId] ?? [];
  const lastWipe = Math.max(-Infinity, ...wipes.map((w) => Date.parse(w) / 1000).filter((t) => Number.isFinite(t) && t <= c.t0));
  const ring = S.placedNear(anchor, new Set([cls]), CREDIT_RING_M, c.firstSeq).filter((p) => p.line.ts >= lastWipe);
  const cands = ring.filter((p) => p.dist <= CREDIT_RADIUS_M);            // nearest first
  const placers = new Set(cands.map((p) => p.line.subject!.id));

  // Every earlier time a device of this kind went off, since the oldest placement in the ring.
  // ⚠️ The death's own detonation is never one of them.
  const dets: StampedLine[] = [];
  if (ring.length) {
    for (let s = Math.min(...ring.map((p) => p.line.seq)) + 1; s < c.firstSeq; s++) {
      const o = S.lines[s]!;
      if (!own.has(o) && isDetonation(o, cls) && posOf(o)) dets.push(o);
    }
  }
  const lastDetNear = (at: Pos, afterSeq: number): StampedLine | null => {
    for (let i = dets.length - 1; i >= 0; i--) {
      if (dets[i]!.seq > afterSeq && dist2d(posOf(dets[i]!)!, at) <= CREDIT_RADIUS_M) return dets[i]!;
    }
    return null;
  };

  const flags: string[] = [];
  const result = (refusedBy: CreditEvidence["refusedBy"], pick: (typeof cands)[number] | null, placerDayzId: string | null): CreditEvidence => {
    const ageHours = pick ? (c.t0 - pick.line.ts) / 3600 : null;
    if (pick && ageHours! > (LIFETIME_H[cls] ?? Infinity)) flags.push("placement_past_lifetime");
    const at = c.pos ?? anchor;
    if (S.othersNear(c.pid, at, c.t0 - OTHERS_WINDOW_S, c.t0 + OTHERS_WINDOW_S, OTHERS_RADIUS_M).size) flags.push("others_present");
    if (cands.length > 1) flags.push("repeat_placement_lines");
    const b0 = pick ? c.bootOf(pick.line.admFileId) : null, b1 = c.bootOf(c.prim.admFileId);
    return {
      outcome: refusedBy == null ? "credited" : "refused", refusedBy, placerDayzId,
      placement: pick ? refOf(pick.line) : null,
      distanceM: pick ? pyRound(pick.dist, 1) : null,
      ageHours: ageHours == null ? null : pyRound(ageHours, 1),
      boots: b0 != null && b1 != null ? b1 - b0 : null,
      flags: flags.sort(),
    };
  };

  // ---- test 2: exactly one placer among the candidates
  if (placers.size !== 1) return result(2, cands[0] ?? null, null);
  const placer = cands[0]!.line.subject!.id;

  // ---- test 3: no other player's unspent placement in the ring. A neighbour's placement is spent
  // when a device went off within 5 m of it after it, and that neighbour has not placed there since.
  const theirs = ring.filter((p) => p.line.subject!.id !== placer);
  const isUnspent = (p: (typeof ring)[number]): boolean => {
    const at = posOf(p.line)!;
    const det = lastDetNear(at, p.line.seq);
    if (!det) return true;
    return theirs.some((q) => q.line.subject!.id === p.line.subject!.id && q.line.seq > det.seq && dist2d(posOf(q.line)!, at) <= CREDIT_RADIUS_M);
  };
  if (theirs.some(isUnspent)) return result(3, cands[0]!, placer);
  if (theirs.length) flags.push("neighbour_spent");       // passed test 3 only because every neighbour's device had gone off

  // ---- test 4: the placer is not the victim
  if (placer === c.pid) return result(4, cands[0]!, placer);

  // ---- test 5: a live device is on record: a candidate later than the last earlier detonation at the spot
  const spent = lastDetNear(anchor, Math.min(...cands.map((p) => p.line.seq)));
  const live = spent ? cands.filter((p) => p.line.seq > spent.seq) : cands;
  if (live.length === 0) return result(5, cands[0]!, placer);
  if (spent) flags.push("earlier_detonation");
  return result(null, live[0]!, placer);
}
