import { describe, it, expect } from "vitest";
import {
  buildObituaryPrompt, describeDeath, parseObituary, composeTags, causeCategoryTag, OBITUARY_PROMPT_VERSION,
  NO_MECHANISM_DIRECTIVE, causeUnrecorded,
} from "../src/prompt.js";
import type { ObituaryFacts } from "../src/facts.js";
import { factsFor } from "./facts-fixture.js";

const pvp = factsFor({
  verdict: { cause: "pvp", attrBasis: "kill_line" },
  life: { deathCause: "pvp", deathByGamertag: "Killer Two", deathWeapon: "Mosin", deathDistance: 384.2, playtimeSeconds: 3456000 },
  kills: Array.from({ length: 212 }, () => ({ distanceMeters: 410 })),
  priors: { livesLived: 6, longestLifeSeconds: 172800, totalKills: 31, usualDeathCause: "pvp", lastDeathCause: "pvp", bestLifeMap: "chernarusplus" },
});
const fall = (over: Partial<ObituaryFacts> = {}): ObituaryFacts => ({ ...factsFor({ verdict: { cause: "fall" } }), ...over });

describe("buildObituaryPrompt", () => {
  it("puts the voice + JSON contract in system and the facts in user", () => {
    const { system, user } = buildObituaryPrompt(pvp);
    expect(system).toMatch(/deadpan/i);
    expect(system).toMatch(/No-Place Rule/i);
    expect(system).toMatch(/json/i);
    expect(user).toContain("Victim One");
    expect(user).toContain("Chernarus"); // labeled map, not codename
    expect(user).toContain("- Kills this life: 212");
    expect(user).toMatch(/legend/i); // isLegend -> reverent-tone directive
    expect(user).toContain("- Cause of death: killed by another player (Killer Two), Mosin, from 384\u00a0m.");
  });

  it("directs protective framing for a fresh-spawn victim", () => {
    const f = factsFor({ verdict: { cause: "pvp", attrBasis: "kill_line" }, life: { deathCause: "pvp", deathByGamertag: "Camper", playtimeSeconds: 600 } });
    expect(buildObituaryPrompt(f).user).toMatch(/protect|dignity|victim/i);
  });

  it("lists ordeal lines only when counts are non-zero", () => {
    const { user } = buildObituaryPrompt(factsFor({
      verdict: { cause: "fall" },
      ordeals: { infected: { encounters: 3, hits: 9, worstEncounterHits: 5 } },
      hpLow: 8,
    }));
    expect(user).toContain("Run-ins with the infected: 3 (the worst took 5 hits)");
    expect(user).not.toContain("Times caught fire");
    expect(user).toContain("Lowest health recorded: 8 of 100");
    expect(user).toContain("never quote raw stat numbers");
  });

  it("never mentions building, even when a build count is smuggled in", () => {
    const f = fall({
      ordeals: {
        infected: { encounters: 1, hits: 2, worstEncounterHits: 2 },
        fire: { encounters: 0, hits: 0, worstEncounterHits: 0 },
        pvp: { encounters: 0, hits: 0, worstEncounterHits: 0 },
        buildsPlaced: 399,
      } as ObituaryFacts["ordeals"],
    });
    expect(buildObituaryPrompt(f).user).not.toMatch(/built|building|structure/i);
  });

  it("a first-lifer gets the no-priors branch, never a priors bullet", () => {
    const { user } = buildObituaryPrompt(fall());
    expect(user).toContain("This was their first recorded life anywhere");
    expect(user).not.toContain("Prior lives lived:");
    expect(user).toMatch(/FIRST LIFE/);
  });

  it("a veteran gets the full priors block", () => {
    const { user } = buildObituaryPrompt(factsFor({
      verdict: { cause: "fall" },
      priors: { livesLived: 7, longestLifeSeconds: 259200, totalKills: 48, usualDeathCause: "wildlife", lastDeathCause: "blood loss", bestLifeMap: "sakhal" },
    }));
    expect(user).toContain("Prior lives lived: 7");
    expect(user).toContain("Longest prior life: 3d");
    expect(user).toContain("- Kills across all prior lives: 48");
    expect(user).toContain("Usual cause of death: wildlife");
    expect(user).toContain("Most recent prior death: blood loss");
    expect(user).toContain("Best run was on: Sakhal");
    expect(user).toMatch(/KNOWN QUANTITY/);
  });

  it("the prompt never says \"Confirmed kills\"", () => {
    for (const f of [pvp, fall(), factsFor({ priors: { livesLived: 2, totalKills: 3, trapKills: 1 } })]) {
      expect(buildObituaryPrompt(f).user).not.toMatch(/confirmed kills/i);
    }
  });

  // The published regression: an 11th life headlined "Livonia Debut".
  it("an 11th life with 15 priors states the prior count and explicitly forbids 'debut'", () => {
    const f = { ...factsFor({ verdict: { cause: "fall" }, priors: { livesLived: 15, totalKills: 3 } }), map: "enoch", lifeNumber: 11 };
    const { user } = buildObituaryPrompt(f);
    expect(user).toContain("Prior lives lived: 15");
    expect(user).toContain("Life number on this map: 11");
    expect(user).toContain("not a career count");
    expect(user).toMatch(/never call this a debut/i);
  });

  it("a sub-5-minute suicide is framed as a spawn reroll, not a decision", () => {
    const { user } = buildObituaryPrompt(factsFor({ verdict: { cause: "suicide" }, life: { deathCause: "suicide", playtimeSeconds: 20 } }));
    expect(user).toMatch(/reroll/i);
    expect(user).toContain("20 seconds");
    expect(user).not.toMatch(/despair|weight of/i);
  });

  it("a long suicide is framed as the end of a real run, and says how long it lasted", () => {
    const { user } = buildObituaryPrompt(factsFor({ verdict: { cause: "suicide" }, life: { deathCause: "suicide", playtimeSeconds: 5381 } }));
    expect(user).toMatch(/lasted 1h 29m/);
    expect(user).not.toMatch(/reroll/i);
    expect(user).toMatch(/never treat the act itself as the punchline/i);
  });

  it("a non-suicide death keeps the default tone branch", () => {
    const { user } = buildObituaryPrompt(fall());
    expect(user).toMatch(/state funeral for an idiot/);
    expect(user).not.toMatch(/reroll/i);
  });

  it("a cause that is not recorded gets the no-invention constraint and no cause line", () => {
    const f = factsFor({ verdict: { cause: "unknown", confidence: "unknown" } });
    expect(causeUnrecorded(f)).toBe(true);
    const { user } = buildObituaryPrompt(f);
    expect(user).toContain(NO_MECHANISM_DIRECTIVE);
    expect(user).not.toContain("Cause of death");
    expect(user).not.toContain("Describe the manner of death");
  });

  it("omits the constraint for a recorded mechanism", () => {
    const f = factsFor({ verdict: { cause: "infected" } });
    expect(causeUnrecorded(f)).toBe(false);
    const { user } = buildObituaryPrompt(f);
    expect(user).not.toContain(NO_MECHANISM_DIRECTIVE);
    expect(user).toContain("- Cause of death: killed by the infected.");
  });

  it("the v3 low-confidence hedge sentence is gone", () => {
    const { user } = buildObituaryPrompt(factsFor({ verdict: { cause: "starvation", confidence: "inferred" } }));
    expect(user).not.toContain("hedge it in-voice");
    expect(user).not.toContain("island");
  });
});

