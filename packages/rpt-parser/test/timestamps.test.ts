import { describe, it, expect } from "vitest";
import { headerDate, TimeTracker } from "../src/timestamps.js";

describe("timestamps", () => {
  it("parses the header 'Current time' date", () => {
    expect(headerDate("Current time:  2026/07/11 11:38:05\nVersion 1.29.163047")?.toISOString())
      .toBe("2026-07-11T11:38:05.000Z");
  });

  it("returns null without a header", () => {
    expect(headerDate("just some log line")).toBeNull();
  });

  it("converts a server-local line time to UTC via the offset (variable-width frac)", () => {
    const t = new TimeTracker(new Date(Date.UTC(2026, 6, 11, 11, 38, 5)), 4 * 3600_000); // UTC-4 → +4h
    expect(t.at(12, 0, 0, "5").toISOString()).toBe("2026-07-11T16:00:00.500Z");
    expect(t.at(12, 0, 1, "195").toISOString()).toBe("2026-07-11T16:00:01.195Z");
  });

  it("rolls the date forward on a backward midnight jump", () => {
    const t = new TimeTracker(new Date(Date.UTC(2026, 6, 11, 23, 0, 0)), 0);
    t.at(23, 59, 0, "0");
    expect(t.at(0, 1, 0, "0").toISOString()).toBe("2026-07-12T00:01:00.000Z");
  });
});
