import { describe, it, expect, vi } from "vitest";
import { generateMetadata } from "./page";
import { getPlayerLife } from "@/lib/api";

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

  const descriptionFor = async (life: Record<string, unknown>) => {
    vi.mocked(getPlayerLife).mockResolvedValueOnce({
      life: { lifeNumber: 3, playtimeSeconds: 5400, startedAt: "2026-06-30T00:00:00.000Z", ...life },
      sessions: [], kills: [], gamertag: "RonaldRaygun552", map: "enoch",
    } as never);
    const md = await generateMetadata({ params: Promise.resolve({ slug: "ronaldraygun552", map: "enoch", n: "3" }) });
    expect(md.openGraph).toMatchObject({ description: md.description });
    return md.description;
  };

  it("describes a dead life with the death that ended it", async () => {
    expect(await descriptionFor({ endedAt: "2026-07-01T00:00:00.000Z", deathCause: "gunshot", endReason: "death" }))
      .toBe("The record of RonaldRaygun552's life 3 on Livonia — every session, kill, and the death that ended it.");
  });

  it("describes an open life without a death", async () => {
    expect(await descriptionFor({ endedAt: null, deathCause: null })).toBe(
      "The record of RonaldRaygun552's life 3 on Livonia: every session and kill so far.");
  });

  it("describes a retired life as ending when the server closed, not in a death", async () => {
    expect(await descriptionFor({ endedAt: "2026-10-15T09:00:00.000Z", deathCause: null, endReason: "server_retired" })).toBe(
      "The record of RonaldRaygun552's life 3 on Livonia: every session and kill, until the server closed.");
  });
});
