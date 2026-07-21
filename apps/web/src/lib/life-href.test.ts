import { describe, expect, it, test } from "vitest";
import { lifeHref, lifeHrefBySlug } from "./life-href";

describe("lifeHref", () => {
  test("slugs the gamertag and builds the per-life path", () => {
    expect(lifeHref("YrJustBad", "sakhal", 3)).toBe("/players/yrjustbad/sakhal/lives/3");
  });
  test("encodes the map slug and slugs mixed-case gamertags", () => {
    expect(lifeHref("Boots Coldwater", "chernarus", 1)).toBe("/players/boots-coldwater/chernarus/lives/1");
  });
});

describe("lifeHrefBySlug", () => {
  it("builds the life URL from an already-slugified callsign", () => {
    expect(lifeHrefBySlug("dead-eye-jim", "sakhal", 4)).toBe("/players/dead-eye-jim/sakhal/lives/4");
  });

  it("encodes a map slug that needs escaping", () => {
    expect(lifeHrefBySlug("dead-eye-jim", "a b", 1)).toBe("/players/dead-eye-jim/a%20b/lives/1");
  });

  it("agrees with lifeHref for the same player", () => {
    // The two entry points must never drift — lifeHref is the gamertag-taking wrapper.
    expect(lifeHref("Dead Eye Jim", "sakhal", 4)).toBe(lifeHrefBySlug("dead-eye-jim", "sakhal", 4));
  });
});
