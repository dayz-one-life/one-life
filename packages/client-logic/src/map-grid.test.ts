import { describe, expect, it } from "vitest";
import { gridRef } from "./map-grid";

describe("gridRef", () => {
  it("reads metres as a 3-digit easting/northing pair", () => {
    expect(gridRef(6780, 2320)).toBe("067 023");
  });

  it("zero-pads, so a coordinate never changes width as you pan", () => {
    expect(gridRef(0, 0)).toBe("000 000");
    expect(gridRef(950, 120)).toBe("009 001");
  });

  it("truncates rather than rounds — a square is the square you are standing in", () => {
    expect(gridRef(6799, 2399)).toBe("067 023");
  });

  it("keeps three digits at the far edge of the biggest map", () => {
    expect(gridRef(15360, 15360)).toBe("153 153");
  });

  it("clamps a negative coordinate to zero instead of printing a minus sign", () => {
    // Panning past the map edge is normal; the readout must stay a grid reference.
    expect(gridRef(-40, -1)).toBe("000 000");
  });
});
