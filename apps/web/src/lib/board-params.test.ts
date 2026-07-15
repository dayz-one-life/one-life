import { describe, expect, test } from "vitest";
import { resolveSurvivorsRoute } from "./board-params";

const SLUGS = ["chernarus", "sakhal"];

describe("resolveSurvivorsRoute", () => {
  test("no segments -> combined board, default (time) sort", () => {
    expect(resolveSurvivorsRoute([], SLUGS)).toEqual({ kind: "board", slug: null, sort: "time" });
  });

  test("depth-1 sort word -> combined board sorted by it", () => {
    expect(resolveSurvivorsRoute(["kills"], SLUGS)).toEqual({ kind: "board", slug: null, sort: "kills" });
    expect(resolveSurvivorsRoute(["longest"], SLUGS)).toEqual({ kind: "board", slug: null, sort: "longest" });
  });

  test("depth-1 explicit default sort redirects to the bare combined board", () => {
    expect(resolveSurvivorsRoute(["time"], SLUGS)).toEqual({ kind: "redirect", to: "/survivors" });
  });

  test("depth-1 known map slug -> that map, default sort", () => {
    expect(resolveSurvivorsRoute(["sakhal"], SLUGS)).toEqual({ kind: "board", slug: "sakhal", sort: "time" });
  });

  test("depth-1 unknown segment -> notFound", () => {
    expect(resolveSurvivorsRoute(["atlantis"], SLUGS)).toEqual({ kind: "notFound" });
  });

  test("depth-2 map + sort -> that map sorted", () => {
    expect(resolveSurvivorsRoute(["sakhal", "kills"], SLUGS)).toEqual({ kind: "board", slug: "sakhal", sort: "kills" });
  });

  test("depth-2 explicit default sort redirects to bare map path", () => {
    expect(resolveSurvivorsRoute(["sakhal", "time"], SLUGS)).toEqual({ kind: "redirect", to: "/survivors/sakhal" });
  });

  test("depth-2 unknown map -> notFound", () => {
    expect(resolveSurvivorsRoute(["atlantis", "kills"], SLUGS)).toEqual({ kind: "notFound" });
  });

  test("depth-2 invalid sort -> notFound", () => {
    expect(resolveSurvivorsRoute(["sakhal", "bogus"], SLUGS)).toEqual({ kind: "notFound" });
  });

  test("more than two segments -> notFound", () => {
    expect(resolveSurvivorsRoute(["sakhal", "kills", "extra"], SLUGS)).toEqual({ kind: "notFound" });
  });
});
