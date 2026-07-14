import { describe, it, expect } from "vitest";
import { parseLine } from "../src/index.js";

describe("parseLine", () => {
  it("returns a boot for the header", () => {
    expect(parseLine("AdminLog started on 2026-07-06 at 12:51:59"))
      .toEqual([{ kind: "boot", localDateTime: "2026-07-06 12:51:59" }]);
  });
  it("returns connecting", () => {
    expect(parseLine('12:52:38 | Player "A" (id=A=) is connecting'))
      .toEqual([{ kind: "connecting", gamertag: "A", dayzId: "A=" }]);
  });
  it("returns both death and position for a pvp kill with coords", () => {
    const out = parseLine('10:00:00 | Player "Victim" (DEAD) (id=ABC pos=<7404.1, 3229.9, 6.1>) killed by Player "Killer" (id=XYZ pos=<7500.0, 3300.0, 6.0>) with M4A1 from 153.4 meters');
    expect(out.find((e) => e.kind === "death")).toMatchObject({ cause: "pvp", killer: "Killer" });
    expect(out.find((e) => e.kind === "position")).toMatchObject({ gamertag: "Victim", x: 7404.1, y: 3229.9 });
  });
  it("returns emote plus position", () => {
    const out = parseLine('12:56:51 | Player "S" (id=D= pos=<235.7, 2924.6, 107.3>) performed EmoteSitA with R12');
    expect(out.map((e) => e.kind).sort()).toEqual(["emote", "position"]);
  });
  it("returns empty for an unrecognized line", () => {
    expect(parseLine("10:00:00 | some future line we do not parse yet")).toEqual([]);
  });
});
