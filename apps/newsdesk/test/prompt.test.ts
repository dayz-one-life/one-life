import { describe, it, expect } from "vitest";
import { buildObituaryPrompt, parseObituary, composeTags, OBITUARY_PROMPT_VERSION } from "../src/prompt.js";
import type { ObituaryFacts } from "../src/facts.js";

const facts: ObituaryFacts = {
  gamertag: "xX_Sn1per_Xx", map: "chernarusplus", mapSlug: "chernarus", lifeNumber: 4,
  timeAliveSeconds: 3456000, timeAliveLabel: "40d", kills: 212, longestKillMeters: 410,
  sessions: 30, cause: "pvp", causeCategory: "pvp", killerGamertag: "Chicken", weapon: "Reload",
  isLegend: true, freshSpawnVictim: false, endedAt: "2026-07-10T22:16:00.000Z",
};

describe("buildObituaryPrompt", () => {
  it("puts the voice + JSON contract in system and the facts in user", () => {
    const { system, user } = buildObituaryPrompt(facts);
    expect(system).toMatch(/deadpan/i);
    expect(system).toMatch(/Fog Rule/i);
    expect(system).toMatch(/json/i);
    expect(user).toContain("xX_Sn1per_Xx");
    expect(user).toContain("Chernarus"); // labeled map, not codename
    expect(user).toContain("212");
    expect(user).toMatch(/legend/i); // isLegend -> reverent-tone directive
  });

  it("directs protective framing for a fresh-spawn victim", () => {
    const { user } = buildObituaryPrompt({ ...facts, isLegend: false, freshSpawnVictim: true, kills: 0, killerGamertag: "Camper" });
    expect(user).toMatch(/protect|dignity|victim/i);
  });
});

describe("parseObituary", () => {
  const valid = JSON.stringify({
    headline: "The King Is Dead", lede: "He arrived with a flare.", body: "He left 212 kills.",
    pullQuote: { text: "You do not get a second life.", attribution: "a rival" }, tags: ["Obituaries", "Chernarus"],
  });

  it("parses a valid obituary object", () => {
    const o = parseObituary(valid);
    expect(o.headline).toBe("The King Is Dead");
    expect(o.pullQuote).toEqual({ text: "You do not get a second life.", attribution: "a rival" });
    expect(o.tags).toEqual(["Obituaries", "Chernarus"]);
  });

  it("accepts a null pull quote", () => {
    const o = parseObituary(JSON.stringify({ headline: "H", lede: "L", body: "B", pullQuote: null, tags: ["Obituaries"] }));
    expect(o.pullQuote).toBeNull();
  });

  it("throws on non-JSON", () => {
    expect(() => parseObituary("not json at all")).toThrow();
  });

  it("throws on an empty headline", () => {
    expect(() => parseObituary(JSON.stringify({ headline: "", lede: "L", body: "B", pullQuote: null, tags: ["Obituaries"] }))).toThrow();
  });

  it("throws when tags is missing", () => {
    expect(() => parseObituary(JSON.stringify({ headline: "H", lede: "L", body: "B", pullQuote: null }))).toThrow();
  });

  it("exposes a stable prompt version", () => {
    expect(OBITUARY_PROMPT_VERSION).toBe("obituary-v1");
  });
});

describe("composeTags", () => {
  it("always leads with Obituaries + map + cause and adds at most one flavor tag", () => {
    expect(composeTags(facts, ["Poultry", "Chernarus", "Obituaries"])).toEqual(["Obituaries", "Chernarus", "PvP", "Poultry"]);
  });
  it("drops flavor tags that duplicate the reserved set, and works with no flavor", () => {
    expect(composeTags(facts, ["Chernarus"])).toEqual(["Obituaries", "Chernarus", "PvP"]);
    expect(composeTags(facts, [])).toEqual(["Obituaries", "Chernarus", "PvP"]);
  });
});
