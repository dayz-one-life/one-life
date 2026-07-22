// packages/read-models/test/life-track-shape.test.ts
import { describe, it, expect } from "vitest";
import {
  thinTrack, thinTrackWithMeta, segmentBySession, markerAt,
  THIN_MIN_METERS, TRACK_POINT_CAP, MARKER_MAX_AGE_SECONDS,
  type TrackPoint,
} from "../src/life-track-shape.js";

const t0 = new Date("2026-07-14T00:00:00Z");
const at = (s: number) => new Date(t0.getTime() + s * 1000);
const p = (x: number, y: number, s: number): TrackPoint => ({ x, y, at: at(s) });

describe("thinTrack", () => {
  it("keeps the first point always", () => {
    expect(thinTrack([p(100, 100, 0)])).toHaveLength(1);
  });

  it("drops a sample within 15m of the last KEPT point", () => {
    // An idle player parked in a base — this is the bulk of real volume, not travel.
    const out = thinTrack([p(0, 0, 0), p(5, 0, 10), p(9, 0, 20), p(14, 0, 30)]);
    expect(out).toHaveLength(2);
    expect(out[0]!.x).toBe(0);
    expect(out[1]!.x).toBe(14);
  });

  it("keeps a sample beyond 15m", () => {
    const out = thinTrack([p(0, 0, 0), p(20, 0, 10)]);
    expect(out).toHaveLength(2);
  });

  it("measures from the last KEPT point, not the previous raw one", () => {
    // Three 10m steps: cumulative 30m. Measuring pairwise would drop all three.
    const out = thinTrack([p(0, 0, 0), p(10, 0, 1), p(20, 0, 2), p(30, 0, 3)]);
    expect(out.map((q) => q.x)).toEqual([0, 20, 30]);
  });

  it("always keeps the FINAL point even if it is within the threshold", () => {
    // The last fix is the whole point of an open life — it must never be thinned away.
    const out = thinTrack([p(0, 0, 0), p(100, 0, 10), p(102, 0, 20)]);
    expect(out.at(-1)!.x).toBe(102);
  });

  it("caps at TRACK_POINT_CAP, keeping the earliest points and the final one", () => {
    const many = Array.from({ length: 5000 }, (_, i) => p(i * 100, 0, i));
    const out = thinTrack(many);
    expect(out).toHaveLength(TRACK_POINT_CAP);
    expect(out.at(-1)!.x).toBe(4999 * 100);
  });

  it("returns an empty array for no input", () => {
    expect(thinTrack([])).toEqual([]);
  });
});

describe("thinTrackWithMeta", () => {
  it("reports truncated: false when the thinned track lands at EXACTLY the cap", () => {
    const exact = Array.from({ length: TRACK_POINT_CAP }, (_, i) => p(i * 100, 0, i));
    const { points, truncated } = thinTrackWithMeta(exact);
    expect(points).toHaveLength(TRACK_POINT_CAP);
    expect(truncated).toBe(false);
  });

  it("reports truncated: true and caps at TRACK_POINT_CAP when the thinned track exceeds it", () => {
    const over = Array.from({ length: TRACK_POINT_CAP + 1 }, (_, i) => p(i * 100, 0, i));
    const { points, truncated } = thinTrackWithMeta(over);
    expect(points).toHaveLength(TRACK_POINT_CAP);
    expect(truncated).toBe(true);
  });
});

describe("segmentBySession", () => {
  const sessions = [
    { id: 1, connectedAt: at(0), endedAt: at(100) },
    { id: 2, connectedAt: at(500), endedAt: at(600) },
  ];

  it("splits points into one segment per session", () => {
    const out = segmentBySession([p(0, 0, 10), p(1, 1, 50), p(2, 2, 550)], sessions);
    expect(out.map((s) => s.sessionId)).toEqual([1, 2]);
    expect(out[0]!.points).toHaveLength(2);
    expect(out[1]!.points).toHaveLength(1);
  });

  it("never joins across a session gap — the logout-teleport line must not exist", () => {
    const out = segmentBySession([p(0, 0, 10), p(9999, 9999, 550)], sessions);
    expect(out).toHaveLength(2);
  });

  it("drops points falling in no session", () => {
    expect(segmentBySession([p(0, 0, 300)], sessions)).toEqual([]);
  });

  it("omits a session with no points rather than emitting an empty segment", () => {
    const out = segmentBySession([p(0, 0, 10)], sessions);
    expect(out).toHaveLength(1);
  });

  it("includes points exactly on both session boundaries", () => {
    const out = segmentBySession([p(0, 0, 0), p(1, 1, 100)], sessions);
    expect(out[0]!.points).toHaveLength(2);
  });
});

describe("markerAt", () => {
  const pts = [p(10, 10, 0), p(20, 20, 60), p(30, 30, 120)];

  it("uses the last sample AT OR BEFORE the event", () => {
    const m = markerAt(pts, "kill", at(90), "Victim1");
    expect(m).not.toBeNull();
    expect(m!.x).toBe(20);
    expect(m!.sampleAgeSeconds).toBe(30);
  });

  it("never selects a sample AFTER the event", () => {
    // The fix at t=120 is nearer in absolute time to t=110 than the one at t=60,
    // but it is in the future relative to the event and must not be used.
    const m = markerAt(pts, "kill", at(110), null);
    expect(m!.x).toBe(20);
  });

  it("accepts a sample exactly at the event time with age 0", () => {
    const m = markerAt(pts, "death", at(60), null);
    expect(m!.sampleAgeSeconds).toBe(0);
  });

  it("returns null past the 900s staleness cutoff", () => {
    const m = markerAt(pts, "death", at(120 + MARKER_MAX_AGE_SECONDS + 1), null);
    expect(m).toBeNull();
  });

  it("returns a marker exactly at the cutoff", () => {
    const m = markerAt(pts, "death", at(120 + MARKER_MAX_AGE_SECONDS), null);
    expect(m).not.toBeNull();
  });

  it("returns null when no sample precedes the event", () => {
    expect(markerAt(pts, "kill", at(-10), null)).toBeNull();
  });

  it("returns null for an empty track", () => {
    expect(markerAt([], "death", at(0), null)).toBeNull();
  });

  it("carries the label through", () => {
    expect(markerAt(pts, "kill", at(60), "Victim1")!.label).toBe("Victim1");
  });
});

describe("constants match the spec", () => {
  it("pins the three tuning numbers", () => {
    expect(THIN_MIN_METERS).toBe(15);
    expect(TRACK_POINT_CAP).toBe(1500);
    expect(MARKER_MAX_AGE_SECONDS).toBe(900);
  });
});
