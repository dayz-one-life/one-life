import { describe, expect, test } from "vitest";
import { playerPageHref } from "./player-page-href";

describe("playerPageHref", () => {
  test("both params present", () => {
    expect(playerPageHref("legend", { page: 2, ap: 3 })).toBe("/players/legend?page=2&ap=3");
  });

  test("only page present", () => {
    expect(playerPageHref("legend", { page: 2 })).toBe("/players/legend?page=2");
  });

  test("only ap present", () => {
    expect(playerPageHref("legend", { ap: 3 })).toBe("/players/legend?ap=3");
  });

  test("neither present", () => {
    expect(playerPageHref("legend", {})).toBe("/players/legend");
  });

  test("page equal to 1 is omitted", () => {
    expect(playerPageHref("legend", { page: 1, ap: 3 })).toBe("/players/legend?ap=3");
  });

  test("ap equal to 1 is omitted", () => {
    expect(playerPageHref("legend", { page: 2, ap: 1 })).toBe("/players/legend?page=2");
  });

  test("both equal to 1 yields the bare path", () => {
    expect(playerPageHref("legend", { page: 1, ap: 1 })).toBe("/players/legend");
  });
});
