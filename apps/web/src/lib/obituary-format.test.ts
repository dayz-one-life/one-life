import { describe, it, expect } from "vitest";
import { obituariesHref, obituaryHref, dateline, rapSheetFacts, obituaryShowingLine } from "./obituary-format";
import type { ObituaryCard } from "./types";

const now = new Date("2026-07-12T00:00:00Z");
const card: ObituaryCard = {
  slug: "gone-42", gamertag: "Boots", map: "chernarusplus", mapSlug: "chernarus", lifeNumber: 3,
  headline: "H", lede: "L", tags: ["Obituaries"], timeAliveSeconds: 7200, kills: 3,
  longestKillMeters: 210, cause: "pvp", deathAt: "2026-07-10T00:00:00Z", imageUrl: null, imageCaption: null,
};

describe("obituary hrefs", () => {
  it("feed href omits page 1", () => {
    expect(obituariesHref(1)).toBe("/obituaries");
    expect(obituariesHref(3)).toBe("/obituaries?page=3");
  });
  it("article href", () => {
    expect(obituaryHref("gone-42")).toBe("/obituaries/gone-42");
  });
});

describe("dateline", () => {
  it("labels the map (codename → name) and adds a relative time", () => {
    expect(dateline("chernarusplus", "2026-07-10T00:00:00Z", now)).toMatch(/^CHERNARUS BUREAU · /);
  });
});

describe("rapSheetFacts", () => {
  it("builds Survived/Kills/Longest kill/Cause, cause hot", () => {
    const facts = rapSheetFacts(card);
    expect(facts.map((f) => f.label)).toEqual(["Survived", "Kills", "Longest kill", "Cause"]);
    expect(facts.find((f) => f.label === "Longest kill")!.value).toBe("210m");
    expect(facts.find((f) => f.label === "Cause")!.hot).toBe(true);
  });
  it("omits longest kill when null", () => {
    const facts = rapSheetFacts({ ...card, longestKillMeters: null });
    expect(facts.map((f) => f.label)).not.toContain("Longest kill");
  });
  it("rapSheetFacts prefers the classified verdict for the Cause row", () => {
    const facts = rapSheetFacts({ timeAliveSeconds: 3600, kills: 0, longestKillMeters: null, cause: "died", verdict: { cause: "starvation", confidence: "low", conditions: ["starving"] } });
    expect(facts[facts.length - 1]).toEqual({ label: "Cause", value: "Likely starvation", hot: true });
  });
});

describe("obituaryShowingLine", () => {
  it("reads in-voice", () => {
    expect(obituaryShowingLine(1, 20, 45)).toBe("Showing 1–20 of 45 filed");
  });
});
