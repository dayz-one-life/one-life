import { describe, it, expect } from "vitest";
import { loadCardAssets, OG_SIZE, DARK, PAPER, RED, DIM } from "./assets";

describe("og assets", () => {
  it("declares the shared card contract", () => {
    expect(OG_SIZE).toEqual({ width: 1200, height: 630 });
    expect([DARK, PAPER, RED, DIM]).toEqual(["#0C0C08", "#FBFAF2", "#FF1E12", "#8A8878"]);
  });

  it("loads fonts and images from og-assets", async () => {
    const assets = await loadCardAssets();
    expect(assets.fonts.map((f) => f.name)).toEqual(["Oswald", "IBM Plex Mono", "IBM Plex Mono"]);
    for (const f of assets.fonts) expect(f.data.byteLength).toBeGreaterThan(0);
    expect(assets.wordmark).toMatch(/^data:image\/png;base64,/);
    expect(assets.skull).toMatch(/^data:image\/png;base64,/);
  });
});
