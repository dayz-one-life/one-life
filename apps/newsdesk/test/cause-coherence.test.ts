import { describe, it, expect } from "vitest";
import { buildObituaryFacts } from "../src/facts.js";
import { composeTags, buildObituaryPrompt, causeUnrecorded, NO_MECHANISM_DIRECTIVE, UNKNOWN_DEATH_PHRASE } from "../src/prompt.js";
import type { ObituaryTarget } from "../src/pg-store.js";
import type { PlayerPriors } from "@onelife/read-models";

const noPriors: PlayerPriors = {
  livesLived: 0, longestLifeSeconds: 0, totalKills: 0,
  usualDeathCause: null, lastDeathCause: null, bestLifeMap: null,
};

const target: ObituaryTarget = {
  lifeId: 1, serverId: 1, gamertag: "Boots", map: "chernarusplus", mapSlug: "chernarus",
  lifeNumber: 3, lifeStartedAt: new Date("2026-07-09T02:00:00Z"), endedAt: new Date("2026-07-10T02:00:00Z"),
};

const timelineFor = (deathCause: string | null, verdict: unknown = null) =>
  ({
    life: { deathCause, deathByGamertag: null, deathWeapon: null, deathDistance: null, playtimeSeconds: 3600 },
    sessions: [{}],
    kills: [],
    character: null,
    qualifiedAt: null,
    verdict,
    ordeals: null,
    hpLow: null,
  }) as unknown as import("@onelife/read-models").LifeTimeline;

// The bug this file exists for: the paper contradicted itself on ~23% of deaths — an
// "Environment" tag over prose forbidden to name terrain, exposure, or weather.
describe("bare 'died' coherence: tag and prose agree", () => {
  it("tags Unknown and instructs the model that no mechanism is recorded", () => {
    const facts = buildObituaryFacts(target, timelineFor("died"), noPriors);

    expect(facts.causeCategory).toBe("unknown");
    expect(composeTags(facts, ["Elektro"])).toEqual(["Obituaries", "Chernarus", "Unknown", "Elektro"]);
    expect(composeTags(facts, [])).not.toContain("Environment");

    const { user } = buildObituaryPrompt(facts);
    expect(user).toContain(NO_MECHANISM_DIRECTIVE);
    expect(user).toContain(UNKNOWN_DEATH_PHRASE);
  });

  it("the invariant holds: causeCategory 'unknown' <=> causeUnrecorded, outside pvp", () => {
    for (const c of [null, "", "died", "environment", "environmental", "unknown"]) {
      const f = buildObituaryFacts(target, timelineFor(c), noPriors);
      expect(f.causeCategory).toBe("unknown");
      expect(causeUnrecorded(f)).toBe(true);
    }
    for (const c of ["bled_out", "starvation", "wolf", "fall", "infected"]) {
      const f = buildObituaryFacts(target, timelineFor(c), noPriors);
      expect(f.causeCategory).toBe("environment");
      expect(causeUnrecorded(f)).toBe(false);
    }
  });

  it("a real mechanism still tags Environment — the fix does not over-correct", () => {
    const f = buildObituaryFacts(target, timelineFor("bled_out"), noPriors);
    expect(composeTags(f, [])).toEqual(["Obituaries", "Chernarus", "Environment"]);
    expect(buildObituaryPrompt(f).user).not.toContain(NO_MECHANISM_DIRECTIVE);
  });

  it("a verdict-inferred mechanism tags Environment and drops the no-mechanism directive together", () => {
    const f = buildObituaryFacts(
      target,
      timelineFor("died", { cause: "starvation", confidence: "high", conditions: ["starving"], basis: {} }),
      noPriors,
    );
    expect(f.causeCategory).toBe("environment");
    expect(composeTags(f, [])).toContain("Environment");
    expect(buildObituaryPrompt(f).user).not.toContain(NO_MECHANISM_DIRECTIVE);
  });
});
