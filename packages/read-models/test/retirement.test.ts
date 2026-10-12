import { describe, it, expect } from "vitest";
import { applyRetirement, closeSessionsAt } from "../src/retirement.js";

const R = new Date("2026-10-09T18:07:00Z");
describe("applyRetirement", () => {
  it("ends an open life on a retired server at retired_at, adding the open session up to it", () => {
    const l = applyRetirement({ endedAt: null, playtimeSeconds: 600 }, { connectedAt: new Date("2026-10-09T18:00:00Z") }, R, new Date("2026-10-09T18:10:00Z"));
    expect(l).toMatchObject({ endedAt: R, endReason: "server_retired", playtimeSeconds: 600 + 420 });
  });
  it("caps a ghosted session at lastSeenAt when that is earlier", () => {
    const l = applyRetirement({ endedAt: null, playtimeSeconds: 0 }, { connectedAt: new Date("2026-09-01T00:00:00Z") }, R, new Date("2026-09-01T01:00:00Z"));
    expect(l.playtimeSeconds).toBe(3600);
  });
  it("leaves an open life open when the server is not retired (paused)", () => {
    expect(applyRetirement({ endedAt: null, playtimeSeconds: 5 }, null, null, null)).toMatchObject({ endedAt: null, endReason: null, playtimeSeconds: 5 });
  });
  it("marks a dead life as death, untouched", () => {
    const d = new Date("2026-10-01T00:00:00Z");
    expect(applyRetirement({ endedAt: d, playtimeSeconds: 9 }, null, R, null)).toMatchObject({ endedAt: d, endReason: "death", playtimeSeconds: 9 });
  });
  it("closeSessionsAt closes open sessions at retired_at only when retired", () => {
    expect(closeSessionsAt([{ disconnectedAt: null }], R)[0]!.disconnectedAt).toEqual(R);
    expect(closeSessionsAt([{ disconnectedAt: null }], null)[0]!.disconnectedAt).toBeNull();
  });
});
