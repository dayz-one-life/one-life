import { describe, it, expect } from "vitest";
import { livePlaytime } from "../src/index.js";

describe("livePlaytime", () => {
  it("returns stored seconds when no open session", () => {
    expect(livePlaytime(600, null, new Date())).toBe(600);
  });
  it("adds elapsed open-session seconds", () => {
    const now = new Date("2026-07-06T12:10:00Z");
    expect(livePlaytime(600, { connectedAt: new Date("2026-07-06T12:00:00Z") }, now)).toBe(1200);
  });
  it("never subtracts when clock skews backward", () => {
    const now = new Date("2026-07-06T11:00:00Z");
    expect(livePlaytime(600, { connectedAt: new Date("2026-07-06T12:00:00Z") }, now)).toBe(600);
  });
});
