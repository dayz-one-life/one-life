import { describe, it, expect } from "vitest";
import { buildBirthPrompt, parseBirthNotice, composeBirthTags, BIRTH_PROMPT_VERSION } from "../src/birth-prompt.js";
import type { BirthFacts } from "../src/birth-facts.js";

const known: BirthFacts = {
  gamertag: "xX_Sn1per_Xx", map: "sakhal", mapSlug: "sakhal", lifeNumber: 5,
  bornAt: new Date("2026-07-17T02:00:00Z"), minutesToQualify: 12, persona: "Lewis",
  priors: { livesLived: 8, longestLifeSeconds: 90000, totalKills: 40, usualDeathCause: "pvp", lastDeathCause: "bled_out", bestLifeMap: "chernarusplus" },
  isKnownQuantity: true, endedAt: null,
};

const stranger: BirthFacts = {
  gamertag: "Boots", map: "chernarusplus", mapSlug: "chernarus", lifeNumber: 1,
  bornAt: new Date("2026-07-17T02:00:00Z"), minutesToQualify: 6, persona: null,
  priors: { livesLived: 0, longestLifeSeconds: 0, totalKills: 0, usualDeathCause: null, lastDeathCause: null, bestLifeMap: null },
  isKnownQuantity: false, endedAt: null,
};

describe("buildBirthPrompt", () => {
  it("puts the Nursery voice + Fog Rule + JSON contract in system and arrival facts in user", () => {
    const { system, user } = buildBirthPrompt(known);
    expect(system).toMatch(/nursery/i);
    expect(system).toMatch(/Fog Rule/i);
    expect(system).toMatch(/json/i);
    expect(user).toContain("xX_Sn1per_Xx");
    expect(user).toContain("Sakhal"); // labeled map, not the codename
    expect(user).toContain("12"); // minutesToQualify
    expect(user).toContain("Lewis"); // persona
  });

  it("uses the known-quantity tone directive and prints priors when the player has a record", () => {
    const { user } = buildBirthPrompt(known);
    expect(user).toMatch(/known quantity/i);
    expect(user).toContain("8"); // prior lives
    expect(user).toContain("Chernarus"); // bestLifeMap labeled
  });

  it("uses the stranger tone directive and the 'no priors' branch for a first-lifer", () => {
    const { user } = buildBirthPrompt(stranger);
    expect(user).toMatch(/stranger/i);
    expect(user).toMatch(/first|no priors/i);
    expect(user).not.toMatch(/known quantity/i);
  });
});

describe("parseBirthNotice", () => {
  const valid = JSON.stringify({
    headline: "Another Fool Washes Ashore", lede: "The tide brought a gift.", body: "It will not keep.",
    pullQuote: { text: "Welcome to the coast, kid.", attribution: "a voice on the coast" }, tags: ["Fresh Spawns", "Elektro"],
  });

  it("parses a valid birth notice object", () => {
    const b = parseBirthNotice(valid);
    expect(b.headline).toBe("Another Fool Washes Ashore");
    expect(b.pullQuote).toEqual({ text: "Welcome to the coast, kid.", attribution: "a voice on the coast" });
    expect(b.tags).toEqual(["Fresh Spawns", "Elektro"]);
  });

  it("salvages the first {...} block from prose-wrapped JSON", () => {
    const b = parseBirthNotice("Sure, here you go:\n" + valid + "\nHope that helps.");
    expect(b.headline).toBe("Another Fool Washes Ashore");
  });

  it("accepts a null pull quote", () => {
    const b = parseBirthNotice(JSON.stringify({ headline: "H", lede: "L", body: "B", pullQuote: null, tags: [] }));
    expect(b.pullQuote).toBeNull();
  });

  it("throws on non-JSON", () => {
    expect(() => parseBirthNotice("not json at all")).toThrow();
  });

  it("throws on an empty headline", () => {
    expect(() => parseBirthNotice(JSON.stringify({ headline: "", lede: "L", body: "B", pullQuote: null, tags: [] }))).toThrow();
  });

  it("throws when tags is missing", () => {
    expect(() => parseBirthNotice(JSON.stringify({ headline: "H", lede: "L", body: "B", pullQuote: null }))).toThrow();
  });

  it("exposes a stable prompt version", () => {
    expect(BIRTH_PROMPT_VERSION).toBe("birth-v1");
  });
});

describe("composeBirthTags", () => {
  it("leads with Fresh Spawns + map + Repeat Offender for a known quantity and adds one flavor tag", () => {
    expect(composeBirthTags(known, ["Poultry", "Sakhal", "Fresh Spawns"])).toEqual(["Fresh Spawns", "Sakhal", "Repeat Offender", "Poultry"]);
  });

  it("uses First Life for a stranger and drops flavor tags that duplicate the reserved set", () => {
    expect(composeBirthTags(stranger, ["Chernarus"])).toEqual(["Fresh Spawns", "Chernarus", "First Life"]);
    expect(composeBirthTags(stranger, [])).toEqual(["Fresh Spawns", "Chernarus", "First Life"]);
  });
});
