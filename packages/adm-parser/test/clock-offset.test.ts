import { describe, it, expect } from "vitest";
import { deriveClockOffsetMs } from "../src/index.js";

const FIFTEEN = 15 * 60 * 1000;

describe("deriveClockOffsetMs", () => {
  it("returns 0 when no files", () => {
    expect(deriveClockOffsetMs([])).toBe(0);
  });

  it("derives offset rounded to nearest 15 minutes", () => {
    // filename local says 12:00:00Z; file really modified 4h1m later in real UTC.
    const localTimestampMs = Date.UTC(2026, 6, 6, 12, 0, 0);
    const modifiedAtMs = localTimestampMs + 4 * 3600_000 + 61_000; // +4h01m01s
    expect(deriveClockOffsetMs([{ localTimestampMs, modifiedAtMs }])).toBe(4 * 3600_000);
  });

  it("takes the minimum candidate across files", () => {
    const base = Date.UTC(2026, 6, 6, 12, 0, 0);
    const files = [
      { localTimestampMs: base, modifiedAtMs: base + 5 * FIFTEEN },
      { localTimestampMs: base, modifiedAtMs: base + 2 * FIFTEEN },
    ];
    expect(deriveClockOffsetMs(files)).toBe(2 * FIFTEEN);
  });
});
