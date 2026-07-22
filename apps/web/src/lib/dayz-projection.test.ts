import { describe, it, expect } from "vitest";
import { MAP_WORLD_SIZE, worldSize, worldToPixel, pixelToWorld } from "./dayz-projection";

describe("worldSize", () => {
  it("knows the three maps we run", () => {
    expect(MAP_WORLD_SIZE.chernarusplus).toBe(15360);
    expect(MAP_WORLD_SIZE.sakhal).toBe(15360);
    expect(MAP_WORLD_SIZE.enoch).toBe(12800);
  });

  it("returns null for an unknown codename rather than guessing a size", () => {
    expect(worldSize("banov")).toBeNull();
  });
});

describe("worldToPixel", () => {
  it("puts the world origin at the BOTTOM-left of the canvas", () => {
    expect(worldToPixel(0, 0, 15360, 16384)).toEqual([0, 16384]);
  });

  it("puts the world's north-east corner at the top-right", () => {
    expect(worldToPixel(15360, 15360, 15360, 16384)).toEqual([16384, 0]);
  });

  it("scales the centre to the canvas centre", () => {
    expect(worldToPixel(7680, 7680, 15360, 16384)).toEqual([8192, 8192]);
  });

  it("flips y — a northern position maps to a SMALLER pixel y than a southern one", () => {
    const [, north] = worldToPixel(0, 12000, 15360, 16384);
    const [, south] = worldToPixel(0, 3000, 15360, 16384);
    expect(north).toBeLessThan(south);
  });
});

describe("pixelToWorld", () => {
  it("is the exact inverse of worldToPixel", () => {
    // A round trip, not a hand-computed constant: this is the property that matters, and it
    // cannot drift out of agreement with worldToPixel the way a copied literal can.
    for (const [x, y] of [[0, 0], [15360, 15360], [6780, 2320], [1, 15359]] as const) {
      const [px, py] = worldToPixel(x, y, 15360, 16384);
      const [bx, by] = pixelToWorld(px, py, 15360, 16384);
      expect(bx).toBeCloseTo(x, 6);
      expect(by).toBeCloseTo(y, 6);
    }
  });

  it("flips northing back: the top of the canvas is the top of the map", () => {
    const [, y] = pixelToWorld(0, 0, 15360, 16384);
    expect(y).toBe(15360);
  });

  it("works on a map with a different world size", () => {
    const [px, py] = worldToPixel(4000, 9000, 12800, 16384);
    const [x, y] = pixelToWorld(px, py, 12800, 16384);
    expect(x).toBeCloseTo(4000, 6);
    expect(y).toBeCloseTo(9000, 6);
  });
});
