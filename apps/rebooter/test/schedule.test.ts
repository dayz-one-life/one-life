import { describe, it, expect } from "vitest";
import { msUntilNextBoundary } from "../src/schedule.js";

const MIN = 60_000;

describe("msUntilNextBoundary (even UTC hours, 2h interval)", () => {
  it("mid odd hour → next even hour", () => {
    // 01:30 UTC → 02:00 UTC = 30 min
    expect(msUntilNextBoundary(Date.UTC(2026, 6, 14, 1, 30, 0))).toBe(30 * MIN);
  });

  it("mid even hour → the following even hour", () => {
    // 02:30 UTC → 04:00 UTC = 90 min
    expect(msUntilNextBoundary(Date.UTC(2026, 6, 14, 2, 30, 0))).toBe(90 * MIN);
  });

  it("exactly on a boundary → full interval, never 0", () => {
    // 04:00:00.000 UTC → 06:00 UTC = 120 min
    expect(msUntilNextBoundary(Date.UTC(2026, 6, 14, 4, 0, 0))).toBe(120 * MIN);
  });

  it("late odd hour wraps across midnight to 00:00 next day", () => {
    // 23:15 UTC → 00:00 UTC next day = 45 min
    expect(msUntilNextBoundary(Date.UTC(2026, 6, 14, 23, 15, 0))).toBe(45 * MIN);
  });

  it("result always lands exactly on an even UTC hour at minute 0", () => {
    const now = Date.UTC(2026, 6, 14, 5, 17, 42, 123);
    const next = new Date(now + msUntilNextBoundary(now));
    expect(next.getUTCMinutes()).toBe(0);
    expect(next.getUTCSeconds()).toBe(0);
    expect(next.getUTCMilliseconds()).toBe(0);
    expect(next.getUTCHours() % 2).toBe(0);
  });
});
