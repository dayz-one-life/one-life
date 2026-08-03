import { describe, it, expect, vi } from "vitest";
import { generateMetadata } from "./page";

vi.mock("@/lib/api", () => ({
  getObituary: vi.fn().mockResolvedValue({
    slug: "s", gamertag: "G", map: "sakhal", mapSlug: "sakhal", lifeNumber: 1,
    headline: "H", lede: "L", tags: [], timeAliveSeconds: 1, kills: 0, longestKillMeters: null,
    cause: null, deathAt: "2026-07-30T22:27:32.000Z",
    body: "", bodyBlocks: null, pullQuote: null, sessions: 1, killerGamertag: null, weapon: null, verdict: null,
  }),
  getObituariesFeed: vi.fn(),
  getPlayerLife: vi.fn(),
}));

describe("obituary page metadata", () => {
  it("stamps the death instant as the article's publishedTime", async () => {
    const md = await generateMetadata({ params: Promise.resolve({ slug: "s" }) });
    expect(md.openGraph).toMatchObject({ type: "article", publishedTime: "2026-07-30T22:27:32.000Z" });
  });

  // Regression pin: the page hand-appends " — One Life" to its title, so the root layout's
  // `%s · One Life` template would double the suffix unless the title is wrapped in
  // `{ absolute: ... }`. A revert to a plain string would go green on every other assertion here.
  it("wraps the title in `absolute` so the root template can't double-append the suffix", async () => {
    const md = await generateMetadata({ params: Promise.resolve({ slug: "s" }) });
    expect(md.title).toEqual({ absolute: "H — G — One Life" });
  });
});
