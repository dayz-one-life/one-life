import { describe, it, expect } from "vitest";
import { buildObituaryPrompt, describeDeath, parseObituary, composeTags, OBITUARY_PROMPT_VERSION } from "../src/prompt.js";
import type { ObituaryFacts } from "../src/facts.js";

const facts: ObituaryFacts = {
  gamertag: "xX_Sn1per_Xx", map: "chernarusplus", mapSlug: "chernarus", lifeNumber: 4,
  timeAliveSeconds: 3456000, timeAliveLabel: "40d", kills: 212, longestKillMeters: 410,
  sessions: 30, cause: "pvp", causeCategory: "pvp", killerGamertag: "Chicken", weapon: "Reload",
  isLegend: true, freshSpawnVictim: false, endedAt: "2026-07-10T22:16:00.000Z",
  deathDistance: null, verdict: null, ordeals: null, hpLow: null,
};

const mkFacts = (overrides: Partial<ObituaryFacts>): ObituaryFacts => ({ ...facts, ...overrides });

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

  it("prompt lists ordeal lines only when counts are non-zero and hedges low-confidence causes", () => {
    const { user } = buildObituaryPrompt(mkFacts({
      causeCategory: "environment", cause: "died",
      verdict: { cause: "starvation", confidence: "low", conditions: ["starving"] },
      ordeals: { infected: { encounters: 3, hits: 9, worstEncounterHits: 5 }, fire: { encounters: 0, hits: 0, worstEncounterHits: 0 }, pvp: { encounters: 0, hits: 0, worstEncounterHits: 0 }, buildsPlaced: 0 },
      hpLow: 8,
    }));
    expect(user).toContain("Run-ins with the infected: 3 (the worst took 5 hits)");
    expect(user).not.toContain("Times caught fire");
    expect(user).toContain("Lowest health recorded: 8 of 100");
    expect(user).toContain("hedge it in-voice");
    expect(user).toContain("never quote raw stat numbers");
  });
});

describe("buildObituaryPrompt — recent prose", () => {
  it("omits the block entirely when nothing is recent", () => {
    const { user } = buildObituaryPrompt(facts);
    expect(user).not.toMatch(/RECENTLY PUBLISHED/);
  });

  it("splices the do-not-reuse block when recent prose is supplied", () => {
    const { user } = buildObituaryPrompt(facts, [
      { headline: "Old Screamer", attribution: "a bored coroner", opener: "He arrived with a flare." },
    ]);
    expect(user).toMatch(/do NOT reuse/i);
    expect(user).toContain("Old Screamer");
    expect(user).toContain("a bored coroner");
  });
});

describe("describeDeath", () => {
  it("pvp includes killer, weapon, and distance", () => {
    const s = describeDeath(mkFacts({ causeCategory: "pvp", killerGamertag: "Kilo", weapon: "M4A1", deathDistance: 384.2 }));
    expect(s).toBe("killed by another player (Kilo), M4A1, from 384m.");
  });

  it("high-confidence starvation is qualitative, no raw stats", () => {
    const s = describeDeath(mkFacts({
      causeCategory: "environment", cause: "died",
      verdict: { cause: "starvation", confidence: "high", conditions: ["starving"] },
    }));
    expect(s).toContain("starvation");
    expect(s).not.toMatch(/\d{2,}/); // no stat numbers leak
  });

  it("low confidence hedges with 'likely'", () => {
    const s = describeDeath(mkFacts({
      causeCategory: "environment", cause: "died",
      verdict: { cause: "dehydration", confidence: "low", conditions: ["dehydrated", "hunted"] },
    }));
    expect(s).toMatch(/^likely dehydration/);
  });

  it("no verdict falls back to the mechanism, humanized", () => {
    const s = describeDeath(mkFacts({ causeCategory: "environment", cause: "bled_out", verdict: null }));
    expect(s).toBe("bled out (not a player kill).");
  });

  it("describeDeath: named killers read qualitatively", () => {
    expect(describeDeath(mkFacts({ causeCategory: "environment", cause: "wolf", verdict: { cause: "wolf", confidence: "high", conditions: ["healthy"] } })))
      .toBe("killed by a wolf (not a player kill). They were in good health at the end.");
    expect(describeDeath(mkFacts({ causeCategory: "environment", cause: "fall", verdict: { cause: "fall", confidence: "high", conditions: [] } })))
      .toBe("died in a fall (not a player kill).");
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
    expect(OBITUARY_PROMPT_VERSION).toBe("obituary-v2");
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
