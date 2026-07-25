import { describe, expect, test } from "vitest";
import { playerPageHref } from "./player-page-href";

describe("playerPageHref", () => {
  test("page present", () => {
    expect(playerPageHref("legend", 2)).toBe("/players/legend?page=2");
  });

  test("page omitted", () => {
    expect(playerPageHref("legend")).toBe("/players/legend");
  });

  test("page equal to 1 is omitted", () => {
    expect(playerPageHref("legend", 1)).toBe("/players/legend");
  });
});
