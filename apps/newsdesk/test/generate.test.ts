import { describe, it, expect } from "vitest";
import { generateObituary, type CompletionClient } from "../src/generate.js";
import type { ObituaryFacts } from "../src/facts.js";
import { generateBirthNotice } from "../src/generate.js";
import type { BirthFacts } from "../src/birth-facts.js";

const facts: ObituaryFacts = {
  gamertag: "Boots", map: "chernarusplus", mapSlug: "chernarus", lifeNumber: 1, timeAliveSeconds: 3600,
  timeAliveLabel: "1h 0m", kills: 0, longestKillMeters: null, sessions: 1, cause: "environment",
  causeCategory: "environment", killerGamertag: null, weapon: null, isLegend: false, freshSpawnVictim: false,
  endedAt: "2026-07-10T02:00:00.000Z",
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
