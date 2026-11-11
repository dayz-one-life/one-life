import { describe, it, expect } from "vitest";
import { generateObituary, type CompletionClient } from "../src/generate.js";
import { factsFor } from "./facts-fixture.js";

const facts = factsFor({ verdict: { cause: "bled_out_other", confidence: "strong" } });

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

describe("cause-check enforcement", () => {
  const cold = factsFor({ verdict: { cause: "cold_exposure", confidence: "inferred" } });
  const flat = JSON.stringify({ headline: "A Quiet End", lede: "He froze.", body: "B", pullQuote: null, tags: [] });
  const hedged = JSON.stringify({ headline: "A Quiet End", lede: "He most likely froze.", body: "B", pullQuote: null, tags: [] });

  it("retries once with the cause violations named, and returns the clean second draft", async () => {
    const calls: string[] = [];
    const client = { complete: async (req: { system: string; user: string }) => { calls.push(req.user); return calls.length === 1 ? flat : hedged; } };
    const result = await generateObituary(client, cold, []);
    expect(result.lede).toBe("He most likely froze.");
    expect(calls[1]).toContain("rule 4");
  });

  it("throws after a second violating draft", async () => {
    await expect(generateObituary({ complete: async () => flat }, cold, [])).rejects.toThrow(/cause-check/);
  });

  it("the logout hint widens rule 1 to the whole article", async () => {
    const body = JSON.stringify({ headline: "H", lede: "L", body: "He never respawned.", pullQuote: null, tags: [] });
    let n = 0;
    await generateObituary({ complete: async () => { n++; return body; } }, facts, [], { logoutFamily: false });
    expect(n).toBe(1);
    await expect(generateObituary({ complete: async () => body }, facts, [], { logoutFamily: true })).rejects.toThrow(/cause-check/);
  });

  it("a credited name containing a banned place word does not trip the place check", async () => {
    const credited = factsFor({
      verdict: { cause: "landmine", attrBasis: "placement" },
      credit: { gamertag: "Barn Owl Seven", device: "land_mine", byOperator: false },
    });
    const json = JSON.stringify({ headline: "A Short Walk", lede: "L", body: "Barn Owl Seven is credited with the kill.", pullQuote: null, tags: [] });
    let n = 0;
    await generateObituary({ complete: async () => { n++; return json; } }, credited, []);
    expect(n).toBe(1);
  });
});
