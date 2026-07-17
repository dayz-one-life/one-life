import { describe, it, expect } from "vitest";
import { activeNavKey, NAV_ITEMS } from "./nav";

describe("NAV_ITEMS", () => {
  it("is the five-section paper nav, in order", () => {
    expect(NAV_ITEMS.map((n) => n.label)).toEqual([
      "News", "Obituaries", "Fresh Spawns", "Survivors", "About",
    ]);
  });
});

describe("activeNavKey", () => {
  it.each([
    ["/", null],
    ["/news", "news"],
    ["/obituaries", "obituaries"],
    ["/fresh-spawns", "fresh-spawns"],
    ["/survivors", "survivors"],
    ["/survivors/sakhal/kills", "survivors"],
    ["/players/yrjustbad", "survivors"],
    ["/about", "about"],
    ["/account", null],
    ["/login", null],
  ])("%s → %s", (path, key) => {
    expect(activeNavKey(path)).toBe(key);
  });

  it("a lookalike segment does not light the section", () => {
    expect(activeNavKey("/newsroom")).toBe(null);
    expect(activeNavKey("/news/some-story")).toBe("news");
  });
});
