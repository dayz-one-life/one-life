import { describe, it, expect } from "vitest";
import { formatDuration as playerFormatDuration } from "./player-format";
import { formatDuration as boardFormatDuration } from "./format";

describe("formatDuration is TWO different functions", () => {
  // ⚠️ Same name, same signature, different output. They are not interchangeable and must not
  // be merged: the player surfaces render hours-and-minutes, the boards render days-hours-minutes.
  it("player-format renders hours and minutes only, never days", () => {
    expect(playerFormatDuration(275_400)).toBe("76h 30m");
  });

  it("format rolls up into days", () => {
    expect(boardFormatDuration(275_400)).toBe("3d 4h 30m");
  });

  it("player-format floors a negative duration at zero", () => {
    expect(playerFormatDuration(-5)).toBe("0h 0m");
  });
});
