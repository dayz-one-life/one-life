import { describe, expect, test } from "vitest";
import { boardHref } from "./links";

describe("boardHref", () => {
  test("page 1 has exactly one URL — no ?page=1", () => {
    expect(boardHref("chernarus", 1)).toBe("/survivors/chernarus");
  });

  test("page > 1 is a query param", () => {
    expect(boardHref("sakhal", 3)).toBe("/survivors/sakhal?page=3");
  });

  // ⚠️ Every board URL is slugged. The combined board and the sort segments are gone
  // (sub-project D), so no path this builds may resolve to a redirect or a 404.
  test("never emits a bare /survivors, which is a per-viewer redirect", () => {
    for (const page of [1, 2, 10]) {
      expect(boardHref("livonia", page).startsWith("/survivors/livonia")).toBe(true);
    }
  });

  test("never emits a sort segment", () => {
    for (const word of ["time", "kills", "longest"]) {
      expect(boardHref("chernarus", 1)).not.toContain(`/${word}`);
    }
  });
});
