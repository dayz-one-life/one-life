import type { DeathContext, Hit } from "../context/build.js";
import { CREDIT_RADIUS_M, CREDIT_RING_M } from "../context/select.js";
import { pyRound, refOf, type StampedLine } from "../context/server.js";
import { dist2d, isDetonation, type Pos, type TrapClass } from "../evidence/parse.js";
import type { CreditEvidence, InternalVerdict } from "../types.js";
import { claymoresBeside, FRAG_FUSE_S, fuseTrip, heldFrag, victimTrips } from "./killed.js";
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
 *   2  exactly one player has a placement of that kind within 5 m of where it went off — and the
 *      victim tripped one device, not two (`ambiguous_trip`)
 *   3  no other player has an UNSPENT placement of that kind within 15 m
 *   4  that one player is not the victim
 *   5  one of their placements is later than the last time a device went off at that spot
 *
 * ⚠️ A placement counts only when it was written BEFORE the device went off: before the victim's
 * trip line for a tripwire, before the death for a mine. A wire placed during a grenade's fuse
 * cannot be the wire that was tripped.
 *
 * ⚠️ `outcome: "evidence_passes"` means ONLY that tests 1 to 5 hold. It is not a kill. Two more
 * tests need the database (the placer is a known player; the victim's life counts in its own
 * right) and an operator can deny or grant. Whoever stores the verdict applies those and sets the
 * final outcome (`credited`, `refused`, `denied`, `granted`); nothing may write a kill from this
 * result alone, and this file never returns `credited`.
 *
 * ⚠️ It never counts placement lines: one device often writes several. And it never changes the
 * verdict's cause, confidence or attribution.
 *
 * The flags are for the operator. Five describe the placement and the spot:
 * `placement_past_lifetime`, `others_present`, `repeat_placement_lines`, `earlier_detonation`,
 * `neighbour_spent`. The rest mark a death whose shape the measurements behind the bar never
 * covered — every real trap death seen so far is one trip line, a blast line, one kill line, and
 * for a frag a fuse of exactly 4 s: `ambiguous_trip` (which refuses), `fuse_not_4s`,
 * `no_explosion_line`, `multi_blast`, `kill_lines_xN`, `held_frag_before_blast`,
 * `claymore_by_other_player`. ⚠️ Those do not refuse on their own: whatever lists trap kills for
 * the operator must show them, so a kill on an unmeasured shape is read before it is accepted.
 */

/** `others_present`: another living player logged this close to the death, this long either side
 *  of it. Wide in time because a player who does nothing is only logged every few minutes. */
export const OTHERS_RADIUS_M = 50;
export const OTHERS_WINDOW_S = 300;
/** A mine's blast lines ON THE VICTIM this many seconds up to the kill line are the death's own
 *  detonation. On anyone else, only the lines of the death second are. */
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

interface Anchor {
  cls: TrapClass;
  /** Where the device went off. */
  anchor: Pos;
  /** The lines that are this death's own detonation: never an earlier one. */
  own: Set<StampedLine>;
  /** The line the device went off on, in file order. Placements and earlier detonations are read before it. */
  beforeSeq: number;
  /** The anchor trip line of a tripwire death. */
  trip: Hit | null;
  /** The victim tripped a wire somewhere else as well in the last seconds: which device killed is not known. */
  ambiguous: boolean;
}

function anchorOf(c: DeathContext, v: Pick<InternalVerdict, "rule">): Anchor | null {
  if (v.rule === "A09") {
    // A mine: the victim's position on the kill line itself.
    const anchor = posOf(c.prim);
    if (!anchor) return null;
    // ⚠️ A blast line on someone else in an EARLIER second is another detonation, even one second
    // before: a mine that killed a player there two seconds ago is not the mine that killed this one.
    const own = new Set(c.server.window(c.t0 - OWN_BLAST_WINDOW_S, c.t0)
      .filter((o) => isDetonation(o, "LandMineTrap") && (o.ts === c.t0 || o.subject?.id === c.pid)));
    return { cls: "LandMineTrap", anchor, own, beforeSeq: c.firstSeq, trip: null, ambiguous: false };
  }
  // A tripwire: the victim's position on their own TripWireHit line, the one the rule fired on.
  const trips = victimTrips(c);
  const trip = fuseTrip(c, v.rule === "A06" ? "A06" : "A07", trips);
  const anchor = trip ? posOf(trip.o) : null;
  if (!trip || !anchor) return null;
  // ⚠️ EVERY trip line of the victim in the last seconds is this death's own, not only the anchor:
  // counted as an earlier detonation, the victim's other trip would "spend" a neighbour's wire —
  // perhaps the very wire that fired. And when they are not all at one spot, two devices went off.
  const ambiguous = trips.some((h) => { const at = posOf(h.o); return !at || dist2d(at, anchor) > CREDIT_RADIUS_M; });
  return { cls: "TripwireTrap", anchor, own: new Set(trips.map((h) => h.o)), beforeSeq: trip.o.seq, trip, ambiguous };
}

