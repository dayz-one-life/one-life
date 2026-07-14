import { describe, it, expect } from "vitest";
import { assignTimestamps } from "../src/index.js";

const D = (s: string) => new Date(s);

describe("assignTimestamps", () => {
  it("uses the header date and returns null for the header line", () => {
    const lines = [
      "AdminLog started on 2026-07-06 at 12:51:59",
      "12:52:38 | Player \"A\" (id=A=) is connecting",
    ];
    const ts = assignTimestamps(lines, D("2026-07-06T00:00:00Z"));
    expect(ts[0]).toBeNull();
    expect(ts[1]).toBe(Date.UTC(2026, 6, 6, 12, 52, 38));
  });

  it("rolls over to the next day when time jumps backward past 12h", () => {
    const lines = [
      "AdminLog started on 2026-07-06 at 23:59:30",
      "23:59:30 | Player \"A\" (id=A=) is connected",
      "00:00:30 | Player \"A\" (id=A=) has been disconnected",
    ];
    const ts = assignTimestamps(lines, D("2026-07-06T00:00:00Z"));
    expect(ts[1]).toBe(Date.UTC(2026, 6, 6, 23, 59, 30));
    expect(ts[2]).toBe(Date.UTC(2026, 6, 7, 0, 0, 30));
  });

  it("returns null for blank and non-timestamped lines", () => {
    const lines = ["", "##### PlayerList log: 4 players".replace(/^/, "no-time ")];
    const ts = assignTimestamps(lines, D("2026-07-06T00:00:00Z"));
    expect(ts[0]).toBeNull();
    expect(ts[1]).toBeNull();
  });
});
