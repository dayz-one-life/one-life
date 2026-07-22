import { describe, it, expect, vi } from "vitest";
import { positionAge } from "./friends-map";

vi.mock("./map-canvas", () => ({ default: () => <div data-testid="canvas" /> }));

const NOW = new Date("2026-07-22T12:00:00Z");

// FriendsMapLegend's own tests moved to shell/online-list.test.tsx, alongside its
// FriendsMapLegend -> OnlineList rename and its friends -> everyone-online scope change.
// positionAge stays here: the popup still calls it, so it stays exported from this module.
describe("positionAge", () => {
  it("reads as just now under a minute", () => {
    expect(positionAge("2026-07-22T11:59:30Z", NOW)).toBe("just now");
  });
  it("counts whole minutes", () => {
    expect(positionAge("2026-07-22T11:55:00Z", NOW)).toBe("5m ago");
    expect(positionAge("2026-07-22T11:59:00Z", NOW)).toBe("1m ago");
  });
});
