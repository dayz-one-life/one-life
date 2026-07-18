import { describe, it, expect } from "vitest";
import {
  freshSpawnsHref,
  birthNoticeHref,
  birthDateline,
  priorsFacts,
  birthShowingLine,
} from "./birth-format";
import type { BirthNoticeArticle } from "./types";

const now = new Date("2026-07-17T12:00:00Z");

const base: BirthNoticeArticle = {
  slug: "new-fool-ashore-3", gamertag: "Boots", map: "chernarusplus", mapSlug: "chernarus",
  lifeNumber: 3, headline: "H", lede: "L", tags: ["Fresh Spawns"],
  bornAt: "2026-07-17T10:00:00Z", minutesToQualify: 6, priorLives: 2,
  imageUrl: null, imageCaption: null,
  body: "B", pullQuote: null, endedAt: null,
  priors: {
    livesLived: 2, longestLifeSeconds: 7200, totalKills: 9,
    usualDeathCause: "pvp", lastDeathCause: "starvation", bestLifeMap: "sakhal",
  },
};

describe("birth hrefs", () => {
  it("feed href omits page 1", () => {
    expect(freshSpawnsHref(1)).toBe("/fresh-spawns");
    expect(freshSpawnsHref(3)).toBe("/fresh-spawns?page=3");
  });
  it("article href", () => {
    expect(birthNoticeHref("new-fool-ashore-3")).toBe("/fresh-spawns/new-fool-ashore-3");
  });
});

describe("birthDateline", () => {
  it("labels the map (codename → name) and reads an hours-granular relative time", () => {
    // bornAt is 2h before `now`
    expect(birthDateline("chernarusplus", "2026-07-17T10:00:00Z", now)).toBe("CHERNARUS BUREAU · 2 hours ago");
  });
  it("reads minutes when under an hour old", () => {
    expect(birthDateline("sakhal", "2026-07-17T11:45:00Z", now)).toBe("SAKHAL BUREAU · 15 minutes ago");
  });
});

describe("priorsFacts", () => {
  it("returns lives lived / longest life / kills / usual end (usual end hot) for a returning player", () => {
    const facts = priorsFacts(base);
    expect(facts.map((f) => f.label)).toEqual(["Lives lived", "Longest life", "Kills, all lives", "Usual end"]);
    expect(facts.find((f) => f.label === "Lives lived")!.value).toBe("2");
    expect(facts.find((f) => f.label === "Usual end")!.value).toBe("Killed");
    expect(facts.find((f) => f.label === "Usual end")!.hot).toBe(true);
  });
  it("returns no rows for a first-lifer", () => {
    const first = { ...base, priorLives: 0, priors: { livesLived: 0, longestLifeSeconds: 0, totalKills: 0, usualDeathCause: null, lastDeathCause: null, bestLifeMap: null } };
    expect(priorsFacts(first)).toEqual([]);
  });
});

describe("birthShowingLine", () => {
  it("reads in-voice with (page, total, pageSize) argument order", () => {
    expect(birthShowingLine(2, 56, 20)).toBe("Showing 21–40 of 56 ashore");
  });
});
