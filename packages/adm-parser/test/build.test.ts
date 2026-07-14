import { describe, it, expect } from "vitest";
import { parseBuild } from "../src/index.js";

describe("parseBuild", () => {
  it("parses placed with className", () => {
    expect(parseBuild('13:13:18 | Player "YrJustBad" (id=C8= pos=<5092.3, 1143.0, 12.6>) placed Land Mine<LandMineTrap>'))
      .toEqual({ gamertag: "YrJustBad", action: "placed", object: "Land Mine", className: "LandMineTrap", tool: null, x: 5092.3, y: 1143.0 });
  });
  it("parses Built with no leading space and a tool", () => {
    expect(parseBuild('15:10:41 | Player "YrJustBad" (id=C8= pos=<11563, 14746.2, 77.8>)Built base on Fence with Farming Hoe'))
      .toEqual({ gamertag: "YrJustBad", action: "built", object: "base on Fence", className: null, tool: "Farming Hoe", x: 11563, y: 14746.2 });
  });
  it("parses dismantled", () => {
    const r = parseBuild('10:00:00 | Player "A" (id=A= pos=<1,2,3>) Dismantled Lower Metal Wall from Fence with Pliers');
    expect(r).toMatchObject({ action: "dismantled", tool: "Pliers" });
  });
  it("returns null for non-build lines", () => {
    expect(parseBuild('10:00:00 | Player "A" (id=A=) is connected')).toBeNull();
  });
  it("captures build position", () => {
    const r = parseBuild('13:13:18 | Player "B" (id=C8= pos=<5092.3, 1143.0, 12.6>) placed Land Mine<LandMineTrap>');
    expect(r).toMatchObject({ x: 5092.3, y: 1143.0 });
  });
});
