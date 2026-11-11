import { describe, it, expect } from "vitest";
import { findCauseViolations, holdsKillCount, splitSentences } from "../src/cause-check.js";
import type { Obituary } from "../src/prompt.js";
import type { ObituaryFacts } from "../src/facts.js";
import { factsFor } from "./facts-fixture.js";

/** ⚠️ Invented names and prose only. */
const draft = (o: Partial<Obituary> = {}): Obituary => ({
  headline: "A Quiet Ending",
  lede: "Victim One lasted two hours and change.",
  body: "The record keeps the hours and little else.",
  pullQuote: { text: "Nobody saw it coming.", attribution: "a weary clerk" },
  tags: ["Paperwork"],
  ...o,
});
const NO = { logoutFamily: false };
const check = (o: Partial<Obituary>, f: ObituaryFacts, hints = NO) => findCauseViolations(draft(o), f, hints);

const stated = factsFor({ verdict: { cause: "fall" } });
const inferredCold = factsFor({ verdict: { cause: "cold_exposure", confidence: "inferred" } });
const inferredHunger = factsFor({ verdict: { cause: "starvation", confidence: "inferred" } });
const statedCold = factsFor({ verdict: { cause: "cold_exposure", confidence: "definitive" } });

describe("helpers", () => {
  it("splits sentences on terminal punctuation and line breaks", () => {
    expect(splitSentences("One. Two? Three!\nFour")).toEqual(["One.", "Two?", "Three!", "Four"]);
  });
  it("finds a number within three words of a kill word", () => {
    expect(holdsKillCount("Three kills and a short life")).toBe(true);
    expect(holdsKillCount("He killed three before noon")).toBe(true);
    expect(holdsKillCount("12 bodies")).toBe(true);
    expect(holdsKillCount("A short life with a long list of kills")).toBe(false);
  });
});

describe("rules 1 and 3: words that are never public", () => {
  it("\"logged out\" in a headline is a violation", () => {
    expect(check({ headline: "Logged Out For Good" }, stated)).not.toEqual([]);
  });
  it("logout words in the body pass for an ordinary death and fail for a logout-family death", () => {
    expect(check({ body: "He quit nothing and respawned never." }, stated)).toEqual([]);
    expect(check({ body: "He quit nothing and respawned never." }, stated, { logoutFamily: true })).not.toEqual([]);
  });
  it("\"pneumonia\" anywhere is a violation", () => {
    expect(check({ body: "It was not pneumonia." }, stated)).not.toEqual([]);
    expect(check({ tags: ["Heatstroke"] }, stated)).not.toEqual([]);
  });
  it("a clean draft passes", () => {
    expect(check({}, stated)).toEqual([]);
    expect(check({}, inferredCold)).toEqual([]);
  });
});

describe("rule 6: trap kills in a count", () => {
  const trapLife = factsFor({ kills: [{ distanceMeters: null, basis: "trap_placement" }, { distanceMeters: 20 }, { distanceMeters: 30 }] });
  const trapPrior = factsFor({ priors: { livesLived: 2, totalKills: 4, trapKills: 2 } });
  const none = factsFor({ kills: [{ distanceMeters: 20 }, { distanceMeters: 20 }, { distanceMeters: 30 }] });
  it("\"Three kills and a short life\" in the headline is a violation when trapKills is 1", () => {
    expect(check({ headline: "Three kills and a short life" }, trapLife)).not.toEqual([]);
  });
  it("the same headline passes when both trap counts are 0", () => {
    expect(check({ headline: "Three kills and a short life" }, none)).toEqual([]);
  });
  it("\"killed three\" in the lede is a violation when priors.trapKills is 2", () => {
    expect(check({ lede: "Victim One killed three before this life." }, trapPrior)).not.toEqual([]);
  });
  it("a count in the body passes", () => {
    expect(check({ body: "Three kills, all told." }, trapLife)).toEqual([]);
  });
});

