import { describe, it, expect } from "vitest";
import type { PlayerPriors } from "@onelife/read-models";
import {
  NEWS_PROMPT_VERSION, buildNewsPrompt, parseNewsArticle, deriveBody, composeNewsTags,
} from "../src/news-prompt.js";
import type { NewsFacts, NewsSubject } from "../src/news-facts.js";

const priors = (over: Partial<PlayerPriors> = {}): PlayerPriors => ({
  livesLived: 0, longestLifeSeconds: 0, totalKills: 0,
  usualDeathCause: null, lastDeathCause: null, bestLifeMap: null, ...over,
});

const subject = (over: Partial<NewsSubject> = {}): NewsSubject => ({
  gamertag: "GabeFox101", map: "chernarusplus", mapSlug: "chernarus", lifeNumber: 3,
  lifeStartedAt: "2026-07-11T00:00:00.000Z", endedAt: null,
  timeAliveSeconds: 5600, timeAliveLabel: "1h 33m", kills: 0, sessions: 4,
  persona: "Lewis", deathCause: null, priors: priors(), isKnownQuantity: false, isFresh: true,
  ...over,
});

const standing = (over: Partial<NewsFacts> = {}): NewsFacts => ({
  trigger: "standing_dead", map: "chernarusplus", mapSlug: "chernarus",
  idleHours: 96, timeAliveSeconds: 5600, hitsAbsorbed: 137, lifeNumber: 3,
  priors: priors({ livesLived: 2, totalKills: 4 }), subjectCount: 1, allFreshSubjects: false,
  naturalKey: "standing_dead:7:GabeFox101:2026-07-11T00:00:00.000Z", serverId: 7,
  primaryGamertag: "GabeFox101",
  subjects: [subject({ priors: priors({ livesLived: 2, totalKills: 4 }), isKnownQuantity: true, isFresh: false })],
  lastSeenAt: "2026-07-14T00:00:00.000Z", eligibleAt: "2026-07-17T00:00:00.000Z",
  idleSeconds: 345_600, earliestDeathAt: null, spanSeconds: null, ...over,
});

const longForm = (over: Partial<NewsFacts> = {}): NewsFacts => ({
  trigger: "long_form", map: "chernarusplus", mapSlug: "chernarus",
  idleHours: null, timeAliveSeconds: 6660, hitsAbsorbed: 0, lifeNumber: 1,
  priors: priors(), subjectCount: 2, allFreshSubjects: true,
  naturalKey: "long_form:7:2026-07-11T01:00:00.000Z:CUPID18+GabeFox101", serverId: 7,
  primaryGamertag: "CUPID18",
  subjects: [
    subject({ gamertag: "CUPID18", lifeNumber: 1, endedAt: "2026-07-11T01:00:00.000Z",
      deathCause: "infected", timeAliveSeconds: 6660, timeAliveLabel: "1h 51m" }),
    subject({ gamertag: "GabeFox101", lifeNumber: 1, endedAt: "2026-07-11T01:00:27.000Z",
      deathCause: "died", timeAliveSeconds: 6700, timeAliveLabel: "1h 51m" }),
  ],
  lastSeenAt: null, eligibleAt: null, idleSeconds: null,
  earliestDeathAt: "2026-07-11T01:00:00.000Z", spanSeconds: 27, ...over,
});

describe("NEWS_PROMPT_VERSION", () => {
  it("is exactly news-v1", () => {
    expect(NEWS_PROMPT_VERSION).toBe("news-v1");
  });
});

describe("deriveBody", () => {
  it("joins only the para blocks, with a blank line between them", () => {
    expect(deriveBody([
      { type: "subhead", text: "The Turn" },
      { type: "para", text: "One." },
      { type: "list", items: ["a", "b"] },
      { type: "para", text: "Two." },
      { type: "quote", text: "q", attribution: "a source" },
    ])).toBe("One.\n\nTwo.");
  });

});

describe("parseNewsArticle", () => {
  const ok = {
    headline: "Nobody Has Seen Him Since Tuesday",
    lede: "The record simply stops.",
    blocks: [
      { type: "para", text: "First paragraph." },
      { type: "subhead", text: "The Turn" },
      { type: "para", text: "Second paragraph." },
      { type: "list", items: ["one", "two"] },
      { type: "quote", text: "He was here.", attribution: "a weary institutional source" },
    ],
    pullQuote: { text: "He is still standing somewhere.", attribution: "an unnamed witness" },
    tags: ["Elektro"],
  };

  it("accepts all four block types and derives body from the paras", () => {
    const a = parseNewsArticle(JSON.stringify(ok));
    expect(a.blocks).toHaveLength(5);
    expect(a.body).toBe("First paragraph.\n\nSecond paragraph.");
    expect(a.headline).toBe("Nobody Has Seen Him Since Tuesday");
    expect(a.pullQuote?.attribution).toBe("an unnamed witness");
    expect(a.tags).toEqual(["Elektro"]);
  });

  it("never lets the model author `body` — an emitted body is ignored, not trusted", () => {
    // Spec §8: precedence is ONE-WAY so the share card can never quote text that is not on the
    // page. `body` is derived post-parse and cannot diverge from the rendered blocks.
    const a = parseNewsArticle(JSON.stringify({ ...ok, body: "SOMETHING ELSE ENTIRELY" }));
    expect(a.body).toBe("First paragraph.\n\nSecond paragraph.");
  });

  it("rejects an unknown block type rather than storing it", () => {
    expect(() => parseNewsArticle(JSON.stringify({
      ...ok, blocks: [{ type: "table", rows: [] }],
    }))).toThrow();
  });

  it("rejects a blocks array carrying no para block at all", () => {
    // A SHAPE constraint, not a length floor (so §5's "never request a minimum" is intact): the
    // article must contain at least one paragraph. `body` is derived from the paras alone and is
    // the ONLY text the OG card and the meta description can quote — a paras-free article ships a
    // share card with an empty description and nothing to quote.
    expect(() => parseNewsArticle(JSON.stringify({
      ...ok, blocks: [{ type: "subhead", text: "Only a subhead" }, { type: "list", items: ["a"] }],
    }))).toThrow();
  });

  it("rejects a malformed block of a known type", () => {
    expect(() => parseNewsArticle(JSON.stringify({
      ...ok, blocks: [{ type: "quote", text: "no attribution" }],
    }))).toThrow();
    expect(() => parseNewsArticle(JSON.stringify({
      ...ok, blocks: [{ type: "list", items: [] }],
    }))).toThrow();
  });

  it("enforces NO minimum length (spec §5) — a single short para is valid", () => {
    const a = parseNewsArticle(JSON.stringify({
      headline: "H", lede: "L", blocks: [{ type: "para", text: "Three words here." }],
      pullQuote: null, tags: [],
    }));
    expect(a.body).toBe("Three words here.");
  });

  it("salvages a JSON object wrapped in prose or fences", () => {
    const a = parseNewsArticle("Sure!\n```json\n" + JSON.stringify(ok) + "\n```");
    expect(a.headline).toBe("Nobody Has Seen Him Since Tuesday");
  });

  it("throws a named error on non-JSON", () => {
    expect(() => parseNewsArticle("not json at all")).toThrow(/was not JSON/);
  });
});

