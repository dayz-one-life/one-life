/** Pure shaping for the owner-only life map. No DB, no I/O — every rule here is a
 *  product decision from the spec and must stay inspectable in isolation. */

export interface TrackPoint { x: number; y: number; at: Date }
export interface TrackSegment { sessionId: number; points: TrackPoint[] }
export type TrackMarkerKind = "kill" | "death" | "now";

/**
 * Deaths and kills carry NO recorded coordinates (adm-parser's death.ts never parses
 * `pos=`, and `kills` has no x/y). Every marker is therefore the last position sample
 * before the event — approximate by construction. There is deliberately no
 * `approximate?: boolean` flag: a flag can be forgotten at a render site, whereas a
 * non-optional `sampleAgeSeconds` must be actively discarded to be ignored.
 */
export interface TrackMarker {
  kind: TrackMarkerKind;
  at: Date;
  x: number;
  y: number;
  sampleAt: Date;
  sampleAgeSeconds: number;
  label: string | null;
}

export const THIN_MIN_METERS = 15;
export const TRACK_POINT_CAP = 1500;
/** Past 15 minutes a survivor covers kilometres; a confidently-placed wrong pin is worse
 *  than no pin at all. */
export const MARKER_MAX_AGE_SECONDS = 900;

function far(a: TrackPoint, b: TrackPoint): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) >= THIN_MIN_METERS;
}

/** Distance-threshold thinning, measured against the last KEPT point so a slow walk
 *  accumulates instead of being dropped pairwise. The final point is always kept — on an
 *  open life it is the whole answer. Also reports whether the cap branch actually dropped
 *  points, so `truncated` is a fact this layer asserts rather than something the caller
 *  infers from a length (a thinned track landing at EXACTLY the cap had nothing dropped). */
export function thinTrackWithMeta(points: TrackPoint[]): { points: TrackPoint[]; truncated: boolean } {
  if (points.length === 0) return { points: [], truncated: false };
  const kept: TrackPoint[] = [points[0]!];
  for (let i = 1; i < points.length; i++) {
    const q = points[i]!;
    if (far(kept[kept.length - 1]!, q)) kept.push(q);
  }
  const last = points[points.length - 1]!;
  if (kept[kept.length - 1] !== last) kept.push(last);
  if (kept.length <= TRACK_POINT_CAP) return { points: kept, truncated: false };
  // Keep the earliest points and the true final fix; the caller reports the honest
  // pre-thinning `sampleCount` so the UI can say the trail is truncated.
  return { points: [...kept.slice(0, TRACK_POINT_CAP - 1), last], truncated: true };
}

/** Behaviourally identical to `thinTrackWithMeta` minus the truncation fact — kept for
 *  existing callers that only need the points. */
export function thinTrack(points: TrackPoint[]): TrackPoint[] {
  return thinTrackWithMeta(points).points;
}

/** One polyline per session. Joining across a session gap would draw a straight line
 *  across a logout/login the player never walked. */
export function segmentBySession(
  points: TrackPoint[],
  sessions: { id: number; connectedAt: Date; endedAt: Date }[],
): TrackSegment[] {
  const out: TrackSegment[] = [];
  for (const s of sessions) {
    const from = s.connectedAt.getTime();
    const to = s.endedAt.getTime();
    const inside = points.filter((p) => {
      const t = p.at.getTime();
      return t >= from && t <= to;
    });
    if (inside.length > 0) out.push({ sessionId: s.id, points: inside });
  }
  return out;
}

/** The last sample at or before `at`. Never a later one: a fix from after the event is
 *  where the player went next, not where the event happened. */
export function markerAt(
  points: TrackPoint[], kind: TrackMarkerKind, at: Date, label: string | null,
): TrackMarker | null {
  let best: TrackPoint | null = null;
  for (const p of points) {
    if (p.at.getTime() <= at.getTime() && (!best || p.at.getTime() > best.at.getTime())) best = p;
  }
  if (!best) return null;
  const sampleAgeSeconds = Math.round((at.getTime() - best.at.getTime()) / 1000);
  if (sampleAgeSeconds > MARKER_MAX_AGE_SECONDS) return null;
  return { kind, at, x: best.x, y: best.y, sampleAt: best.at, sampleAgeSeconds, label };
}
