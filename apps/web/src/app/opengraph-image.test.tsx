import { describe, it, expect, vi } from "vitest";
import OgImage, { size, contentType, alt, homeCardState, FORMAT_STATS } from "./opengraph-image";

vi.mock("@/lib/api", () => ({ getSiteStatsCached: vi.fn() }));
import { getSiteStatsCached } from "@/lib/api";

describe("root opengraph-image", () => {
  it("declares the OG image contract", () => {
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe("image/png");
    expect(typeof alt).toBe("string");
  });

  it("renders a PNG from the live ledger", async () => {
    vi.mocked(getSiteStatsCached).mockResolvedValue({ deaths: 155, alive: 149 });
    const res = await OgImage();
    expect(res.headers.get("content-type")).toContain("image/png");
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  it("still renders a PNG when the stats fetch fails", async () => {
    vi.mocked(getSiteStatsCached).mockRejectedValue(new Error("api down"));
    const res = await OgImage();
    expect(res.headers.get("content-type")).toContain("image/png");
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });
});

/**
 * ⚠️ The card's copy decisions live in `homeCardState` precisely SO they can be asserted. A test
 * that only awaits the route gets a PNG back and can prove nothing about what the card says — it
 * cannot tell a body count from an evergreen headline, which is the whole risk here. Assert the
 * state, not the bytes.
 */
describe("homeCardState", () => {
  it("reads the ledger when the fetch succeeds", () => {
    expect(homeCardState({ deaths: 155, alive: 149 })).toEqual({ kind: "ledger", deaths: "155", alive: "149" });
  });

  it("groups thousands, so a five-figure body count stays readable", () => {
    expect(homeCardState({ deaths: 12847, alive: 38 })).toMatchObject({ deaths: "12,847" });
  });

  // ⚠️ The repo's most-repeated bug class: a failed fetch rendering as an authoritative zero. The
  // card is the site's most-shared artifact, so "Deaths to date: 0" on an API blip would be the
  // most-seen lie on the platform. Assert the digit is ABSENT, not merely that nothing threw.
  it("falls back to the evergreen headline when there are no stats", () => {
    const state = homeCardState(null);
    expect(state).toEqual({ kind: "evergreen", headline: "One life. One death. The record stands." });
    expect(JSON.stringify(state)).not.toMatch(/\d/);
  });

  // A real zero is true but sells nothing, and is indistinguishable from a blip to a visitor.
  // Collapsing it into the evergreen render is a decision, not an accident — see the spec.
  it("treats a genuine zero body count as nothing to report", () => {
    expect(homeCardState({ deaths: 0, alive: 12 })).toMatchObject({ kind: "evergreen" });
  });

  it("keeps a live survivor count out of the evergreen render", () => {
    expect(homeCardState({ deaths: 0, alive: 12 })).not.toHaveProperty("alive");
  });
});

describe("FORMAT_STATS", () => {
  it("explains the format and the platform", () => {
    expect(FORMAT_STATS.map((s) => `${s.value} ${s.label}`)).toEqual([
      "1 life per server",
      "24H ban when it ends",
      "XBOX hardcore permadeath",
    ]);
  });

  /**
   * ⚠️ Regression pin for the bug that started this work. The card shipped in v0.73.0 claiming
   * "0 second chances", which the token economy contradicts outright — one token lifts one ban,
   * and tokens are earned AND sold. The row is now static format facts and names no second-chance
   * claim in either direction; that absence is deliberate (see the spec). If this fails, the fix
   * is to remove the claim, not to relax the assertion.
   */
  it("makes no claim about second chances", () => {
    const row = JSON.stringify(FORMAT_STATS).toLowerCase();
    expect(row).not.toContain("second chance");
    expect(row).not.toContain("token");
  });

  it("carries no live data, so the row cannot go stale", () => {
    expect(FORMAT_STATS.every((s) => /^[A-Z0-9]+$/.test(s.value))).toBe(true);
  });
});
