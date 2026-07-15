import { describe, expect, test } from "vitest";
import { boardHref } from "./links";

describe("boardHref", () => {
  test("builds canonical hrefs, omits page=1, keeps sort", () => {
    expect(boardHref(null, "kills", 1)).toBe("/survivors");
    expect(boardHref("chernarus", "kills", 1)).toBe("/survivors/chernarus");
    expect(boardHref("chernarus", "longest", 1)).toBe("/survivors/chernarus?sort=longest");
    expect(boardHref("sakhal", "time", 3)).toBe("/survivors/sakhal?sort=time&page=3");
    expect(boardHref(null, "kills", 2)).toBe("/survivors?page=2");
  });
});
