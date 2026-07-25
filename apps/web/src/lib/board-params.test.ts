import { describe, expect, test } from "vitest";
import { buildTabs, parsePage, resolveSurvivorsRoute } from "./board-params";
import type { Server } from "./types";

const SLUGS = ["chernarus", "sakhal"];

function srv(name: string, slug: string | null): Server {
  return { id: 1, nitradoServiceId: 1, name, map: "m", slug, active: true, clockOffsetMs: 0, createdAt: "" };
}

describe("buildTabs", () => {
  test("slugged servers alphabetically by label", () => {
    const tabs = buildTabs([srv("Sakhal", "sakhal"), srv("Chernarus", "chernarus"), srv("Namalsk", "namalsk")]);
    expect(tabs.map((t) => t.label)).toEqual(["Chernarus", "Namalsk", "Sakhal"]);
  });

  test("drops unslugged servers", () => {
    const tabs = buildTabs([srv("Slugged", "slugged"), srv("Unslugged", null)]);
    expect(tabs.map((t) => t.label)).toEqual(["Slugged"]);
  });

  // ⚠️ No "All maps" tab: the combined board is gone (sub-project D). A life is per-server, so a
  // cross-server board ranks lives that were never in the same race.
  test("has no All maps tab, and every tab carries a real slug", () => {
    const tabs = buildTabs([srv("Chernarus", "chernarus"), srv("Sakhal", "sakhal")]);
    expect(tabs.map((t) => t.label)).not.toContain("All maps");
    expect(tabs.every((t) => typeof t.slug === "string" && t.slug.length > 0)).toBe(true);
  });

  test("an empty fleet yields no tabs, not a lone All maps", () => {
    expect(buildTabs([])).toEqual([]);
  });
});

describe("resolveSurvivorsRoute", () => {
  test("a known map slug is the board", () => {
    expect(resolveSurvivorsRoute(["sakhal"], SLUGS)).toEqual({ kind: "board", slug: "sakhal" });
  });

  test("an unknown segment is notFound", () => {
    expect(resolveSurvivorsRoute(["atlantis"], SLUGS)).toEqual({ kind: "notFound" });
  });

  test("no segments is notFound — /survivors is handled by its own route, as a redirect", () => {
    expect(resolveSurvivorsRoute([], SLUGS)).toEqual({ kind: "notFound" });
  });

  test("more than one segment is notFound — there is no sort segment", () => {
    expect(resolveSurvivorsRoute(["sakhal", "kills"], SLUGS)).toEqual({ kind: "notFound" });
    expect(resolveSurvivorsRoute(["sakhal", "time", "extra"], SLUGS)).toEqual({ kind: "notFound" });
  });

  // ⚠️ The reserved-sort-word rule is GONE, not merely unenforced. `kills`/`time`/`longest` used
  // to win over an identically-named slug in this position, which is why a server's slug could
  // never be one of them. With no sort layer there is nothing to shadow, and a slug named `kills`
  // must resolve to its board like any other.
  test("a server slug may now be a former sort word", () => {
    const slugs = ["kills", "time", "longest"];
    for (const slug of slugs) {
      expect(resolveSurvivorsRoute([slug], slugs)).toEqual({ kind: "board", slug });
    }
  });

  test("a former sort word that is NOT a slug is notFound, not a board", () => {
    expect(resolveSurvivorsRoute(["kills"], SLUGS)).toEqual({ kind: "notFound" });
    expect(resolveSurvivorsRoute(["time"], SLUGS)).toEqual({ kind: "notFound" });
    expect(resolveSurvivorsRoute(["longest"], SLUGS)).toEqual({ kind: "notFound" });
  });

  test("never returns a redirect — the explicit-default redirect is gone", () => {
    for (const segs of [[], ["time"], ["sakhal"], ["sakhal", "time"]]) {
      expect(resolveSurvivorsRoute(segs, SLUGS).kind).not.toBe("redirect");
    }
  });
});

describe("parsePage", () => {
  test("floors at 1 and tolerates junk", () => {
    expect(parsePage(undefined)).toBe(1);
    expect(parsePage("0")).toBe(1);
    expect(parsePage("-3")).toBe(1);
    expect(parsePage("banana")).toBe(1);
    expect(parsePage("4")).toBe(4);
  });

  test("takes the first value of a repeated query param", () => {
    expect(parsePage(["2", "9"])).toBe(2);
  });
});
