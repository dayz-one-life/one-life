import { describe, it, expect, vi } from "vitest";
import OgImage, { size, contentType, alt } from "./opengraph-image";

vi.mock("@/lib/api", () => ({ getSiteStatsCached: vi.fn() }));
import { getSiteStatsCached } from "@/lib/api";

describe("obituaries index opengraph-image", () => {
  it("declares the OG image contract", () => {
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe("image/png");
    expect(typeof alt).toBe("string");
  });

  it("renders a PNG", async () => {
    vi.mocked(getSiteStatsCached).mockResolvedValue({ deaths: 128, alive: 41 } as never);
    const res = await OgImage();
    expect(res.headers.get("content-type")).toContain("image/png");
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  it("renders the fallback PNG when the stats cannot be fetched", async () => {
    vi.mocked(getSiteStatsCached).mockRejectedValue(new Error("api down"));
    const res = await OgImage();
    expect(res.headers.get("content-type")).toContain("image/png");
  });
});
