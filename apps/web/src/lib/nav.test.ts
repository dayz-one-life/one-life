import { describe, it, expect } from "vitest";
import { activeNavKey, NAV_ITEMS } from "./nav";

describe("NAV_ITEMS", () => {
  it("lists exactly the four sections in order", () => {
    expect(NAV_ITEMS.map((i) => i.key)).toEqual(["home", "maps", "leaderboard", "about"]);
  });

  it("Leaderboard still points at /survivors — sub-project D owns the route change", () => {
    expect(NAV_ITEMS.find((i) => i.key === "leaderboard")?.href).toBe("/survivors");
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
