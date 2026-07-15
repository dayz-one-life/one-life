import { describe, expect, test } from "vitest";
import { buildTabs, resolveSurvivorsRoute } from "./board-params";
import type { Server } from "./types";

const SLUGS = ["chernarus", "sakhal"];

function srv(name: string, slug: string | null): Server {
  return { id: 1, nitradoServiceId: 1, name, map: "m", slug, active: true, clockOffsetMs: 0, createdAt: "" };
}

describe("buildTabs", () => {
  test("'All maps' first, then slugged servers alphabetically by label", () => {
    const tabs = buildTabs([srv("Sakhal", "sakhal"), srv("Chernarus", "chernarus"), srv("Namalsk", "namalsk")]);
    expect(tabs.map((t) => t.label)).toEqual(["All maps", "Chernarus", "Namalsk", "Sakhal"]);
    expect(tabs[0]?.slug).toBeNull();
  });

  test("drops unslugged servers", () => {
    const tabs = buildTabs([srv("Slugged", "slugged"), srv("Unslugged", null)]);
    expect(tabs.map((t) => t.label)).toEqual(["All maps", "Slugged"]);
  });
});

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
