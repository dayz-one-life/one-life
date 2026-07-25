import { describe, it, expect } from "vitest";
import { activeNavKey, NAV_ITEMS } from "./nav";

describe("NAV_ITEMS", () => {
  it("lists exactly the three surviving sections", () => {
    expect(NAV_ITEMS.map((i) => i.key)).toEqual(["survivors", "maps", "about"]);
  });
});

describe("activeNavKey", () => {
  it.each([
    ["/", null],
    ["/survivors", "survivors"],
    ["/survivors/sakhal/kills", "survivors"],
    ["/players/yrjustbad", "survivors"],
    ["/maps", "maps"],
    ["/maps/op-cher", "maps"],
    ["/about", "about"],
    ["/account", null],
    ["/login", null],
  ])("%s → %s", (path, key) => {
    expect(activeNavKey(path)).toBe(key);
  });
});
