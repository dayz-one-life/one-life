import { describe, it, expect } from "vitest";
import { parsePosition } from "../src/index.js";

describe("parsePosition", () => {
  it("harvests x,y from a pos token", () => {
    expect(parsePosition('12:34:56 | Player "Alice" (id=ABC123= pos=<7500.5, 3200.1, 300.0>) is connected'))
      .toEqual({ gamertag: "Alice", x: 7500.5, y: 3200.1 });
  });
  it("rejects the off-map sentinel", () => {
    expect(parsePosition('12:34:56 | Player "Ghost" (id=G=) pos=<-340282346638528859811704183484516925440.000000, -340282346638528859811704183484516925440.000000, 0.0>)')).toBeNull();
  });
  it("ignores hit-by lines", () => {
    expect(parsePosition('10:00:00 | Player "V" (id=V= pos=<10,20,1>)[HP: 50] hit by Player "A" (id=A=) into Torso')).toBeNull();
  });
});
