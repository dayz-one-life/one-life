import { describe, it, expect, vi } from "vitest";
import OgImage, { size, contentType, alt, revalidate } from "./opengraph-image";
import type { ObituaryArticle } from "@/lib/types";

vi.mock("@/lib/api", () => ({ getObituaryCached: vi.fn(), getObituary: vi.fn() }));
import { getObituaryCached, getObituary } from "@/lib/api";

const article: ObituaryArticle = {
  slug: "s", gamertag: "RonaldRaygun552", map: "sakhal", mapSlug: "sakhal", lifeNumber: 7,
  headline: "RonaldRaygun552's Seventh Sakhal File Closes With No Cause Given",
  lede: "l", tags: [], timeAliveSeconds: 3532, kills: 0, longestKillMeters: 412.3,
  cause: "died", deathAt: "2026-07-30T22:27:32.000Z",
  body: "", bodyBlocks: null, pullQuote: null, sessions: 4, killerGamertag: null, weapon: null, verdict: null,
};

describe("obituary opengraph-image", () => {
  it("declares the OG image contract", () => {
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe("image/png");
    expect(typeof alt).toBe("string");
  });

  it("renders a PNG for a real obituary", async () => {
    vi.mocked(getObituaryCached).mockResolvedValue(article);
    const res = await OgImage({ params: Promise.resolve({ slug: "s" }) });
    expect(res.headers.get("content-type")).toContain("image/png");
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  it("renders the generic fallback PNG when the obituary cannot be fetched", async () => {
    vi.mocked(getObituaryCached).mockRejectedValue(new Error("api down"));
    const res = await OgImage({ params: Promise.resolve({ slug: "missing" }) });
    expect(res.headers.get("content-type")).toContain("image/png");
  });

  // ⚠️ Next serves an opengraph-image `immutable, max-age=31536000`. That is right for a real
  // obituary and wrong for the fallback: a single scrape landing while the API is down would
  // otherwise freeze the generic card at the CDN — and in Facebook's cache — for a YEAR, with
  // re-scraping powerless to fix it.
  it("caps the failure-path card's cache lifetime so a bad render can heal", async () => {
    vi.mocked(getObituaryCached).mockRejectedValue(new Error("api down"));
    const res = await OgImage({ params: Promise.resolve({ slug: "missing" }) });
    expect(res.headers.get("cache-control")).toBe("public, max-age=60, must-revalidate");
  });

  it("leaves a real obituary card on Next's long-lived default", async () => {
    vi.mocked(getObituaryCached).mockResolvedValue(article);
    const res = await OgImage({ params: Promise.resolve({ slug: "s" }) });
    expect(res.headers.get("cache-control")).not.toBe("public, max-age=60, must-revalidate");
  });

  // ⚠️ This route is what a social crawler actually fetches, and rendering it costs an API
  // round-trip, a font load and a PNG encode. Uncached, Facebook's scraper intermittently timed
  // out on it and published posts with a blank card. Reverting either assertion reinstates that.
  it("declares an ISR window so the generated PNG is cacheable", () => {
    expect(revalidate).toBe(300);
  });

  it("reads through the cookie-free fetcher, so the route stays statically renderable", async () => {
    vi.mocked(getObituaryCached).mockResolvedValue(article);
    await OgImage({ params: Promise.resolve({ slug: "s" }) });
    expect(getObituaryCached).toHaveBeenCalledWith("s");
    expect(getObituary).not.toHaveBeenCalled();
  });
});
