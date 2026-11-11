import { describe, it, expect } from "vitest";
import { buildObituaryPrompt, describeDeath, parseObituary, composeTags, causeCategoryTag, OBITUARY_PROMPT_VERSION, UNKNOWN_DEATH_PHRASE, NO_MECHANISM_DIRECTIVE, NAMES_NO_PERSON_DIRECTIVE, causeUnrecorded } from "../src/prompt.js";
import type { ObituaryFacts } from "../src/facts.js";

const facts: ObituaryFacts = {
  gamertag: "xX_Sn1per_Xx", map: "chernarusplus", mapSlug: "chernarus", lifeNumber: 4,
  timeAliveSeconds: 3456000, timeAliveLabel: "40d", kills: 212, longestKillMeters: 410,
  sessions: 30, cause: "pvp", causeCategory: "pvp", killerGamertag: "Chicken", weapon: "Reload",
  isLegend: true, freshSpawnVictim: false, endedAt: "2026-07-10T22:16:00.000Z",
  deathDistance: null, verdict: null, ordeals: null, hpLow: null,
  priors: { livesLived: 6, longestLifeSeconds: 172800, totalKills: 31, usualDeathCause: "pvp", lastDeathCause: "pvp", bestLifeMap: "chernarusplus" },
  isKnownQuantity: true,
};

const mkFacts = (overrides: Partial<ObituaryFacts>): ObituaryFacts => ({ ...facts, ...overrides });

