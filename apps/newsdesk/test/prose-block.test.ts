import { describe, it, expect } from "vitest";
import { recentProseBlock } from "../src/prose-block.js";
import type { RecentProse } from "../src/prose-pg-store.js";

const r = (over: Partial<RecentProse> = {}): RecentProse => ({
  headline: "The King Is Dead", attribution: "a bored coroner", opener: "He arrived with a flare.", ...over,
});

describe("recentProseBlock", () => {
  it("is empty when there is nothing recent", () => {
    expect(recentProseBlock([])).toEqual([]);
  });

  it("lists recent headlines, attributions, and openers under a do-not-reuse instruction", () => {
    const lines = recentProseBlock([r(), r({ headline: "Second", attribution: "a rival", opener: "Two." })]);
    const text = lines.join("\n");
    expect(text).toMatch(/do NOT reuse/i);
    expect(text).toContain("The King Is Dead");
    expect(text).toContain("a bored coroner");
    expect(text).toContain("He arrived with a flare.");
    expect(text).toContain("Second");
    expect(text).toContain("a rival");
  });

  it("skips a null attribution and an empty opener without emitting blanks", () => {
    const lines = recentProseBlock([r({ attribution: null, opener: "" })]);
    const text = lines.join("\n");
    expect(text).toContain("The King Is Dead");
    expect(text).not.toContain("null");
    expect(text).not.toContain("—  ");
  });

  it("de-duplicates repeated attributions so one string is not re-seeded N times", () => {
    const lines = recentProseBlock([r({ attribution: "a rival" }), r({ headline: "B", attribution: "A Rival" })]);
    const attrLines = lines.filter((l) => l.toLowerCase().includes("a rival"));
    expect(attrLines).toHaveLength(1);
  });
});
