import { describe, it, expect } from "vitest";
import { parsePayload, editorialSlug, flattenBlocks } from "../src/newsroom/contract.js";

const valid = {
  format: "almanac",
  naturalKey: "almanac:week:2026-W29",
  headline: "The Coldest Map Keeps Its People Longest",
  lede: "The registry has finished counting.",
  blocks: [{ type: "para", text: "Sakhal is the punishing one." }],
  tags: ["The Almanac"],
  factCheck: [{ claim: "45 vs 70 players", source: "sessions grouped by server" }],
};

describe("parsePayload", () => {
  it("accepts a complete institutional payload", () => {
    expect(parsePayload(valid).format).toBe("almanac");
  });

  // Provenance is not optional. Live aggregates drift as data grows, so an article without a
  // claim->source table cannot be checked after the fact — and the automated desks freeze their
  // facts at publish, so the editorial desk must too.
  it("rejects a payload with no fact check", () => {
    expect(() => parsePayload({ ...valid, factCheck: [] })).toThrow(/factCheck/i);
  });

  it("rejects a natural key outside the editorial namespace", () => {
    expect(() => parsePayload({ ...valid, naturalKey: "standing_dead:1:X" })).toThrow(/natural key/i);
  });

  it("rejects a banned Tier-1 phrase in the prose", () => {
    const bad = { ...valid, blocks: [{ type: "para", text: "Our data shows he was gone too soon." }] };
    expect(() => parsePayload(bad)).toThrow(/our data shows|gone too soon/i);
  });

  it("requires at least one block", () => {
    expect(() => parsePayload({ ...valid, blocks: [] })).toThrow(/blocks/i);
  });
});

describe("editorialSlug", () => {
  it("prefixes with the format and stays URL and media-route safe", () => {
    const s = editorialSlug("almanac", "The Coldest Map Keeps Its People Longest", "almanac:week:2026-W29");
    expect(s).toMatch(/^[a-z0-9-]+$/);
    expect(s.startsWith("almanac-")).toBe(true);
  });

  it("is deterministic for the same input", () => {
    const a = editorialSlug("ledger", "Raygun Paid His Debt", "ledger:transfer:abc");
    const b = editorialSlug("ledger", "Raygun Paid His Debt", "ledger:transfer:abc");
    expect(a).toBe(b);
  });
});

describe("flattenBlocks", () => {
  // The OG card and the meta description quote `body`. Deriving it from the blocks means they can
  // never quote a sentence that is not on the page — the same rule newsTick follows.
  it("joins only para blocks, with a blank line between them", () => {
    expect(flattenBlocks([
      { type: "para", text: "One." },
      { type: "subhead", text: "Ignored" },
      { type: "para", text: "Two." },
    ])).toBe("One.\n\nTwo.");
  });
});
