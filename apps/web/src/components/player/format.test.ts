import { describe, it, expect } from "vitest";
import { formatDuration, banCountdown, heroStats, aliveMaps, mapLabel, monthYear, relativeDate } from "./format";

describe("player format helpers", () => {
  it("formats durations as Xh Ym", () => {
    expect(formatDuration(3720)).toBe("1h 2m");
    expect(formatDuration(-5)).toBe("0h 0m");
  });
  it("computes ban countdown, clamped at zero", () => {
    const now = new Date("2026-07-14T12:00:00Z");
    expect(banCountdown("2026-07-14T14:30:00Z", now)).toBe("2h 30m");
    expect(banCountdown("2026-07-14T11:00:00Z", now)).toBe("0h 0m");
    expect(banCountdown(null, now)).toBeNull();
  });
});

describe("mapLabel", () => {
  it("maps known DayZ mission codenames to display labels", () => {
    expect(mapLabel("chernarusplus")).toBe("Chernarus");
    expect(mapLabel("sakhal")).toBe("Sakhal");
    expect(mapLabel("enoch")).toBe("Livonia");
  });
  it("title-cases an unknown codename as a fallback", () => {
    expect(mapLabel("banov")).toBe("Banov");
  });
});

describe("heroStats", () => {
  it("heroStats highlights Deaths, not Longest life", () => {
    const stats = heroStats({ kills: 2, lives: 4, deaths: 2, longestLifeSeconds: 82440 });
    expect(stats.map((s) => s.label)).toEqual(["Kills", "Lives", "Deaths", "Longest life"]);
    expect(stats.find((s) => s.label === "Deaths")?.hot).toBe(true);
    expect(stats.find((s) => s.label === "Longest life")?.hot).toBe(false);
  });

  it("heroStats omits Kills at zero", () => {
    const stats = heroStats({ kills: 0, lives: 1, deaths: 0, longestLifeSeconds: 60 });
    expect(stats.map((s) => s.label)).toEqual(["Lives", "Deaths", "Longest life"]);
  });
});

describe("aliveMaps", () => {
  it("aliveMaps lists alive servers by label", () => {
    const standing = [
      { state: "alive", map: "sakhal" },
      { state: "banned", map: "chernarusplus" },
      { state: "alive", map: "enoch" },
    ] as never;
    expect(aliveMaps({ standing })).toEqual(["Sakhal", "Livonia"]);
  });
});

describe("monthYear / relativeDate", () => {
  it("formats month + year (UTC)", () => {
    expect(monthYear("2026-03-09T00:00:00Z")).toBe("Mar 2026");
  });
  it("formats relative dates", () => {
    const now = new Date("2026-07-15T12:00:00Z");
    expect(relativeDate("2026-07-15T09:00:00Z", now)).toBe("today");
    expect(relativeDate("2026-07-14T09:00:00Z", now)).toBe("yesterday");
    expect(relativeDate("2026-07-12T12:00:00Z", now)).toBe("3 days ago");
    expect(relativeDate("2026-06-20T12:00:00Z", now)).toBe("3 weeks ago");
  });
});
