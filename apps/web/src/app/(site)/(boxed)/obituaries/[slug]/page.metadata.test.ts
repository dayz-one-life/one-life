import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateMetadata, revalidate } from "./page";

// Inlined rather than hoisted to a top-level const: `vi.mock` factories are hoisted above every
// other statement, so referencing an outer binding here throws "Cannot access before initialization".
vi.mock("@/lib/api", () => ({
  getObituaryCached: vi.fn().mockResolvedValue({
    slug: "s", gamertag: "G", map: "sakhal", mapSlug: "sakhal", lifeNumber: 1,
    headline: "H", lede: "L", tags: [], timeAliveSeconds: 1, kills: 0, longestKillMeters: null,
    cause: null, deathAt: "2026-07-30T22:27:32.000Z",
    body: "", bodyBlocks: null, pullQuote: null, sessions: 1, killerGamertag: null, weapon: null, verdict: null,
  }),
  getObituariesFeedCached: vi.fn(),
  getPlayerLifeCached: vi.fn(),
  // The cookie-forwarding originals stay mocked so the regression pin below can prove the page
  // never reaches for them.
  getObituary: vi.fn(),
  getObituariesFeed: vi.fn(),
  getPlayerLife: vi.fn(),
}));
import { getObituary, getObituariesFeed, getPlayerLife, getObituaryCached } from "@/lib/api";

beforeEach(() => vi.clearAllMocks());

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

describe("obituary page cacheability", () => {
  // ⚠️ These two pin the fix for blank social cards. `apiGet` awaits `cookies()`, which drops the
  // route to dynamic rendering and makes Next emit `cache-control: private, no-cache, no-store`;
  // every crawler scrape then pays a cold origin render and Facebook's scraper intermittently
  // times out, publishing the post with an empty card. Neither failure is visible in dev, which
  // re-renders everything on every request — only these assertions catch a revert.
  it("declares an ISR window so the route is not dynamically rendered", () => {
    expect(revalidate).toBe(300);
  });

  it("reads through the cookie-free fetchers, never the cookie-forwarding ones", async () => {
    await generateMetadata({ params: Promise.resolve({ slug: "s" }) });
    expect(getObituaryCached).toHaveBeenCalledWith("s");
    expect(getObituary).not.toHaveBeenCalled();
    expect(getObituariesFeed).not.toHaveBeenCalled();
    expect(getPlayerLife).not.toHaveBeenCalled();
  });
});
