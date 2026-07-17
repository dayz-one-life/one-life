import { describe, expect, test } from "vitest";
import { formatTimeAlive, tierFor, dekLine, showingLine } from "./format";

describe("formatTimeAlive", () => {
  test("formats hours and minutes", () => {
    expect(formatTimeAlive(6 * 3600 + 43 * 60)).toBe("6h 43m");
    expect(formatTimeAlive(41 * 60)).toBe("0h 41m");
  });
});

describe("tierFor", () => {
  test("rank 1 is hero, 2-3 podium, 4+ compact", () => {
    expect(tierFor(1)).toBe("hero");
    expect(tierFor(2)).toBe("podium");
    expect(tierFor(3)).toBe("podium");
    expect(tierFor(4)).toBe("compact");
    expect(tierFor(26)).toBe("compact");
  });
});

describe("dekLine", () => {
  test("counts still drawing breath", () => {
    expect(dekLine(56)).toBe("56 still drawing breath. Every name is one bad decision from Obituaries.");
    expect(dekLine(1)).toBe("1 still drawing breath. Every name is one bad decision from Obituaries.");
  });
});

describe("showingLine", () => {
  test("ranges within the total", () => {
    expect(showingLine(1, 25, 56)).toBe("Showing 1–25 of 56 still breathing");
    expect(showingLine(3, 25, 56)).toBe("Showing 51–56 of 56 still breathing");
  });
  test("clamps an out-of-range page", () => {
    expect(showingLine(4, 25, 56)).toBe("Showing 56–56 of 56 still breathing");
  });
});
