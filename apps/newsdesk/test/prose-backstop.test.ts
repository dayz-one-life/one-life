import { describe, it, expect } from "vitest";
import { dedupePullQuote } from "../src/prose-backstop.js";
import type { RecentProse } from "../src/prose-pg-store.js";

const recent: RecentProse[] = [
  { headline: "One", attribution: "a voice on the coast", opener: "o" },
  { headline: "Two", attribution: null, opener: "o" },
];
const art = (attribution: string | null) => ({
  headline: "H", lede: "L", body: "B", tags: ["Obituaries"],
  pullQuote: attribution === null ? null : { text: "q", attribution },
});

describe("dedupePullQuote", () => {
  it("nulls a pull quote whose attribution matches a recent one", () => {
    expect(dedupePullQuote(art("a voice on the coast"), recent).pullQuote).toBeNull();
  });

  it("matches case-insensitively and ignores surrounding whitespace", () => {
    expect(dedupePullQuote(art("  A Voice On The Coast  "), recent).pullQuote).toBeNull();
  });

  it("keeps a fresh attribution untouched", () => {
    const out = dedupePullQuote(art("a bored coroner"), recent);
    expect(out.pullQuote).toEqual({ text: "q", attribution: "a bored coroner" });
  });

  it("keeps everything else on the article intact", () => {
    const out = dedupePullQuote(art("a voice on the coast"), recent);
    expect(out.headline).toBe("H");
    expect(out.lede).toBe("L");
    expect(out.body).toBe("B");
    expect(out.tags).toEqual(["Obituaries"]);
  });

  it("is a no-op for an already-null pull quote and for an empty recent list", () => {
    expect(dedupePullQuote(art(null), recent).pullQuote).toBeNull();
    expect(dedupePullQuote(art("a voice on the coast"), []).pullQuote).not.toBeNull();
  });
});
