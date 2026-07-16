import { describe, it, expect } from "vitest";
import { serverTagline, formatOrList, countWord } from "./server-blurbs";

describe("serverTagline", () => {
  it("knows the shipped bureaus", () => {
    expect(serverTagline("chernarus")).toBe("THE CLASSIC. 230 KM² OF POOR JUDGMENT AND WORSE WEATHER.");
    expect(serverTagline("livonia")).toBe("WET, GREEN, QUIET. THE QUIET IS BAIT. THE WOLVES ARE ORGANIZED.");
    expect(serverTagline("sakhal")).toBe("VOLCANIC AND FROZEN AT ONCE. THE ISLAND KILLS MORE THAN THE PLAYERS.");
  });
  it("falls back for unknown bureaus", () => {
    expect(serverTagline("nasdara")).toBe("NEW BUREAU. THE DESK IS STILL WRITING THE INSULT.");
  });
});

describe("formatOrList", () => {
  it.each([
    [["Chernarus"], "Chernarus"],
    [["Chernarus", "Sakhal"], "Chernarus or Sakhal"],
    [["Chernarus", "Livonia", "Sakhal"], "Chernarus, Livonia, or Sakhal"],
  ])("%j → %s", (input, expected) => {
    expect(formatOrList(input)).toBe(expected);
  });
});

describe("countWord", () => {
  it("spells small counts, passes big ones through", () => {
    expect(countWord(2)).toBe("TWO");
    expect(countWord(3)).toBe("THREE");
    expect(countWord(11)).toBe("11");
  });
});