describe("buildNewsPrompt — The Standing Dead", () => {
  it("uses the Newsroom system prompt and names the subject", () => {
    const { system, user } = buildNewsPrompt(standing());
    expect(system).toMatch(/The Newsroom/);
    expect(user).toContain("GabeFox101");
    expect(user).toMatch(/THE STANDING DEAD/);
  });

  it("labels idle time and playtime as different things, in as many words", () => {
    const { user } = buildNewsPrompt(standing());
    expect(user).toMatch(/96 hours/);
    expect(user).toMatch(/idle/i);
    expect(user).toContain("1h 33m");
    expect(user).toMatch(/never present the calendar gap as time survived/i);
  });

  it("gives the dateline as a map label and no place at all", () => {
    const { user } = buildNewsPrompt(standing());
    expect(user).toContain("Chernarus");
    expect(user).not.toContain("chernarusplus");
    expect(user).not.toMatch(/\d{4}\.\d/);
  });

  it("states plainly that the subject is alive", () => {
    const { user } = buildNewsPrompt(standing());
    expect(user).toMatch(/ALIVE/);
    expect(user).toMatch(/no death/i);
  });

  it("hands over the earned-coverage evidence and the priors block", () => {
    const { user } = buildNewsPrompt(standing());
    expect(user).toMatch(/137/);                 // hits absorbed
    expect(user).toMatch(/Prior lives lived: 2/);
  });

  it("uses the no-priors branch for a first-lifer instead of inventing a record", () => {
    const f = standing({
      priors: priors(), allFreshSubjects: true,
      subjects: [subject({ priors: priors(), isKnownQuantity: false, isFresh: true })],
    });
    const { user } = buildNewsPrompt(f);
    expect(user).toMatch(/first recorded life anywhere/i);
    expect(user).not.toMatch(/Prior lives lived:/);
  });

  it("carries the forbidden-framing directive verbatim", () => {
    const { user } = buildNewsPrompt(standing());
    for (const token of ["the player", "logged off", "stopped playing", "lost interest"]) {
      expect(user.toLowerCase()).toContain(token);
    }
  });
});

describe("buildNewsPrompt — The Long Form", () => {
  it("names every subject and the gap in seconds, never a distance", () => {
    const { user } = buildNewsPrompt(longForm());
    expect(user).toContain("CUPID18");
    expect(user).toContain("GabeFox101");
    expect(user).toMatch(/27 seconds/);
    expect(user).not.toMatch(/metres|meters|\bm\b apart/i);
    expect(user).not.toMatch(/\d{4}\.\d/);
  });

  it("takes the reverent branch when every subject is fresh", () => {
    const { user } = buildNewsPrompt(longForm());
    expect(user).toMatch(/REVERENT/);
    expect(user).toMatch(/the story is the world/i);
    expect(user).not.toMatch(/forensic/i);
  });

  it("takes the cold forensic branch when any subject is geared", () => {
    const { user } = buildNewsPrompt(longForm({
      allFreshSubjects: false,
      subjects: [
        subject({ gamertag: "CUPID18", endedAt: "2026-07-11T01:00:00.000Z", deathCause: "pvp",
          priors: priors({ livesLived: 6, totalKills: 21 }), isKnownQuantity: true, isFresh: false }),
        subject({ gamertag: "GabeFox101", endedAt: "2026-07-11T01:00:27.000Z", deathCause: "pvp" }),
      ],
    }));
    expect(user).toMatch(/forensic/i);
    expect(user).not.toMatch(/REVERENT/);
  });
});

describe("composeNewsTags", () => {
  it("reserves News + the map label + the trigger name, and takes one flavor tag", () => {
    expect(composeNewsTags(standing(), ["Elektro", "Poultry"]))
      .toEqual(["News", "Chernarus", "The Standing Dead", "Elektro"]);
    expect(composeNewsTags(longForm(), []))
      .toEqual(["News", "Chernarus", "The Long Form"]);
  });

  it("never lets the model duplicate a reserved tag", () => {
    expect(composeNewsTags(standing(), ["news", "chernarus", "Fog"]))
      .toEqual(["News", "Chernarus", "The Standing Dead", "Fog"]);
  });
});