describe("rule 4: an inferred cause", () => {
  it("\"froze\" in the headline is a violation", () => {
    expect(check({ headline: "Victim One Probably Froze" }, inferredCold)).not.toEqual([]);
  });
  it("\"He froze.\" in the lede is a violation", () => {
    expect(check({ lede: "He froze." }, inferredCold)).not.toEqual([]);
  });
  it("\"He most likely froze.\" in the lede passes", () => {
    expect(check({ lede: "He most likely froze." }, inferredCold)).toEqual([]);
  });
  it("\"The record shows he probably froze\" is a violation", () => {
    expect(check({ lede: "The record shows he probably froze." }, inferredCold)).not.toEqual([]);
  });
  it("\"No cause was recorded, but he most likely starved\" passes", () => {
    expect(check({ lede: "No cause was recorded, but he most likely starved." }, inferredHunger)).toEqual([]);
  });
  it("a flat family word in the body is a violation", () => {
    expect(check({ body: "Two hours in, the cold took him." }, inferredCold)).not.toEqual([]);
  });
  it("a family word in the pull quote or its attribution is a violation even when hedged", () => {
    expect(check({ pullQuote: { text: "He probably froze.", attribution: "a clerk" } }, inferredCold)).not.toEqual([]);
    expect(check({ pullQuote: { text: "Quiet.", attribution: "a clerk who most likely froze too" } }, inferredCold)).not.toEqual([]);
  });
  it("a family word in the flavour tag is a violation", () => {
    expect(check({ tags: ["Frozen"] }, inferredCold)).not.toEqual([]);
  });
  it("the same words in an article about a stated death pass", () => {
    const o = { headline: "Victim One Froze", lede: "He froze.", body: "The cold took him.", pullQuote: { text: "Frozen solid.", attribution: "a clerk" }, tags: ["Frozen"] };
    expect(check(o, statedCold)).toEqual([]);
  });
});

describe("rule 4: confirmed facts are exempt", () => {
  const infected = (encounters: number) => factsFor({
    verdict: { cause: "infected", confidence: "inferred" },
    ordeals: { infected: { encounters, hits: encounters, worstEncounterHits: 1 } },
  });
  it("\"He had fought off the infected nine times.\" passes for an inferred-infected life when run-ins were sent", () => {
    expect(check({ body: "He had fought off the infected nine times." }, infected(9))).toEqual([]);
  });
  it("\"The infected killed him.\" does not", () => {
    expect(check({ body: "The infected killed him." }, infected(9))).not.toEqual([]);
  });
  it("\"He starved last time, too.\" passes when a hunger prior was sent and fails when none was", () => {
    const withPrior = factsFor({ verdict: { cause: "starvation", confidence: "inferred" }, priors: { livesLived: 2, lastDeathCause: "hunger and thirst" } });
    expect(check({ body: "He starved last time, too." }, withPrior)).toEqual([]);
    expect(check({ body: "He starved last time, too." }, inferredHunger)).not.toEqual([]);
  });
});

describe("rule 5: the credited name", () => {
  const f = factsFor({
    verdict: { cause: "explosive_trap", objectKey: "m67_grenade", attrBasis: "placement" },
    credit: { gamertag: "Placer Person", device: "tripwire", byOperator: false },
  });
  it("the credited name in the headline, the lede, the pull quote or its attribution is a violation", () => {
    expect(check({ headline: "Placer Person Strikes" }, f)).not.toEqual([]);
    expect(check({ lede: "A tripwire set by Placer Person ended it." }, f)).not.toEqual([]);
    expect(check({ pullQuote: { text: "Placer Person, again.", attribution: "a clerk" } }, f)).not.toEqual([]);
    expect(check({ pullQuote: { text: "Again.", attribution: "a friend of Placer Person" } }, f)).not.toEqual([]);
    expect(check({ tags: ["Placer Person"] }, f)).not.toEqual([]);
  });
  it("in the body it passes", () => {
    expect(check({ body: "Placer Person is credited with the kill." }, f)).toEqual([]);
  });
});

describe("rule 2: unknown and withheld", () => {
  const unknown = factsFor({ verdict: { cause: "unknown", confidence: "unknown" } });
  const withheld = factsFor({ verdict: { cause: "restrained_logout" } });
  it("a family word in the headline or lede is a violation, as before", () => {
    expect(check({ headline: "Starved, Apparently" }, unknown)).not.toEqual([]);
    expect(check({ lede: "The infected got him in the end." }, withheld)).not.toEqual([]);
  });
  it("in the body it is left to the prompt", () => {
    expect(check({ body: "Nobody knows if it was the cold." }, unknown)).toEqual([]);
  });
});
