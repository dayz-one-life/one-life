import { describe, it, expect, vi } from "vitest";
import OgImage, { size, contentType, alt } from "./opengraph-image";

vi.mock("@/lib/api", () => ({ getPlayerPage: vi.fn() }));
import { getPlayerPage } from "@/lib/api";

const page = {
  gamertag: "RonaldRaygun552",
  firstSeenAt: "2026-05-01T00:00:00.000Z",
  totals: { kills: 3, lives: 7, deaths: 6, longestLifeSeconds: 3600 },
} as never;

describe("player opengraph-image", () => {
  it("declares the OG image contract", () => {
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe("image/png");
    expect(typeof alt).toBe("string");
  });

  it("renders a PNG for a real player", async () => {
    vi.mocked(getPlayerPage).mockResolvedValue(page);
    const res = await OgImage({ params: Promise.resolve({ slug: "ronaldraygun552" }) });
    expect(res.headers.get("content-type")).toContain("image/png");
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  it("renders the generic fallback PNG when the player cannot be fetched", async () => {
    vi.mocked(getPlayerPage).mockRejectedValue(new Error("api down"));
    const res = await OgImage({ params: Promise.resolve({ slug: "missing" }) });
    expect(res.headers.get("content-type")).toContain("image/png");
  });
});
