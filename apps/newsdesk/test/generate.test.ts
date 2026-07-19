import { describe, it, expect } from "vitest";
import { generateObituary, generateBirthNotice, generateNews, type CompletionClient } from "../src/generate.js";
import type { ObituaryFacts } from "../src/facts.js";
import type { BirthFacts } from "../src/birth-facts.js";
import type { NewsFacts } from "../src/news-facts.js";

const facts: ObituaryFacts = {
  gamertag: "Boots", map: "chernarusplus", mapSlug: "chernarus", lifeNumber: 1, timeAliveSeconds: 3600,
  timeAliveLabel: "1h 0m", kills: 0, longestKillMeters: null, sessions: 1, cause: "bled_out",
  causeCategory: "environment", killerGamertag: null, weapon: null, isLegend: false, freshSpawnVictim: false,
  endedAt: "2026-07-10T02:00:00.000Z",
  deathDistance: null, verdict: null, ordeals: null, hpLow: null,
  priors: { livesLived: 0, longestLifeSeconds: 0, totalKills: 0, usualDeathCause: null, lastDeathCause: null, bestLifeMap: null },
  isKnownQuantity: false,
};

const stub = (payload: unknown): CompletionClient => ({ complete: async () => JSON.stringify(payload) });

describe("generateObituary", () => {
  it("builds the prompt, calls the client, parses the result", async () => {
    let seenSystem = "";
    const client: CompletionClient = {
      complete: async ({ system }) => {
        seenSystem = system;
        return JSON.stringify({ headline: "H", lede: "L", body: "B", pullQuote: null, tags: ["Obituaries"] });
      },
    };
    const o = await generateObituary(client, facts);
    expect(o.headline).toBe("H");
    expect(seenSystem).toMatch(/deadpan/i);
  });

  it("propagates a parse error from a malformed completion", async () => {
    await expect(generateObituary(stub("not an obituary object"), facts)).rejects.toThrow();
  });
});

const birthFacts: BirthFacts = {
  gamertag: "Boots", map: "chernarusplus", mapSlug: "chernarus", lifeNumber: 1,
  bornAt: new Date("2026-07-17T02:00:00Z"), minutesToQualify: 6, persona: null,
  priors: { livesLived: 0, longestLifeSeconds: 0, totalKills: 0, usualDeathCause: null, lastDeathCause: null, bestLifeMap: null },
  isKnownQuantity: false, endedAt: null,
};

const birthStub = (payload: unknown): CompletionClient => ({ complete: async () => JSON.stringify(payload) });

describe("generateBirthNotice", () => {
  it("builds the prompt, calls the client, parses the result", async () => {
    let seenSystem = "";
    const client: CompletionClient = {
      complete: async ({ system }) => {
        seenSystem = system;
        return JSON.stringify({ headline: "Fresh Meat", lede: "L", body: "B", pullQuote: null, tags: ["Fresh Spawns"] });
      },
    };
    const b = await generateBirthNotice(client, birthFacts);
    expect(b.headline).toBe("Fresh Meat");
    expect(seenSystem).toMatch(/nursery/i);
  });

  it("propagates a parse error from a malformed completion", async () => {
    await expect(generateBirthNotice(birthStub("not a birth notice object"), birthFacts)).rejects.toThrow();
  });
});

const newsFacts: NewsFacts = {
  trigger: "standing_dead", map: "sakhal", mapSlug: "sakhal",
  idleHours: 96, timeAliveSeconds: 5600, hitsAbsorbed: 137, lifeNumber: 3,
  priors: { livesLived: 2, longestLifeSeconds: 900, totalKills: 4,
    usualDeathCause: null, lastDeathCause: null, bestLifeMap: null },
  subjectCount: 1, allFreshSubjects: false,
  naturalKey: "standing_dead:7:GenTest:2026-07-11T00:00:00.000Z", serverId: 7,
  primaryGamertag: "GenTest",
  subjects: [{
    gamertag: "GenTest", map: "sakhal", mapSlug: "sakhal", lifeNumber: 3,
    lifeStartedAt: "2026-07-11T00:00:00.000Z", endedAt: null,
    timeAliveSeconds: 5600, timeAliveLabel: "1h 33m", kills: 0, sessions: 4,
    persona: "Lewis", deathCause: null,
    priors: { livesLived: 2, longestLifeSeconds: 900, totalKills: 4,
      usualDeathCause: null, lastDeathCause: null, bestLifeMap: null },
    isKnownQuantity: true, isFresh: false,
  }],
  lastSeenAt: "2026-07-14T00:00:00.000Z", eligibleAt: "2026-07-17T00:00:00.000Z",
  idleSeconds: 345_600, earliestDeathAt: null, spanSeconds: null,
};

describe("generateNews", () => {
  it("sends the Newsroom prompt and returns a parsed article with a derived body", async () => {
    let sent: { system: string; user: string } | null = null;
    const article = await generateNews({
      complete: async (req) => {
        sent = req;
        return JSON.stringify({
          headline: "H", lede: "L",
          blocks: [{ type: "para", text: "One." }, { type: "subhead", text: "S" }, { type: "para", text: "Two." }],
          pullQuote: null, tags: [],
        });
      },
    }, newsFacts);
    expect(sent!.system).toMatch(/The Newsroom/);
    expect(sent!.user).toContain("GenTest");
    expect(article.body).toBe("One.\n\nTwo.");
    expect(article.blocks).toHaveLength(3);
  });

  it("propagates a client failure so the tick can write a stub", async () => {
    await expect(generateNews({ complete: async () => { throw new Error("api boom"); } }, newsFacts))
      .rejects.toThrow(/api boom/);
  });

  it("propagates a parse failure the same way", async () => {
    await expect(generateNews({ complete: async () => "not json" }, newsFacts))
      .rejects.toThrow(/was not JSON/);
  });
});
