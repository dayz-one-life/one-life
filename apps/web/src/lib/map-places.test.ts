import { describe, it, expect } from "vitest";
import { placesFor, placeMinZoom, placeWeight, PLACE_FALLBACK_MIN_ZOOM } from "./map-places";
import data from "./map-places.json";

describe("map-places data", () => {
  it("covers every map codename the app serves", () => {
    // These are `servers.map` codenames, NOT DZMap's publishing names — Livonia's upstream
    // data is published as `livonia` and is re-keyed to `enoch` by the refresh script.
    for (const codename of ["chernarusplus", "enoch", "sakhal"]) {
      expect(placesFor(codename, 6).length).toBeGreaterThan(0);
    }
  });

  it("names are display-cased, not the lowercase source strings", () => {
    const all = Object.values(data as Record<string, { name: string }[]>).flat();
    expect(all.length).toBeGreaterThan(300);
    for (const p of all) expect(p.name[0]).toBe(p.name[0]!.toUpperCase());
    const names = all.map((p) => p.name);
    expect(names).toContain("Chernogorsk");
    expect(names).toContain("Novaya Petrovka"); // every word, not just the first
    expect(names).toContain("Petropavlovsk-Sakhalinsk"); // and after a hyphen
  });

  it("keeps coordinates in Leaflet CRS.Simple space, never re-projected metres", () => {
    // A regression here means someone "fixed" the data by running it through worldToPixel.
    // CRS.Simple lat on this pyramid is negative and |value| <= 256; metres would be 0..15360.
    for (const p of placesFor("chernarusplus", 6)) {
      expect(p.lat).toBeLessThanOrEqual(0);
      expect(p.lat).toBeGreaterThan(-256);
      expect(p.lng).toBeGreaterThanOrEqual(0);
      expect(p.lng).toBeLessThan(256);
    }
  });

  it("puts Chernogorsk where Chernogorsk actually is", () => {
    // Independently pins the pyramid extent (CANVAS_PX = 16384 in map-canvas.tsx, long
    // flagged as an unverified assumption): lng 112.98 * 64px = 7231px of 16384 across a
    // 15360m map is ~6780m east, and lat -217.30 is ~2320m north — the real town.
    const cherno = placesFor("chernarusplus", 0).find((p) => p.name === "Chernogorsk")!;
    expect(Math.round((cherno.lng * 64 / 16384) * 15360)).toBeGreaterThan(6500);
    expect(Math.round((cherno.lng * 64 / 16384) * 15360)).toBeLessThan(7000);
    const north = 15360 - (-cherno.lat * 64 / 16384) * 15360;
    expect(north).toBeGreaterThan(2100);
    expect(north).toBeLessThan(2600);
  });
});

describe("zoom tiering", () => {
  it("shows capitals and cities from the widest view", () => {
    const wide = placesFor("chernarusplus", 0);
    expect(wide.length).toBeGreaterThan(0);
    for (const p of wide) expect(["capital", "city"]).toContain(p.kind);
  });

  it("adds villages, then the long tail, as you zoom in", () => {
    const z0 = placesFor("chernarusplus", 0).length;
    const z2 = placesFor("chernarusplus", 2).length;
    const z4 = placesFor("chernarusplus", 4).length;
    expect(z2).toBeGreaterThan(z0);
    expect(z4).toBeGreaterThan(z2);
    expect(z4).toBe(201); // everything, at the closest tier
  });

  it("hides a category DayZ adds later until the closest zoom", () => {
    // An unknown category must never flood the zoomed-out view; the default is restrictive.
    expect(placeMinZoom("some_future_kind")).toBe(PLACE_FALLBACK_MIN_ZOOM);
    expect(PLACE_FALLBACK_MIN_ZOOM).toBe(4);
  });

  it("returns nothing for a map we have no chart for, instead of throwing", () => {
    expect(placesFor("banov", 6)).toEqual([]);
  });
});

describe("placeWeight", () => {
  it("ranks settlements above terrain features", () => {
    expect(placeWeight("capital")).toBe("major");
    expect(placeWeight("city")).toBe("major");
    expect(placeWeight("village")).toBe("minor");
    expect(placeWeight("hill")).toBe("faint");
    expect(placeWeight("whatever")).toBe("faint");
  });
});
