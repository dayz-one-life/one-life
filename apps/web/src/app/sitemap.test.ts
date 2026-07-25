import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api", () => ({
  getSitemapData: vi.fn(),
  getServersCached: vi.fn(),
}));

import { getSitemapData, getServersCached } from "@/lib/api";
import sitemap from "./sitemap";

const SERVERS = [
  { id: 1, name: "Sakhal", slug: "sakhal", map: "sakhal", active: true },
  { id: 2, name: "Livonia", slug: "livonia", map: "enoch", active: true },
];

const DATA = {
  players: [{ gamertag: "xSgt Hartman", lastmod: "2026-07-01T00:00:00.000Z" }],
  lives: [{ gamertag: "xSgt Hartman", mapSlug: "livonia", n: 2, lastmod: "2026-07-02T00:00:00.000Z" }],
};

beforeEach(() => {
  vi.mocked(getServersCached).mockResolvedValue(SERVERS as never);
  vi.mocked(getSitemapData).mockResolvedValue(DATA as never);
});

const urls = async () => (await sitemap()).map((e) => e.url);

describe("sitemap", () => {
  it("includes the home page and the static pages", async () => {
    const u = await urls();
    for (const p of ["", "/about"]) {
      expect(u).toContain(`https://dayzonelife.com${p}`);
    }
  });

  it("includes one board URL per slugged server", async () => {
    const u = await urls();
    expect(u).toContain("https://dayzonelife.com/survivors/sakhal");
    expect(u).toContain("https://dayzonelife.com/survivors/livonia");
  });

  // ⚠️ The sitemap may only carry URLs that resolve DIRECTLY. `/survivors` is now a per-viewer
  // redirect, so advertising it would train crawlers on a 30x — the same reason the old
  // explicit-default sort path was excluded.
  it("never advertises the bare /survivors, which redirects", async () => {
    expect(await urls()).not.toContain("https://dayzonelife.com/survivors");
  });

  // The sort paths are gone entirely (sub-project D) — these would 404, which is worse than the
  // redirect they used to be.
  it("never advertises a sort path", async () => {
    const u = await urls();
    for (const word of ["time", "kills", "longest"]) {
      expect(u.some((x) => x.endsWith(`/${word}`))).toBe(false);
    }
  });

  it("builds a player URL with the slugified gamertag", async () => {
    expect(await urls()).toContain("https://dayzonelife.com/players/xsgt-hartman");
  });

  it("builds a life URL from the server SLUG, never the map codename", async () => {
    const u = await urls();
    expect(u).toContain("https://dayzonelife.com/players/xsgt-hartman/livonia/lives/2");
    expect(u.some((x) => x.includes("/enoch/"))).toBe(false);
  });

  it("carries the lastmod the API supplied", async () => {
    const entry = (await sitemap()).find((e) => e.url.endsWith("/livonia/lives/2"));
    expect(entry?.lastModified).toEqual(new Date("2026-07-02T00:00:00.000Z"));
  });

  it("returns static and board entries when the API call fails, never throwing", async () => {
    vi.mocked(getSitemapData).mockRejectedValue(new Error("api down"));
    const u = await urls();
    expect(u).toContain("https://dayzonelife.com/survivors/sakhal");
    expect(u).toContain("https://dayzonelife.com");
    expect(u.some((x) => x.includes("/players/"))).toBe(false);
  });

  it("still returns the static pages when even the servers call fails", async () => {
    vi.mocked(getServersCached).mockRejectedValue(new Error("api down"));
    vi.mocked(getSitemapData).mockRejectedValue(new Error("api down"));
    expect(await urls()).toContain("https://dayzonelife.com/about");
  });

  // The two fetches degrade INDEPENDENTLY. The test above covers "data fails"; this covers the
  // other direction — losing the board list must not cost us the ~470 content URLs, which are the
  // whole point of the sitemap. One shared try/catch would pass that test and fail this one.
  it("still returns player and life URLs when the servers call fails", async () => {
    vi.mocked(getServersCached).mockRejectedValue(new Error("api down"));
    const u = await urls();
    expect(u).toContain("https://dayzonelife.com/players/xsgt-hartman");
    expect(u).toContain("https://dayzonelife.com/players/xsgt-hartman/livonia/lives/2");
    expect(u.some((x) => x.startsWith("https://dayzonelife.com/survivors"))).toBe(false);
  });

  // Next's sitemap serializer calls `.toISOString()` on `lastModified`; an Invalid Date throws
  // a RangeError there, which would 500 the whole route from one malformed timestamp. The URL
  // must still appear, just without a `lastModified`.
  it("keeps the URL but omits lastModified when the API sends a malformed timestamp", async () => {
    vi.mocked(getSitemapData).mockResolvedValue({
      players: [{ gamertag: "xSgt Hartman", lastmod: "not-a-date" }],
      lives: [],
    } as never);
    const entries = await sitemap();
    const entry = entries.find((e) => e.url === "https://dayzonelife.com/players/xsgt-hartman");
    expect(entry).toBeDefined();
    expect(entry?.lastModified).toBeUndefined();
  });
});
