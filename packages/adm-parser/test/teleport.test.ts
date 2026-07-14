import { describe, it, expect } from "vitest";
import { parseTeleport } from "../src/index.js";

const LINE = '12:53:09 | Player "RonaldRaygun552" (id=89= pos=<5154.0, 1075.1, 56.3>) was teleported from: <4767.481934, 339.441010, 10376.478516> to: <5154.072754, 56.397713, 1075.143311>. Reason: Spawning in Player Restricted Area: RestrictedAreaBunkerEntrance';

describe("parseTeleport", () => {
  it("parses teleport from/to/reason", () => {
    const r = parseTeleport(LINE);
    expect(r?.gamertag).toBe("RonaldRaygun552");
    expect(r?.from).toEqual([4767.481934, 339.44101, 10376.478516]);
    expect(r?.to).toEqual([5154.072754, 56.397713, 1075.143311]);
    expect(r?.reason).toContain("RestrictedAreaBunkerEntrance");
  });
});