describe("buildObituaryPrompt", () => {
  it("puts the voice + JSON contract in system and the facts in user", () => {
    const { system, user } = buildObituaryPrompt(facts);
    expect(system).toMatch(/deadpan/i);
    expect(system).toMatch(/No-Place Rule/i);
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
      ordeals: { infected: { encounters: 3, hits: 9, worstEncounterHits: 5 }, fire: { encounters: 0, hits: 0, worstEncounterHits: 0 }, pvp: { encounters: 0, hits: 0, worstEncounterHits: 0 } },
      hpLow: 8,
    }));
    expect(user).toContain("Run-ins with the infected: 3 (the worst took 5 hits)");
    expect(user).not.toContain("Times caught fire");
    expect(user).toContain("Lowest health recorded: 8 of 100");
    expect(user).toContain("hedge it in-voice");
    expect(user).toContain("never quote raw stat numbers");
  });

  it("never mentions building, even when a build count is smuggled in", () => {
    const { user } = buildObituaryPrompt(mkFacts({
      // buildsPlaced is no longer part of the type — cast it in deliberately, to prove the
      // prompt builder ignores it rather than merely never receiving it.
      ordeals: {
        infected: { encounters: 1, hits: 2, worstEncounterHits: 2 },
        fire: { encounters: 0, hits: 0, worstEncounterHits: 0 },
        pvp: { encounters: 0, hits: 0, worstEncounterHits: 0 },
        buildsPlaced: 399,
      } as ObituaryFacts["ordeals"],
    }));
    expect(user).not.toMatch(/built|building|structure/i);
  });

  it("a first-lifer gets the no-priors branch, never a priors bullet", () => {
    const { user } = buildObituaryPrompt(mkFacts({
      isLegend: false, isKnownQuantity: false,
      priors: { livesLived: 0, longestLifeSeconds: 0, totalKills: 0, usualDeathCause: null, lastDeathCause: null, bestLifeMap: null },
    }));
    expect(user).toContain("This was their first recorded life anywhere");
    expect(user).not.toContain("Prior lives lived:");
    expect(user).toMatch(/FIRST LIFE/);
  });

  it("a veteran gets the full priors block", () => {
    const { user } = buildObituaryPrompt(mkFacts({
      isLegend: false, isKnownQuantity: true,
      priors: { livesLived: 7, longestLifeSeconds: 259200, totalKills: 48, usualDeathCause: "animal", lastDeathCause: "bled_out", bestLifeMap: "sakhal" },
    }));
    expect(user).toContain("Prior lives lived: 7");
    expect(user).toContain("Longest prior life: 3d");
    expect(user).toContain("Confirmed kills across all prior lives: 48");
    expect(user).toContain("Usual cause of death: animal");
    expect(user).toContain("Most recent prior death: bled_out");
    expect(user).toContain("Best run was on: Sakhal");
    expect(user).toMatch(/KNOWN QUANTITY/);
  });

  // The published regression: an 11th life headlined "Livonia Debut". The per-map life number is
  // NOT a career count — the prior count must be in the prompt, and the prompt must explicitly
  // forbid the exact word the model produced in production.
  it("an 11th life with 15 priors states the prior count and explicitly forbids 'debut'", () => {
    const { user } = buildObituaryPrompt(mkFacts({
      map: "enoch", lifeNumber: 11, isLegend: false, isKnownQuantity: true,
      priors: { livesLived: 15, longestLifeSeconds: 90000, totalKills: 3, usualDeathCause: "infected", lastDeathCause: "infected", bestLifeMap: "chernarusplus" },
    }));
    expect(user).toContain("Prior lives lived: 15");
    expect(user).toContain("Life number on this map: 11");
    expect(user).toContain("not a career count");
    expect(user).toMatch(/never call this a debut/i);
  });

  it("a sub-5-minute suicide is framed as a spawn reroll, not a decision", () => {
    const { user } = buildObituaryPrompt(mkFacts({
      isLegend: false, kills: 0, killerGamertag: null, weapon: null,
      cause: "suicide", causeCategory: "suicide",
      timeAliveSeconds: 20, timeAliveLabel: "0m", verdict: null,
    }));
    expect(user).toMatch(/reroll/i);
    expect(user).toContain("20 seconds");
    expect(user).not.toMatch(/despair|weight of/i);
  });

  it("a long suicide is framed as the end of a real run, and says how long it lasted", () => {
    const { user } = buildObituaryPrompt(mkFacts({
      isLegend: false, kills: 2, killerGamertag: null, weapon: null,
      cause: "suicide", causeCategory: "suicide",
      timeAliveSeconds: 5381, timeAliveLabel: "1h 29m", verdict: null,
    }));
    expect(user).toMatch(/lasted 1h 29m/);
    expect(user).not.toMatch(/reroll/i);
    expect(user).toMatch(/never treat the act itself as the punchline/i);
  });

  it("a non-suicide death keeps the default tone branch", () => {
    const { user } = buildObituaryPrompt(mkFacts({ isLegend: false, freshSpawnVictim: false, causeCategory: "environment", cause: "bled_out" }));
    expect(user).toMatch(/state funeral for an idiot/);
    expect(user).not.toMatch(/reroll/i);
  });

  // D4 — 18 of the 45 published obituaries were written from a bare "died". Saying "unknown" in
  // the facts is not enough; the model must be told that inventing a mechanism is the failure.
  it.each([
    ["null cause", null],
    ["bare 'died'", "died"],
    ["bare 'environment'", "environment"],
    ["bare 'unknown'", "unknown"],
  ])("adds the no-invention constraint when the cause is unrecorded (%s)", (_label, cause) => {
    const { user } = buildObituaryPrompt(mkFacts({
      causeCategory: "unknown", cause, killerGamertag: null, verdict: null,
      isLegend: false, freshSpawnVictim: false,
    }));
    expect(user).toContain(NO_MECHANISM_DIRECTIVE);
    expect(user).toContain("THE CAUSE OF DEATH IS NOT RECORDED");
    expect(user).toContain("the ABSENCE of a cause IS the story");
    expect(user).toContain(UNKNOWN_DEATH_PHRASE);
  });

  it("omits the constraint for a recorded mechanism", () => {
    const { user } = buildObituaryPrompt(mkFacts({
      causeCategory: "environment", cause: "infected", killerGamertag: null,
      verdict: { cause: "infected", confidence: "high", conditions: [] },
      isLegend: false, freshSpawnVictim: false,
    }));
    expect(user).not.toContain(NO_MECHANISM_DIRECTIVE);
    expect(user).toContain("killed by the infected");
  });

  it("omits the constraint for a pvp death even when the cause token is bare", () => {
    const { user } = buildObituaryPrompt(mkFacts({
      causeCategory: "pvp", cause: "died", killerGamertag: "Kilo", weapon: "M4A1", verdict: null,
      isLegend: false, freshSpawnVictim: false,
    }));
    expect(user).not.toContain(NO_MECHANISM_DIRECTIVE);
    expect(user).toContain("killed by another player (Kilo)");
  });

  // Regression: an unrecorded cause (bare "died") always carries a low-confidence "unknown"
  // verdict from classifyDeath, since life-timeline always populates a verdict for an ended life.
  // The no-mechanism directive and the low-confidence hedge must never co-render — the hedge
  // implies an inferred cause exists right after the directive says none does.
  it("an unrecorded cause with a low-confidence 'unknown' verdict gets the no-mechanism directive, never the hedge", () => {
    const { user } = buildObituaryPrompt(mkFacts({
      causeCategory: "unknown", cause: "died", killerGamertag: null,
      verdict: { cause: "unknown", confidence: "low", conditions: [] },
      isLegend: false, freshSpawnVictim: false,
    }));
    expect(user).toContain(NO_MECHANISM_DIRECTIVE);
    expect(user).not.toContain("hedge it in-voice");
  });

  it("causeUnrecorded is false for pvp and for any recorded mechanism", () => {
    expect(causeUnrecorded(mkFacts({ causeCategory: "unknown", cause: "died", killerGamertag: null, verdict: null }))).toBe(true);
    expect(causeUnrecorded(mkFacts({ causeCategory: "unknown", cause: null, killerGamertag: null, verdict: null }))).toBe(true);
    expect(causeUnrecorded(mkFacts({ causeCategory: "pvp", cause: "died", killerGamertag: "Kilo", verdict: null }))).toBe(false);
    expect(causeUnrecorded(mkFacts({ causeCategory: "environment", cause: "wolf", killerGamertag: null, verdict: null }))).toBe(false);
    expect(causeUnrecorded(mkFacts({
      causeCategory: "environment", cause: "died", killerGamertag: null,
      verdict: { cause: "starvation", confidence: "high", conditions: [] },
    }))).toBe(false);
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

  it("a suicide with no verdict reads in-voice, not as the raw token", () => {
    const s = describeDeath(mkFacts({ cause: "suicide", causeCategory: "suicide", killerGamertag: null, weapon: null, verdict: null }));
    expect(s).toBe("died by their own hand (not a player kill).");
  });

  it("describeDeath: named killers read qualitatively", () => {
    expect(describeDeath(mkFacts({ causeCategory: "environment", cause: "wolf", verdict: { cause: "wolf", confidence: "high", conditions: ["healthy"] } })))
      .toBe("killed by a wolf (not a player kill). They were in good health at the end.");
    expect(describeDeath(mkFacts({ causeCategory: "environment", cause: "fall", verdict: { cause: "fall", confidence: "high", conditions: [] } })))
      .toBe("died in a fall (not a player kill).");
  });

  // D4 — the most-exercised path in the system: 19 of 84 recorded deaths carry a bare "died",
  // and 18 of 45 published obituaries were written from one. A bare mechanism token invites the
  // model to invent one ("Terrain" for a death actually recorded as infected).
  it.each([
    ["null cause", null],
    ["empty cause", ""],
    ["bare 'died'", "died"],
    ["bare 'environment'", "environment"],
    ["bare 'unknown'", "unknown"],
  ])("no verdict + %s reads as an explicit unknown, never a mechanism", (_label, cause) => {
    const s = describeDeath(mkFacts({ causeCategory: "unknown", cause, verdict: null, killerGamertag: null }));
    expect(s).toBe(UNKNOWN_DEATH_PHRASE);
    expect(s).toBe("unknown — the record does not name a mechanism.");
    expect(s).not.toMatch(/fall|terrain|wolf|bear|animal|infected|starv|dehydrat|environment/i);
  });

  it("a verdict that names nothing also reads as an explicit unknown, keeping the factual state", () => {
    const s = describeDeath(mkFacts({
      causeCategory: "unknown", cause: "died", killerGamertag: null,
      verdict: { cause: "unknown", confidence: "low", conditions: ["starving"] },
    }));
    expect(s).toBe("unknown — the record does not name a mechanism. At the end they were starving.");
  });

  it("an 'environmental' verdict over a REAL mechanism still names the mechanism", () => {
    const s = describeDeath(mkFacts({
      causeCategory: "environment", cause: "infected", killerGamertag: null,
      verdict: { cause: "environmental", confidence: "high", conditions: [] },
    }));
    expect(s).toBe("infected (not a player kill).");
  });

  it.each([
    ["infected", "infected (not a player kill)."],
    ["wolf", "wolf (not a player kill)."],
    ["bled_out", "bled out (not a player kill)."],
    ["fall", "fall (not a player kill)."],
  ])("a known cause (%s) with no verdict still describes normally", (cause, expected) => {
    expect(describeDeath(mkFacts({ causeCategory: "environment", cause, verdict: null, killerGamertag: null })))
      .toBe(expected);
  });

  it("pvp wins over an unrecorded cause token — a player kill is never an unknown", () => {
    const s = describeDeath(mkFacts({ causeCategory: "pvp", cause: "died", killerGamertag: "Kilo", weapon: "M4A1", deathDistance: 384.2, verdict: null }));
    expect(s).toBe("killed by another player (Kilo), M4A1, from 384m.");
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
    expect(OBITUARY_PROMPT_VERSION).toBe("obituary-v3.1");
  });
});

