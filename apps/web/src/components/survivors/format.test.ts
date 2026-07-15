import { describe, expect, test } from "vitest";
import { formatTimeAlive, avatarSrc } from "./format";

describe("formatTimeAlive", () => {
  test("formats hours and minutes", () => {
    expect(formatTimeAlive(6 * 3600 + 43 * 60)).toBe("6h 43m");
    expect(formatTimeAlive(41 * 60)).toBe("0h 41m");
  });
});

describe("avatarSrc", () => {
  test("lowercases the roster name", () => {
    expect(avatarSrc({ name: "Helga", head: "f_helga", gender: "female" })).toBe("/characters/helga.webp");
  });
  test("returns null when character is null", () => {
    expect(avatarSrc(null)).toBeNull();
  });
  test("returns null when character name is null", () => {
    expect(avatarSrc({ name: null, head: null, gender: null })).toBeNull();
  });
});
