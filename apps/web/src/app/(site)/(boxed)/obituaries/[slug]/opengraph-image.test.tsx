import { describe, it, expect, vi } from "vitest";
import OgImage, { size, contentType, alt } from "./opengraph-image";
import type { ObituaryArticle } from "@/lib/types";

vi.mock("@/lib/api", () => ({ getObituary: vi.fn() }));
import { getObituary } from "@/lib/api";

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
    vi.mocked(getObituary).mockResolvedValue(article);
    const res = await OgImage({ params: Promise.resolve({ slug: "s" }) });
    expect(res.headers.get("content-type")).toContain("image/png");
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  it("renders the generic fallback PNG when the obituary cannot be fetched", async () => {
    vi.mocked(getObituary).mockRejectedValue(new Error("api down"));
    const res = await OgImage({ params: Promise.resolve({ slug: "missing" }) });
    expect(res.headers.get("content-type")).toContain("image/png");
  });
});
