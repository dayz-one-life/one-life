import { describe, it, expect } from "vitest";
import { obituariesHref, obituaryHref, dateline, rapSheetFacts, obituaryShowingLine, obituaryHeadlineSize } from "./obituary-format";
import type { ObituaryCard } from "./types";

const now = new Date("2026-07-12T00:00:00Z");
const card: ObituaryCard = {
  slug: "gone-42", gamertag: "Boots", map: "chernarusplus", mapSlug: "chernarus", lifeNumber: 3,
  headline: "H", lede: "L", tags: ["Obituaries"], timeAliveSeconds: 7200, kills: 3,
  longestKillMeters: 210, cause: "pvp", deathAt: "2026-07-10T00:00:00Z", death: null,
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

describe("rapSheetFacts with a death (stage 4)", () => {
  const live = {
    status: "final" as const, key: "fuel_pump", tag: "Explosion", certainty: "definitive" as const, label: "Fuel pump explosion",
    detail: null, sentence: "Killed by an exploding fuel pump.", caption: null, killerGamertag: null, driverGamertag: null,
    credit: null, trap: false, selfStated: false, cause: "explosion", confidence: "high" as const, conditions: [],
  };
  it("the live label wins over the frozen legacy wording", () => {
    const facts = rapSheetFacts({ ...card, cause: "explosion", verdict: { cause: "explosion", confidence: "high", conditions: [] }, death: live });
    expect(facts[facts.length - 1]).toEqual({ label: "Cause", value: "Fuel pump explosion", hot: true, caption: null });
  });
  it("returns the caption of an inferred cause", () => {
    const inferred = { ...live, key: "starvation_and_thirst", certainty: "inferred" as const, label: "Likely starvation and thirst",
      caption: "Best reading of the log. The server recorded no cause." };
    const facts = rapSheetFacts({ ...card, cause: "died", death: inferred });
    expect(facts[facts.length - 1]).toMatchObject({ value: "Likely starvation and thirst", caption: "Best reading of the log. The server recorded no cause." });
  });
  it("frozen strings print as they were frozen", () => {
    const frozen = { status: "frozen" as const, key: "fall", tag: "Fall", certainty: "definitive", label: "Fell", detail: null, sentence: "Fell to their death.", caption: null };
    const facts = rapSheetFacts({ ...card, cause: "died", death: frozen });
    expect(facts[facts.length - 1]!.value).toBe("Fell");
  });
});

describe("obituaryShowingLine", () => {
  it("reads in-voice", () => {
    expect(obituaryShowingLine(1, 20, 45)).toBe("Showing 1–20 of 45 filed");
  });
});

describe("obituaryHeadlineSize", () => {
  it("steps down at the 45- and 75-char boundaries", () => {
    expect(obituaryHeadlineSize("a".repeat(45))).toBe(76);
    expect(obituaryHeadlineSize("a".repeat(46))).toBe(62);
    expect(obituaryHeadlineSize("a".repeat(75))).toBe(62);
    expect(obituaryHeadlineSize("a".repeat(76))).toBe(52);
  });
});
