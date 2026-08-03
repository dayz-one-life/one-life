import { describe, it, expect, vi } from "vitest";
import OgImage, { size, contentType, alt } from "./opengraph-image";

vi.mock("@/lib/api", () => ({ getPlayerLife: vi.fn() }));
import { getPlayerLife } from "@/lib/api";

const deadLife = {
  life: {
    lifeNumber: 3,
    endedAt: "2026-07-01T00:00:00.000Z",
    deathCause: "gunshot",
    playtimeSeconds: 5400,
    startedAt: "2026-06-30T00:00:00.000Z",
  },
  sessions: [{}, {}],
  kills: [{}],
  gamertag: "RonaldRaygun552",
  map: "livonia",
} as never;

const liveLife = {
  life: {
    lifeNumber: 3,
    endedAt: null,
    deathCause: null,
    playtimeSeconds: 5400,
    startedAt: "2026-06-30T00:00:00.000Z",
  },
  sessions: [{}, {}],
  kills: [{}],
  gamertag: "RonaldRaygun552",
  map: "livonia",
} as never;

describe("life opengraph-image", () => {
  it("declares the OG image contract", () => {
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe("image/png");
    expect(typeof alt).toBe("string");
  });

  it("renders a PNG for a dead life", async () => {
    vi.mocked(getPlayerLife).mockResolvedValue(deadLife);
    const res = await OgImage({ params: Promise.resolve({ slug: "ronaldraygun552", map: "livonia", n: "3" }) });
    expect(res.headers.get("content-type")).toContain("image/png");
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  it("renders a PNG for a live life", async () => {
    vi.mocked(getPlayerLife).mockResolvedValue(liveLife);
    const res = await OgImage({ params: Promise.resolve({ slug: "ronaldraygun552", map: "livonia", n: "3" }) });
    expect(res.headers.get("content-type")).toContain("image/png");
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  it("renders the generic fallback PNG when the api is down", async () => {
    vi.mocked(getPlayerLife).mockRejectedValue(new Error("api down"));
    const res = await OgImage({ params: Promise.resolve({ slug: "ronaldraygun552", map: "livonia", n: "3" }) });
    expect(res.headers.get("content-type")).toContain("image/png");
  });
});
