import { describe, it, expect } from "vitest";
import { findCauseViolations, holdsKillCount, splitSentences } from "../src/cause-check.js";
import type { Obituary } from "../src/prompt.js";
import type { ObituaryFacts } from "../src/facts.js";
import type { CheckHints } from "../src/generate.js";
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
const NO: CheckHints = { logoutFamily: false, family: null };
const check = (o: Partial<Obituary>, f: ObituaryFacts, hints: CheckHints = NO) => findCauseViolations(draft(o), f, hints);

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
    expect(check({ body: "He quit nothing and respawned never." }, stated, { logoutFamily: true, family: null })).not.toEqual([]);
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
  it("\"He starved last time.\" passes when a hunger prior was sent and fails when none was", () => {
    const withPrior = factsFor({ verdict: { cause: "starvation", confidence: "inferred" }, priors: { livesLived: 2, lastDeathCause: "hunger and thirst" } });
    expect(check({ body: "He starved last time." }, withPrior)).toEqual([]);
    expect(check({ body: "He starved last time." }, inferredHunger)).not.toEqual([]);
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
  it("a mechanism in the headline or lede is a violation, as before", () => {
    expect(check({ headline: "Starved, Apparently" }, unknown)).not.toEqual([]);
    expect(check({ lede: "The infected got him in the end." }, withheld)).not.toEqual([]);
  });
  it("in the body it is left to the prompt", () => {
    expect(check({ body: "Nobody knows if it was the cold." }, unknown)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Review of PR 406. ⚠️ Invented names and prose only.
// ---------------------------------------------------------------------------------------------

const coldPrior = factsFor({
  verdict: { cause: "cold_exposure", confidence: "inferred" },
  priors: { livesLived: 3, lastDeathCause: "exposure", usualDeathCause: "exposure" },
});
const hungerPrior = factsFor({
  verdict: { cause: "starvation", confidence: "inferred" },
  priors: { livesLived: 3, lastDeathCause: "hunger and thirst" },
});
const infectedRunIns = factsFor({
  verdict: { cause: "infected", confidence: "inferred" },
  ordeals: { infected: { encounters: 9, hits: 9, worstEncounterHits: 1 } },
});
const pvpOneKill = factsFor({ verdict: { cause: "pvp", confidence: "inferred" }, kills: [{ distanceMeters: 20 }] });
const pvpNoKill = factsFor({ verdict: { cause: "pvp", confidence: "inferred" } });
const unknownLife = factsFor({ verdict: { cause: "unknown", confidence: "unknown" } });
const unknownKills = factsFor({ verdict: { cause: "unknown", confidence: "unknown" }, kills: [{ distanceMeters: 20 }, { distanceMeters: 30 }] });
const unknownRunIns = factsFor({ verdict: { cause: "unknown", confidence: "unknown" }, ordeals: { infected: { encounters: 9, hits: 9, worstEncounterHits: 1 } } });
const withheldLife = factsFor({ verdict: { cause: "restrained_logout" } });
const oneTrapKill = factsFor({ kills: [{ distanceMeters: null, basis: "trap_placement" }] });
const inferredFor = (cause: Parameters<typeof factsFor>[0] extends infer I ? I extends { verdict?: infer V } ? V extends { cause?: infer C } ? C : never : never : never) =>
  factsFor({ verdict: { cause, confidence: "inferred" } });

describe("review: a prior marker exempts only a sentence about the earlier death", () => {
  it.each([
    ["lede", "Victim One froze to death again."],
    ["lede", "As usual, the cold killed him."],
    ["body", "He starved last time, too."],
  ])("%s \"%s\" states this death and needs a hedge", (field, text) => {
    const f = text.includes("starved") ? hungerPrior : coldPrior;
    expect(check({ [field]: text }, f)).not.toEqual([]);
  });
  it("no prior exemption in the headline or the pull quote", () => {
    expect(check({ headline: "Frozen Again" }, coldPrior)).not.toEqual([]);
    expect(check({ pullQuote: { text: "He froze before and he froze again.", attribution: "a clerk" } }, coldPrior)).not.toEqual([]);
  });
  it("an honest restatement of the sent prior passes", () => {
    expect(check({ body: "His most recent death was to hunger and thirst." }, hungerPrior)).toEqual([]);
    expect(check({ body: "His last life ended in starvation." }, hungerPrior)).toEqual([]);
    expect(check({ body: "He froze in a previous life." }, coldPrior)).toEqual([]);
  });
});

describe("review: in-life exemptions", () => {
  it("never in the headline or the pull quote", () => {
    expect(check({ headline: "The Infected Finally Win" }, infectedRunIns)).not.toEqual([]);
    expect(check({ pullQuote: { text: "The infected always collect.", attribution: "a clerk" } }, infectedRunIns)).not.toEqual([]);
    expect(check({ headline: "Gunned Down" }, pvpOneKill)).not.toEqual([]);
  });
  it("a lede with no sign of a past encounter is a cause sentence", () => {
    expect(check({ lede: "The horde finally got him." }, infectedRunIns)).not.toEqual([]);
    expect(check({ lede: "Victim One was shot in the back." }, pvpOneKill)).not.toEqual([]);
  });
  it("a kill this life does not exempt a flat statement that he was shot", () => {
    expect(check({ lede: "A bullet found him in the third hour." }, pvpOneKill)).not.toEqual([]);
    expect(check({ body: "Someone shot him." }, pvpOneKill)).not.toEqual([]);
  });
  it("a sentence about his own kills is not a statement of how he died", () => {
    expect(check({ body: "He shot one man before noon." }, pvpOneKill)).toEqual([]);
  });
  it("past run-ins still pass, with or without 'the end'", () => {
    expect(check({ body: "He survived nine run-ins with the infected before the end came." }, infectedRunIns)).toEqual([]);
    expect(check({ lede: "He fought off the infected nine times." }, infectedRunIns)).toEqual([]);
  });
  it("on an unknown life the exemptions do not defeat rule 2 in the headline or a death sentence", () => {
    expect(check({ headline: "Gunned Down After Two Kills Of His Own" }, unknownKills)).not.toEqual([]);
    expect(check({ lede: "The horde finally got him." }, unknownRunIns)).not.toEqual([]);
  });
});

describe("review: hedges are checked per clause, and more certainty markers", () => {
  it.each([
    ["lede", "He probably expected rescue, but he froze to death."],
    ["body", "He most likely froze; the cold killed him at dawn."],
    ["lede", "The record says he probably froze."],
    ["body", "He most likely froze, and the log certainly leaves no doubt of it."],
  ])("%s \"%s\" is a violation", (field, text) => {
    expect(check({ [field]: text }, inferredCold)).not.toEqual([]);
  });
  it("\"The record says nothing, but he most likely froze.\" passes", () => {
    expect(check({ lede: "The record says nothing, but he most likely froze." }, inferredCold)).toEqual([]);
  });
});

describe("review: wider family words", () => {
  it.each([
    ["cold_exposure", "lede", "Winter finished him two hours in."],
    ["cold_exposure", "headline", "Winter Wins Again"],
    ["cold_exposure", "body", "The snow took him where he lay."],
    ["starvation", "lede", "He ran out of food and water two hours in."],
    ["starvation", "headline", "An Empty Stomach And An Empty Can"],
    ["pneumonia", "lede", "A cough took him in the end."],
    ["pneumonia", "headline", "The Infection Wins"],
    ["vehicle_own_crash", "lede", "He rolled the bike at speed and that was that."],
    ["vehicle_own_crash", "headline", "Two Wheels, One Bad Corner"],
    ["infected", "lede", "The shamblers got him."],
    ["pvp", "lede", "A stranger finished him."],
  ] as const)("%s: %s \"%s\" is a violation", (cause, field, text) => {
    expect(check({ [field]: text }, inferredFor(cause))).not.toEqual([]);
  });
});

describe("review: common honest hedges pass", () => {
  it.each([
    "In all likelihood the cold took him.",
    "Perhaps it was the cold; the server wrote nothing down.",
    "Exposure is the probable answer.",
    "The paper's reading is exposure, and only a reading.",
    "Everything points toward the cold.",
    "He possibly froze; nobody wrote it down.",
  ])("\"%s\"", (text) => {
    expect(check({ lede: text }, inferredCold)).toEqual([]);
  });
});

describe("review: rule 6 counts kills, not other numbers", () => {
  it.each([
    ["lede", "Victim One was dead within two hours."],
    ["lede", "No one killed him."],
    ["headline", "Dead After Two Hours"],
    ["headline", "No One Killed Him, Officially"],
  ])("%s \"%s\" passes", (field, text) => {
    expect(check({ [field]: text }, oneTrapKill)).toEqual([]);
  });
  it("a number inside the player's own gamertag is not a count", () => {
    const ghost = { ...oneTrapKill, gamertag: "Ghost 2" };
    expect(check({ headline: "Ghost 2 Killed In The Dark" }, ghost)).toEqual([]);
  });
  it.each([
    "He Took Two Victims With Him",
    "A Double Kill, Then Nothing",
    "A two-time killer, gone.",
    "A pair of kills to his name, then the fall.",
  ])("\"%s\" is a kill count", (text) => {
    expect(check({ headline: text }, oneTrapKill)).not.toEqual([]);
  });
  it("helper", () => {
    expect(holdsKillCount("killed someone")).toBe(false);
    expect(holdsKillCount("the one who killed him")).toBe(false);
  });
});

describe("review: rule 2 reads the death's own family and a short list of mechanisms", () => {
  it.each([
    "Victim One lived two hours, never fired a shot, and left nothing written next to his name.",
    "Two hours in, the trail simply goes cold.",
    "He was sick of waiting, and then the record stopped.",
  ])("an unknown death: lede \"%s\" passes", (text) => {
    expect(check({ lede: text }, unknownLife)).toEqual([]);
  });
  it("an unknown death: natural headlines and tags pass", () => {
    expect(check({ headline: "The Trail Goes Cold" }, unknownLife)).toEqual([]);
    expect(check({ headline: "His Last Shot at Glory" }, unknownLife)).toEqual([]);
    expect(check({ tags: ["Cold Case"] }, unknownLife)).toEqual([]);
  });
  it("with kills and run-ins, honest sentences pass", () => {
    expect(check({ lede: "Victim One shot two men and then died with nothing written next to it." }, unknownKills)).toEqual([]);
    expect(check({ lede: "He survived nine run-ins with the infected; the record says nothing about the end." }, unknownRunIns)).toEqual([]);
  });
  it("an inferred PvP life: \"He never fired a shot.\" passes", () => {
    expect(check({ lede: "He never fired a shot." }, pvpNoKill)).toEqual([]);
  });
  it("the mechanisms the no-mechanism directive forbids are violations", () => {
    expect(check({ headline: "Victim One Probably Fell" }, unknownLife)).not.toEqual([]);
    expect(check({ lede: "The wolves most likely found him first." }, unknownLife)).not.toEqual([]);
    expect(check({ lede: "Bound hand and foot, he never got free." }, withheldLife)).not.toEqual([]);
  });
  it("a switched-off family's own words are checked through the internal hint", () => {
    const hint: CheckHints = { logoutFamily: false, family: "exposure" };
    expect(check({ headline: "The Trail Goes Cold" }, unknownLife, hint)).not.toEqual([]);
    expect(check({ lede: "Winter, probably." }, unknownLife, hint)).not.toEqual([]);
  });
});

describe("review: rule 1 regex", () => {
  it.each([
    ["headline", "Two Logouts Too Many"],
    ["lede", "Victim One went offline mid-fight and never came back."],
    ["lede", "With the infected closing in, he pulled the plug."],
    ["lede", "He hit Alt-F4."],
  ])("%s \"%s\" is a violation", (field, text) => {
    expect(check({ [field]: text }, stated)).not.toEqual([]);
  });
  it("\"signed off\" in the body of a logout-family death is a violation", () => {
    expect(check({ body: "He signed off with the infected at his heels." }, stated, { logoutFamily: true, family: null })).not.toEqual([]);
  });
  it("a negated 'quit' passes on an ordinary death, never on a logout-family one", () => {
    expect(check({ lede: "Victim One never gave up, right up until the fall." }, stated)).toEqual([]);
    expect(check({ headline: "The Man Who Never Quit" }, stated)).toEqual([]);
    expect(check({ headline: "The Man Who Never Quit" }, stated, { logoutFamily: true, family: null })).not.toEqual([]);
  });
});

describe("review: rule 5 on word boundaries; the body may not say NAME killed him", () => {
  const credited = (gamertag: string) => factsFor({
    verdict: { cause: "explosive_trap", objectKey: "m67_grenade", attrBasis: "placement" },
    credit: { gamertag, device: "tripwire", byOperator: false },
  });
  it("a short name inside a longer word is not the name", () => {
    expect(check({ headline: "Ashes To Ashes" }, credited("Ash"))).toEqual([]);
    expect(check({ lede: "Victim One washed up and lasted two hours." }, credited("Ash"))).toEqual([]);
    expect(check({ lede: "He kept a straight face to the end." }, credited("Ace"))).toEqual([]);
  });
  it("a name with regex characters is matched literally", () => {
    expect(check({ headline: "Mr.X (2) Strikes" }, credited("Mr.X (2)"))).not.toEqual([]);
    expect(check({ headline: "MrAX 2 Strikes" }, credited("Mr.X (2)"))).toEqual([]);
  });
  it("\"Ash killed him with a tripwire.\" in the body is a violation; the credited sentence is not", () => {
    expect(check({ body: "Ash killed him with a tripwire." }, credited("Ash"))).not.toEqual([]);
    expect(check({ body: "Ash is credited with the kill." }, credited("Ash"))).toEqual([]);
  });
});

describe("review: the tag rules read only the tag composeTags keeps", () => {
  it("a model tag equal to the reserved family tag, or after the kept one, is ignored", () => {
    expect(check({ tags: ["Paperwork", "Exposure"] }, inferredCold)).toEqual([]);
    expect(check({ tags: ["Exposure", "Paperwork"] }, inferredCold)).toEqual([]);
  });
  it("the kept flavour tag is still checked", () => {
    expect(check({ tags: ["Exposure", "Frozen Stiff"] }, inferredCold)).not.toEqual([]);
  });
});

describe("review: the writer's own hedged line and the directive's examples pass", () => {
  const families = ["cold_exposure", "pneumonia", "vehicle_own_crash", "vehicle_crash_occupant", "starvation", "dehydration", "starvation_and_dehydration", "infected", "pvp"] as const;
  it.each(families)("%s: the inferred writer line as a lede passes", (cause) => {
    const f = inferredFor(cause);
    const line = f.brief.line;
    expect(line, cause).toBeTruthy();
    expect(check({ lede: `Victim One ${line}.` }, f), cause).toEqual([]);
  });
  it.each([
    "By every sign, the cold got him.",
    "The record points to the cold.",
    "It looks like the cold got him.",
    "He probably froze.",
  ])("\"%s\"", (text) => {
    expect(check({ body: text }, inferredCold)).toEqual([]);
  });
});
