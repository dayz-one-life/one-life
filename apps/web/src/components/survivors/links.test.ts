import { describe, expect, test } from "vitest";
import { boardHref } from "./links";

describe("boardHref", () => {
  test("emits sort as a path segment, omits default sort and page=1", () => {
    // default sort (time) => no sort segment
    expect(boardHref(null, "time", 1)).toBe("/survivors");
    expect(boardHref("chernarus", "time", 1)).toBe("/survivors/chernarus");
    // non-default sort => trailing path segment
    expect(boardHref(null, "kills", 1)).toBe("/survivors/kills");
    expect(boardHref("chernarus", "longest", 1)).toBe("/survivors/chernarus/longest");
    // page > 1 stays a query param, after the sort segment
    expect(boardHref("sakhal", "kills", 3)).toBe("/survivors/sakhal/kills?page=3");
    expect(boardHref(null, "time", 2)).toBe("/survivors?page=2");
  });
});
