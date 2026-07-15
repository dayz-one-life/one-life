import { describe, it, expect } from "vitest";
import { formatDuration, avatarSrc, banCountdown, heroStatusLine, heroStats, mapLabel, monthYear, relativeDate } from "./format";

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
  it("drops Kills when 0 and always highlights Longest life", () => {
    const s = heroStats({ kills: 0, lives: 7, deaths: 6, longestLifeSeconds: 3600 });
    expect(s.map((x) => x.label)).toEqual(["Lives", "Deaths", "Longest life"]);
    expect(s.find((x) => x.hot)!.label).toBe("Longest life");
  });
  it("includes Kills when > 0, and only Longest life is hot", () => {
    const s = heroStats({ kills: 42, lives: 7, deaths: 6, longestLifeSeconds: 3600 });
    expect(s.map((x) => x.label)).toEqual(["Kills", "Lives", "Deaths", "Longest life"]);
    expect(s.filter((x) => x.hot).map((x) => x.label)).toEqual(["Longest life"]);
    expect(s[0]).toMatchObject({ value: "42", hot: false });
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
