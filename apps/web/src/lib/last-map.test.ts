import { describe, it, expect } from "vitest";
import { resolveMapSlug } from "./last-map";

// `slug` is nullable on a real server row and `map` is the mission CODENAME, never the label.
const SERVERS = [
  { map: "sakhal", slug: "op-sakhal" },
  { map: "chernarusplus", slug: "op-cher" },
  { map: "enoch", slug: "op-livonia" },
];

describe("resolveMapSlug", () => {
  it("honours the map the visitor last opened", () => {
    expect(resolveMapSlug(SERVERS, "op-livonia")).toBe("op-livonia");
  });

  it("falls back to Chernarus for a visitor who has never opened one", () => {
    // Not the first entry in the list, so a `[0]` implementation cannot pass this.
    expect(resolveMapSlug(SERVERS, null)).toBe("op-cher");
  });

  // ⚠️ The whole reason the cookie is re-checked rather than trusted: `GET /servers` returns
  // ACTIVE servers only, so a remembered slug that has since gone away would redirect the
  // visitor to a 404 on the one link they clicked to get to a map at all.
  it("ignores a remembered slug that is no longer a live server", () => {
    expect(resolveMapSlug(SERVERS, "op-retired")).toBe("op-cher");
  });

  it("falls back to any slugged server when Chernarus is not among them", () => {
    expect(resolveMapSlug([{ map: "sakhal", slug: "op-sakhal" }], null)).toBe("op-sakhal");
  });

  // A server row's slug is hand-set and nullable. An un-slugged server has no URL, so offering
  // it would build `/maps/null`.
  it("skips un-slugged servers entirely", () => {
    expect(
      resolveMapSlug([{ map: "chernarusplus", slug: null }, { map: "sakhal", slug: "op-sakhal" }], null),
    ).toBe("op-sakhal");
  });

  it("returns null when there is nowhere to send anyone", () => {
    expect(resolveMapSlug([], null)).toBeNull();
    expect(resolveMapSlug([{ map: "chernarusplus", slug: null }], null)).toBeNull();
  });
});