/** What about this death the measurements behind the bar never covered. Flags only: for the operator. */
function unmeasured(c: DeathContext, v: Pick<InternalVerdict, "rule">, a: Anchor, placer: string | null): string[] {
  const flags: string[] = [];
  const blasts = c.fatal.filter((h) => h.cat === "explosion");
  if (blasts.length === 0) flags.push("no_explosion_line");
  if (c.nKillLines > 1) flags.push(`kill_lines_x${c.nKillLines}`);
  if (a.trip) {
    // A mine's one blast is often written twice on the victim; a wire's charge is not.
    if (Math.max(blasts.length, c.bodyBlasts().mine.length) >= 2) flags.push("multi_blast");
    if (v.rule === "A07" && c.t0 - a.trip.ts !== FRAG_FUSE_S) flags.push("fuse_not_4s");
    if (v.rule === "A07" && heldFrag(c)) flags.push("held_frag_before_blast");
    if (v.rule === "A06" && placer != null && claymoresBeside(c, a.anchor, a.beforeSeq).some((x) => x.line.subject!.id !== placer)) flags.push("claymore_by_other_player");
  }
  return flags;
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
  const { cls, anchor, own, beforeSeq } = found;
  const S = c.server;

  // A placement from before the server's last wipe is gone, whatever the log still says.
  const wipes = (opts.wipes ?? WIPES)[c.serverId] ?? [];
  const lastWipe = Math.max(-Infinity, ...wipes.map((w) => Date.parse(w) / 1000).filter((t) => Number.isFinite(t) && t <= c.t0));
  const placedNear = (at: Pos, radius: number) => S.placedNear(at, new Set([cls]), radius, beforeSeq).filter((p) => p.line.ts >= lastWipe);
  const ring = placedNear(anchor, CREDIT_RING_M);
  const cands = ring.filter((p) => p.dist <= CREDIT_RADIUS_M);            // nearest first
  const placers = new Set(cands.map((p) => p.line.subject!.id));

  // Every earlier time a device of this kind went off, since the oldest placement in the ring.
  // ⚠️ The death's own detonation is never one of them.
  const dets: StampedLine[] = [];
  if (ring.length) {
    for (let s = Math.min(...ring.map((p) => p.line.seq)) + 1; s < beforeSeq; s++) {
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

  // The nearest candidate's placer is who a claymore beside the wire is compared with.
  const flags: string[] = unmeasured(c, v, found, cands[0]?.line.subject!.id ?? null);
  const result = (refusedBy: CreditEvidence["refusedBy"], pick: (typeof cands)[number] | null, placerDayzId: string | null): CreditEvidence => {
    const ageHours = pick ? (c.t0 - pick.line.ts) / 3600 : null;
    if (pick && ageHours! > (LIFETIME_H[cls] ?? Infinity)) flags.push("placement_past_lifetime");
    const at = c.pos ?? anchor;
    if (S.othersNear(c.pid, at, c.t0 - OTHERS_WINDOW_S, c.t0 + OTHERS_WINDOW_S, OTHERS_RADIUS_M).size) flags.push("others_present");
    if (cands.length > 1) flags.push("repeat_placement_lines");
    const b0 = pick ? c.bootOf(pick.line.admFileId) : null, b1 = c.bootOf(c.prim.admFileId);
    return {
      outcome: refusedBy == null ? "evidence_passes" : "refused", refusedBy, placerDayzId,
      placement: pick ? refOf(pick.line) : null,
      distanceM: pick ? pyRound(pick.dist, 1) : null,
      ageHours: ageHours == null ? null : pyRound(ageHours, 1),
      boots: b0 != null && b1 != null ? b1 - b0 : null,
      flags: flags.sort(),
    };
  };

  // ---- test 2: exactly one placer among the candidates — of ONE device
  if (found.ambiguous) {
    flags.push("ambiguous_trip");
    return result(2, cands[0] ?? null, null);
  }
  if (placers.size !== 1) return result(2, cands[0] ?? null, null);
  const placer = cands[0]!.line.subject!.id;

  // ---- test 3: no other player's unspent placement in the ring. A neighbour's placement is spent
  // when a device went off within 5 m of it after it, and that neighbour has not placed there since.
  // ⚠️ "There" is within 5 m of the spent placement, which can lie OUTSIDE the ring (a wire 13 m
  // off, re-placed 17 m off): the same spot re-armed, so the search is not limited to the ring.
  const theirs = ring.filter((p) => p.line.subject!.id !== placer);
  const isUnspent = (p: (typeof ring)[number]): boolean => {
    const at = posOf(p.line)!;
    const det = lastDetNear(at, p.line.seq);
    if (!det) return true;
    return placedNear(at, CREDIT_RADIUS_M).some((q) => q.line.subject!.id === p.line.subject!.id && q.line.seq > det.seq);
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