describe("buildObituaryPrompt — recent prose", () => {
  it("omits the block entirely when nothing is recent", () => {
    expect(buildObituaryPrompt(pvp).user).not.toMatch(/RECENTLY PUBLISHED/);
  });

  it("splices the do-not-reuse block when recent prose is supplied", () => {
    const { user } = buildObituaryPrompt(pvp, [
      { headline: "Old Screamer", attribution: "a bored coroner", opener: "He arrived with a flare." },
    ]);
    expect(user).toMatch(/do NOT reuse/i);
    expect(user).toContain("Old Screamer");
    expect(user).toContain("a bored coroner");
  });
});

describe("describeDeath", () => {
  it("is the writer line of the verdict, or null when the writer is given none", () => {
    expect(describeDeath(pvp)).toBe("killed by another player (Killer Two), Mosin, from 384\u00a0m");
    expect(describeDeath(fall())).toBe("fell to their death");
    expect(describeDeath(factsFor({ verdict: { cause: "starvation", confidence: "inferred" } }))).toBe("most likely starved");
    expect(describeDeath(factsFor({ verdict: { cause: "unknown", confidence: "unknown" } }))).toBeNull();
    expect(describeDeath(factsFor({ verdict: { cause: "restrained_logout" } }))).toBeNull();
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
});

describe("obituary-v4", () => {
  it("is prompt version obituary-v4", () => {
    expect(OBITUARY_PROMPT_VERSION).toBe("obituary-v4");
  });
  it("still carries the map dateline line — the map is the one allowed place", () => {
    expect(buildObituaryPrompt(pvp).user).toContain("Dateline (map only");
  });
});

describe("composeTags", () => {
  it("always leads with Obituaries + map + the death's tag and adds at most one flavor tag", () => {
    expect(composeTags(pvp, ["Poultry", "Chernarus", "Obituaries"])).toEqual(["Obituaries", "Chernarus", "PvP", "Poultry"]);
  });
  it("drops flavor tags that duplicate the reserved set, and works with no flavor", () => {
    expect(composeTags(pvp, ["Chernarus"])).toEqual(["Obituaries", "Chernarus", "PvP"]);
    expect(composeTags(pvp, [])).toEqual(["Obituaries", "Chernarus", "PvP"]);
  });
  it("causeCategoryTag is the death's tag", () => {
    expect(causeCategoryTag(factsFor({ verdict: { cause: "suicide" }, life: { deathCause: "suicide" } }))).toBe("Self-Inflicted");
    expect(causeCategoryTag(factsFor({ verdict: { cause: "explosive_trap", objectKey: "m67_grenade" } }))).toBe("Trap");
    expect(causeCategoryTag(factsFor({ verdict: { cause: "cold_exposure", confidence: "inferred" } }))).toBe("Exposure");
    expect(composeTags(factsFor({ verdict: { cause: "unknown", confidence: "unknown" } }), ["Elektro"])).toEqual(["Obituaries", "Chernarus", "Unknown", "Elektro"]);
  });
});
