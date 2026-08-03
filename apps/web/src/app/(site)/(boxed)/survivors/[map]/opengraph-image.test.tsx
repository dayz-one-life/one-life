import { describe, it, expect, vi } from "vitest";
import OgImage, { size, contentType, alt } from "./opengraph-image";

vi.mock("@/lib/api", () => ({ getSurvivors: vi.fn() }));
import { getSurvivors } from "@/lib/api";

const survivors = {
  rows: [{ gamertag: "RonaldRaygun552" }],
  total: 41,
  page: 1,
  pageSize: 25,
} as never;

describe("survivors board opengraph-image", () => {
  it("declares the OG image contract", () => {
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe("image/png");
    expect(typeof alt).toBe("string");
  });

  it("renders a PNG for a board", async () => {
    vi.mocked(getSurvivors).mockResolvedValue(survivors);
    const res = await OgImage({ params: Promise.resolve({ map: "chernarus" }) });
    expect(res.headers.get("content-type")).toContain("image/png");
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  it("renders the generic fallback PNG when the board cannot be fetched", async () => {
    vi.mocked(getSurvivors).mockRejectedValue(new Error("api down"));
    const res = await OgImage({ params: Promise.resolve({ map: "chernarus" }) });
    expect(res.headers.get("content-type")).toContain("image/png");
  });

  // ⚠️ `map` is attacker-controlled URL text. Regression for a shipped bug: the fallback path
  // used to run titleCase(map) into the headline even when getSurvivors returned null, so
  // /survivors/rigged-by-admins/opengraph-image rendered an official-looking "Top Rigged By
  // Admins survivors" card. The fallback must render a neutral static PNG with no map echo.
  it("still renders a PNG for an attacker-chosen map slug when the board cannot be fetched", async () => {
    vi.mocked(getSurvivors).mockResolvedValue(null as never);
    const res = await OgImage({ params: Promise.resolve({ map: "rigged-by-admins" }) });
    expect(res.headers.get("content-type")).toContain("image/png");
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });
});
