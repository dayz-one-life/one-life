import { describe, it, expect } from "vitest";
import { generateObituary, type CompletionClient } from "../src/generate.js";
import type { ObituaryFacts } from "../src/facts.js";

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

describe("no-place enforcement", () => {
  const dirtyJson = JSON.stringify({
    headline: "Death in a Barn", lede: "L", body: "B",
    pullQuote: null, tags: [],
  });
  const cleanJson = JSON.stringify({
    headline: "A Quiet End", lede: "L", body: "B", pullQuote: null, tags: [],
  });

  it("retries once with the violations named, and returns the clean second draft", async () => {
    const calls: { system: string; user: string }[] = [];
    const client = { complete: async (req: { system: string; user: string }) => {
      calls.push(req);
      return calls.length === 1 ? dirtyJson : cleanJson;
    }};
    const result = await generateObituary(client, facts, []);
    expect(result.headline).toBe("A Quiet End");
    expect(calls).toHaveLength(2);
    expect(calls[1]!.user).toContain("barn");            // the violation is named in the feedback
    expect(calls[1]!.user).toContain("rejected");        // and framed as a rejection
  });

  it("throws after a second dirty draft — the tick's failure path handles it", async () => {
    const client = { complete: async () => dirtyJson };
    await expect(generateObituary(client, facts, [])).rejects.toThrow(/no-place/i);
  });

  it("a draft naming only the map passes without a retry", async () => {
    const mapJson = JSON.stringify({
      headline: "Nine Days on Chernarus", lede: "L", body: "B", pullQuote: null, tags: [],
    });
    let calls = 0;
    const client = { complete: async () => { calls++; return mapJson; } };
    await generateObituary(client, facts, []);
    expect(calls).toBe(1);
  });
});
