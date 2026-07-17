import { describe, expect, test } from "vitest";
import { lifeHref } from "./life-href";

describe("lifeHref", () => {
  test("slugs the gamertag and builds the per-life path", () => {
    expect(lifeHref("YrJustBad", "sakhal", 3)).toBe("/players/yrjustbad/sakhal/lives/3");
  });
  test("encodes the map slug and slugs mixed-case gamertags", () => {
    expect(lifeHref("Boots Coldwater", "chernarus", 1)).toBe("/players/boots-coldwater/chernarus/lives/1");
  });
});