describe("obituary-v3", () => {
  it("is prompt version obituary-v3.1", () => {
    expect(OBITUARY_PROMPT_VERSION).toBe("obituary-v3.1");
  });
  it("still carries the map dateline line — the map is the one allowed place", () => {
    const { user } = buildObituaryPrompt(facts);
    expect(user).toContain("Dateline (map only");
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

  it("tags a suicide Self-Inflicted, not Unknown", () => {
    expect(causeCategoryTag("suicide")).toBe("Self-Inflicted");
    expect(causeCategoryTag("pvp")).toBe("PvP");
    expect(causeCategoryTag("environment")).toBe("Environment");
    expect(causeCategoryTag("unknown")).toBe("Unknown");
    const f = mkFacts({ cause: "suicide", causeCategory: "suicide", killerGamertag: null, weapon: null });
    expect(composeTags(f, ["Elektro"])).toEqual(["Obituaries", "Chernarus", "Self-Inflicted", "Elektro"]);
  });
});

// v3.1 — the parser now stores `explosion` and `vehicle` for deaths a kill line pins on an object
// (a grenade, a mine, a tripwire, a 40mm round, a fuel pump, a riderless motorbike). The log names
// no person on those lines. That is NOT the same as there being no person, and the prose goes to
// places it cannot be edited — so the prompt may neither deny a player's hand nor point at one.
describe("obituary-v3.1 — explosion and vehicle name no person", () => {
  const env = (overrides: Partial<ObituaryFacts>) =>
    mkFacts({ causeCategory: "environment", killerGamertag: null, weapon: null, ...overrides });
  // The three ways a cause reaches describeDeath: no verdict, a verdict that names it, and a
  // verdict that names nothing over a recorded cause.
  const paths = (cause: string): ObituaryFacts[] => [
    env({ cause, verdict: null }),
    env({ cause, verdict: { cause, confidence: "high", conditions: [] } }),
    env({ cause, verdict: { cause: "environmental", confidence: "high", conditions: [] } }),
  ];

  it('explosion and vehicle carry no "(not a player kill)"', () => {
    for (const cause of ["explosion", "vehicle"]) {
      for (const f of paths(cause)) {
        expect(describeDeath(f)).not.toContain("not a player kill");
        expect(buildObituaryPrompt(f).user).not.toContain("not a player kill");
      }
    }
    expect(describeDeath(paths("explosion")[1]!)).toBe("killed in an explosion.");
    expect(describeDeath(paths("vehicle")[1]!)).toBe("killed by a vehicle.");
    expect(describeDeath(paths("explosion")[0]!)).toBe("explosion.");
    expect(describeDeath(paths("vehicle")[2]!)).toBe("vehicle.");
  });

  it("keeps the hedge and the end-of-life state around the shortened phrase", () => {
    expect(describeDeath(env({ cause: "explosion", verdict: { cause: "explosion", confidence: "low", conditions: ["starving"] } })))
      .toBe("likely killed in an explosion. At the end they were starving.");
  });

  it("they carry the names-no-person directive", () => {
    expect(NAMES_NO_PERSON_DIRECTIVE).toBe(
      "The record names no person behind this. Do not name, hint at or speculate about anyone, and do not say that no one was involved.",
    );
    for (const cause of ["explosion", "vehicle"]) {
      for (const f of paths(cause)) expect(buildObituaryPrompt(f).user).toContain(NAMES_NO_PERSON_DIRECTIVE);
    }
  });

  it("suicide and infected are unchanged", () => {
    const suicide = env({ cause: "suicide", causeCategory: "suicide", verdict: null });
    expect(describeDeath(suicide)).toBe("died by their own hand (not a player kill).");
    expect(buildObituaryPrompt(suicide).user).not.toContain(NAMES_NO_PERSON_DIRECTIVE);

    const infected = env({ cause: "infected", verdict: { cause: "infected", confidence: "high", conditions: [] } });
    expect(describeDeath(infected)).toBe("killed by the infected (not a player kill).");
    expect(buildObituaryPrompt(infected).user).not.toContain(NAMES_NO_PERSON_DIRECTIVE);
    expect(describeDeath(env({ cause: "infected", verdict: null }))).toBe("infected (not a player kill).");
  });

  it("a player kill never carries the directive, whatever the weapon", () => {
    const { user } = buildObituaryPrompt(mkFacts({ cause: "pvp", causeCategory: "pvp", killerGamertag: "Killer Two", weapon: "M79" }));
    expect(user).not.toContain(NAMES_NO_PERSON_DIRECTIVE);
  });

  it("the tag is still Environment", () => {
    expect(composeTags(paths("explosion")[0]!, [])).toEqual(["Obituaries", "Chernarus", "Environment"]);
  });
});
