import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api", () => ({
  getSitemapData: vi.fn(),
  getServers: vi.fn(),
}));

import { getSitemapData, getServers } from "@/lib/api";
import sitemap from "./sitemap";

const SERVERS = [
  { id: 1, name: "Sakhal", slug: "sakhal", map: "sakhal", active: true },
  { id: 2, name: "Livonia", slug: "livonia", map: "enoch", active: true },
];

const DATA = {
  players: [{ gamertag: "xSgt Hartman", lastmod: "2026-07-01T00:00:00.000Z" }],
  lives: [{ gamertag: "xSgt Hartman", mapSlug: "livonia", n: 2, lastmod: "2026-07-02T00:00:00.000Z" }],
  articles: [{ kind: "obituary", slug: "hartman-falls", lastmod: "2026-07-03T00:00:00.000Z" }],
};

beforeEach(() => {
  vi.mocked(getServers).mockResolvedValue(SERVERS as never);
  vi.mocked(getSitemapData).mockResolvedValue(DATA as never);
});

const urls = async () => (await sitemap()).map((e) => e.url);

describe("sitemap", () => {
  it("includes the home page and the static pages", async () => {
    const u = await urls();
    for (const p of ["", "/about", "/obituaries", "/fresh-spawns", "/news"]) {
      expect(u).toContain(`https://dayzonelife.com${p}`);
    }
  });

  it("includes the three canonical combined-board URLs", async () => {
    const u = await urls();
    expect(u).toContain("https://dayzonelife.com/survivors");
    expect(u).toContain("https://dayzonelife.com/survivors/kills");
    expect(u).toContain("https://dayzonelife.com/survivors/longest");
  });

  it("never advertises an explicit-default sort path, which redirects", async () => {
    const u = await urls();
    expect(u.some((x) => x.endsWith("/time"))).toBe(false);
  });

  it("includes per-map boards for every slugged server", async () => {
    const u = await urls();
    expect(u).toContain("https://dayzonelife.com/survivors/sakhal");
    expect(u).toContain("https://dayzonelife.com/survivors/livonia/kills");
  });

  it("builds a player URL with the slugified gamertag", async () => {
    expect(await urls()).toContain("https://dayzonelife.com/players/xsgt-hartman");
  });

  it("builds a life URL from the server SLUG, never the map codename", async () => {
    const u = await urls();
    expect(u).toContain("https://dayzonelife.com/players/xsgt-hartman/livonia/lives/2");
    expect(u.some((x) => x.includes("/enoch/"))).toBe(false);
  });

  it("routes each article kind to its own interior", async () => {
    expect(await urls()).toContain("https://dayzonelife.com/obituaries/hartman-falls");
  });

  it("carries the lastmod the API supplied", async () => {
    const entry = (await sitemap()).find((e) => e.url.endsWith("/obituaries/hartman-falls"));
    expect(entry?.lastModified).toEqual(new Date("2026-07-03T00:00:00.000Z"));
  });

  it("returns static and board entries when the API call fails, never throwing", async () => {
    vi.mocked(getSitemapData).mockRejectedValue(new Error("api down"));
    const u = await urls();
    expect(u).toContain("https://dayzonelife.com/survivors");
    expect(u).toContain("https://dayzonelife.com");
    expect(u.some((x) => x.includes("/players/"))).toBe(false);
  });

  it("still returns the static pages when even the servers call fails", async () => {
    vi.mocked(getServers).mockRejectedValue(new Error("api down"));
    vi.mocked(getSitemapData).mockRejectedValue(new Error("api down"));
    expect(await urls()).toContain("https://dayzonelife.com/about");
  });

  // The two fetches degrade INDEPENDENTLY. The test above covers "data fails"; this covers the
  // other direction — losing the board list must not cost us the ~470 content URLs, which are the
  // whole point of the sitemap. One shared try/catch would pass that test and fail this one.
  it("still returns player, life and article URLs when the servers call fails", async () => {
    vi.mocked(getServers).mockRejectedValue(new Error("api down"));
    const u = await urls();
    expect(u).toContain("https://dayzonelife.com/players/xsgt-hartman");
    expect(u).toContain("https://dayzonelife.com/players/xsgt-hartman/livonia/lives/2");
    expect(u).toContain("https://dayzonelife.com/obituaries/hartman-falls");
    expect(u.some((x) => x.startsWith("https://dayzonelife.com/survivors"))).toBe(false);
  });
});
