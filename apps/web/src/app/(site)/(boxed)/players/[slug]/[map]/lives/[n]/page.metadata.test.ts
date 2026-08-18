import { describe, it, expect, vi } from "vitest";
import { generateMetadata } from "./page";

vi.mock("@/lib/api", () => ({
  // The page module also reaches `getBlocks` (through `viewer-blocks`, for the viewer-scoped
  // avatar block); metadata never calls it, but the mocked module must still carry the export.
  getBlocks: vi.fn(async () => ({ blocks: [] })),
  getPlayerLife: vi.fn().mockResolvedValue({
    life: {
      lifeNumber: 3,
      endedAt: "2026-07-01T00:00:00.000Z",
      deathCause: "gunshot",
      playtimeSeconds: 5400,
      startedAt: "2026-06-30T00:00:00.000Z",
    },
    sessions: [],
    kills: [],
    gamertag: "RonaldRaygun552",
    map: "enoch",
  }),
}));

describe("life page metadata", () => {
  it("wraps the title in `absolute` (so the root template can't double-append the suffix) and sets OG defaults", async () => {
    const md = await generateMetadata({ params: Promise.resolve({ slug: "ronaldraygun552", map: "enoch", n: "3" }) });
    expect(md.title).toEqual({ absolute: "Life 3 · Livonia — RonaldRaygun552 — One Life" });
    expect(md.openGraph).toMatchObject({ siteName: "One Life" });
    expect(md.twitter).toMatchObject({ card: "summary_large_image" });
  });
});
