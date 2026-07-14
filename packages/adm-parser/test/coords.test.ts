import { describe, it, expect } from "vitest";
import { parsePos } from "../src/index.js";

describe("parsePos", () => {
  it("extracts x/y from a pos=<...> block", () => {
    expect(parsePos('... (id=C8= pos=<5092.3, 1143.0, 12.6>) placed X')).toEqual({ x: 5092.3, y: 1143.0 });
  });
  it("returns null when there is no position", () => {
    expect(parsePos('11:00:00 | Player "A" (id=A=) is connected')).toBeNull();
  });
  it("rejects the off-map sentinel", () => {
    expect(parsePos('pos=<-3.4e38, -3.4e38, 0>')).toBeNull();
  });
});
