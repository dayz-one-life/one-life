import { describe, it, expect } from "vitest";
import { formatDuration, avatarSrc, banCountdown, heroStatusLine } from "./format";

describe("player format helpers", () => {
  it("formats durations as Xh Ym", () => {
    expect(formatDuration(3720)).toBe("1h 2m");
    expect(formatDuration(-5)).toBe("0h 0m");
  });
  it("builds avatar src from character name", () => {
    expect(avatarSrc({ name: "Helga", head: null, gender: null })).toBe("/characters/helga.webp");
    expect(avatarSrc(null)).toBeNull();
  });
  it("computes ban countdown, clamped at zero", () => {
    const now = new Date("2026-07-14T12:00:00Z");
    expect(banCountdown("2026-07-14T14:30:00Z", now)).toBe("2h 30m");
    expect(banCountdown("2026-07-14T11:00:00Z", now)).toBe("0h 0m");
    expect(banCountdown(null, now)).toBeNull();
  });
  it("summarizes alive servers", () => {
    const page: any = { standing: [{ state: "alive", map: "chernarusplus" }, { state: "banned", map: "sakhal" }] };
    expect(heroStatusLine(page)).toBe("Alive on Chernarus");
  });
});
