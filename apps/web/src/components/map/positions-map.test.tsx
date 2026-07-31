import { describe, it, expect, vi } from "vitest";
import { positionAge } from "./positions-map";

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
  // The viewer's own dot persists across game logouts while a life is open, so hours- and
  // days-old fixes are now ordinary — "540m ago" is a reading-comprehension test, not an age.
  it("rolls up to hours and days for a persisted last-known fix", () => {
    expect(positionAge("2026-07-22T03:00:00Z", NOW)).toBe("9h ago");
    expect(positionAge("2026-07-20T10:00:00Z", NOW)).toBe("2d ago");
  });
});
