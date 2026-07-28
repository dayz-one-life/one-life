import { describe, it, expect } from "vitest";
import { findPlaceViolations, PLACE_EXEMPT_MAPS } from "../src/no-place.js";
import type { Obituary } from "../src/prompt.js";

const clean: Obituary = {
  headline: "A Long Walk Ends",
  lede: "He survived nine days on Chernarus.",
  body: "The record shows patience and one mistake.",
  pullQuote: { text: "He was careful until he wasn't.", attribution: "an unnamed rival" },
  tags: ["Poultry"],
};

describe("findPlaceViolations", () => {
  it("passes clean prose that names only the map", () => {
    expect(findPlaceViolations(clean, { exempt: [] })).toEqual([]);
  });
  it("catches a real place name from the vendored list, in any field", () => {
    const dirty = { ...clean, body: "He died within sight of Chernogorsk." };
    expect(findPlaceViolations(dirty, { exempt: [] })).toEqual(["chernogorsk"]);
  });
  it("catches a structure word from the curated list", () => {
    const dirty = { ...clean, lede: "Found in a barn, nine days old." };
    expect(findPlaceViolations(dirty, { exempt: [] })).toEqual(["barn"]);
  });
  it("catches a terrain word and a violating tag", () => {
    const dirty = { ...clean, headline: "Death on the Coast", tags: ["Elektro"] };
    expect(findPlaceViolations(dirty, { exempt: [] }).sort()).toEqual(["coast", "elektro"]);
  });
  it("exempts gamertags — a callsign containing a banned word never trips it", () => {
    const dirty = { ...clean, body: "BarnOwl was the last to see him." };
    expect(findPlaceViolations(dirty, { exempt: ["BarnOwl"] })).toEqual([]);
    // but a bare use of the word next to the exempt callsign still trips
    const both = { ...clean, body: "BarnOwl found him behind a barn." };
    expect(findPlaceViolations(both, { exempt: ["BarnOwl"] })).toEqual(["barn"]);
  });
  it("map labels and codenames are exempt", () => {
    for (const m of ["Chernarus", "Sakhal", "Livonia", "chernarusplus", "enoch"]) {
      expect(PLACE_EXEMPT_MAPS).toContain(m);
    }
    const withMaps = { ...clean, body: "Nine days on Livonia, longer than most manage on Sakhal." };
    expect(findPlaceViolations(withMaps, { exempt: [] })).toEqual([]);
  });
  it("matches on word boundaries only — 'roadmap' does not contain the banned 'road'", () => {
    const ok = { ...clean, body: "His roadmap was simple: survive." };
    expect(findPlaceViolations(ok, { exempt: [] })).toEqual([]);
  });
  it("is case-insensitive", () => {
    const dirty = { ...clean, body: "THE CHURCH WAS QUIET." };
    expect(findPlaceViolations(dirty, { exempt: [] })).toEqual(["church"]);
  });
});
