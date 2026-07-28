import { describe, it, expect } from "vitest";
import { activeNavKey, NAV_ITEMS } from "./nav";

describe("NAV_ITEMS", () => {
  it("lists exactly the five sections in order", () => {
    expect(NAV_ITEMS.map((i) => i.key)).toEqual(["home", "maps", "leaderboard", "obituaries", "about"]);
  });

  it("Obituaries points at the public feed", () => {
    const item = NAV_ITEMS.find((i) => i.key === "obituaries");
    expect(item?.href).toBe("/obituaries");
    expect(item?.label).toBe("Obituaries");
  });

  it("Survivors points at /survivors — sub-project D owns the route change", () => {
    const item = NAV_ITEMS.find((i) => i.key === "leaderboard");
    expect(item?.href).toBe("/survivors");
    // One name for one surface: the label matches the URL, the board H1 and the tab bar.
    expect(item?.label).toBe("Survivors");
  });
});

describe("activeNavKey", () => {
  it.each([
    ["/", "home"],
    ["/survivors", "leaderboard"],
    ["/survivors/sakhal/kills", "leaderboard"],
    ["/players/yrjustbad", "leaderboard"],
    ["/players/yrjustbad/livonia/lives/2", "leaderboard"],
    ["/maps", "maps"],
    ["/maps/op-cher", "maps"],
    ["/obituaries", "obituaries"],
    ["/obituaries/a-long-walk-ends-grumpy8269-1-3", "obituaries"],
    ["/about", "about"],
    ["/you", null],
    ["/login", null],
  ])("%s → %s", (path, key) => {
    expect(activeNavKey(path)).toBe(key);
  });

  // The trap: every path starts with "/", so a prefix rule for Home lights it up everywhere.
  it("matches Home on the exact root path only, never as a prefix", () => {
    expect(activeNavKey("/")).toBe("home");
    for (const path of ["/about", "/survivors", "/maps/livonia", "/friends"]) {
      expect(activeNavKey(path)).not.toBe("home");
    }
  });
});
