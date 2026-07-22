import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import FriendsMap from "./friends-map";
import type { FriendMap } from "@/lib/types";

// Same shape as track-map.test.tsx: jsdom has no layout, so real Leaflet cannot initialise and
// EVERY symbol the component touches must be doubled — a partial mock throws inside the effect's
// promise as an unhandled rejection, leaving a green test that exercised nothing.
const addTo = vi.fn();
const bindPopup = vi.fn();
const bindTooltip = vi.fn();
const polyline = vi.fn((..._a: unknown[]) => ({ addTo }));
const circleMarker = vi.fn((..._a: unknown[]) => ({ addTo, bindPopup, bindTooltip }));
const tileLayer = vi.fn((..._a: unknown[]) => ({ addTo }));
const unproject = vi.fn((p: [number, number]) => ({ lat: p[1], lng: p[0] }));
// See the note in track-map.test.tsx: the place-label pass needs getZoom/on/createPane, and
// a double missing any of them degrades the whole component to its error state.
const marker = vi.fn((..._a: unknown[]) => ({ addTo }));
const divIcon = vi.fn((o: unknown) => o);
const zoomHandlers: Array<() => void> = [];
let currentZoom = 0;
const mapObj = {
  unproject, fitBounds: vi.fn(), setView: vi.fn(), remove: vi.fn(),
  // FriendsMap drives MapCanvas's focus/onCenterChange props, so the double needs the view
  // API too — without it the centre-report rAF throws as an UNHANDLED error, which vitest
  // reports separately from the assertions and leaves every test in this file green.
  flyTo: vi.fn(),
  project: vi.fn((_l: unknown, _z: number) => ({ x: 8192, y: 8192 })),
  getCenter: vi.fn(() => ({ lat: -128, lng: 128 })),
  getZoom: () => currentZoom,
  // The world-bounds pass (map-canvas.tsx) runs on every map, so these belong in every
  // double — a missing one throws inside the load promise and degrades the whole component
  // to its error state, which reads as an unrelated failure.
  setMinZoom: vi.fn(),
  setMaxBounds: vi.fn(),
  getBoundsZoom: vi.fn(() => 1),

  on: (evt: string, fn: () => void) => { if (evt === "zoomend") zoomHandlers.push(fn); },
  createPane: vi.fn(() => document.createElement("div")),
};
const mapFn = vi.fn((..._a: unknown[]) => mapObj);
interface LayerGroupObj { addTo: () => LayerGroupObj; clearLayers: () => void }
const layerGroupObj: LayerGroupObj = { addTo: () => layerGroupObj, clearLayers: vi.fn() };

vi.mock("leaflet", () => ({
  default: {
    CRS: { Simple: "SIMPLE" },
    map: (...a: unknown[]) => mapFn(...a),
    tileLayer: (...a: unknown[]) => tileLayer(...a),
    polyline: (...a: unknown[]) => polyline(...a),
    circleMarker: (...a: unknown[]) => circleMarker(...a),
    marker: (...a: unknown[]) => marker(...a),
    divIcon: (o: unknown) => divIcon(o),
    latLng: (lat: number, lng: number) => ({ lat, lng }),
    layerGroup: () => layerGroupObj,
    latLngBounds: (v: unknown) => v,
  },
}));

const data: FriendMap = {
  mapCodename: "chernarusplus",
  positions: [
    { gamertag: "You", x: 1000, y: 1000, recordedAt: "2026-07-22T11:59:00Z", self: true },
    { gamertag: "Mate", x: 5000, y: 5000, recordedAt: "2026-07-22T11:50:00Z", self: false },
  ],
};
const NOW = new Date("2026-07-22T12:00:00Z");

beforeEach(() => { vi.clearAllMocks(); zoomHandlers.length = 0; currentZoom = 0; });

describe("FriendsMap drawing", () => {
  it("draws one dot for the viewer and one per sharing friend", async () => {
    render(<FriendsMap data={data} now={NOW} />);
    await waitFor(() => expect(circleMarker).toHaveBeenCalledTimes(2));
  });

  it("never draws a trail — last known position only", async () => {
    // A route trail shows direction, pace and habitual locations, i.e. an interception tool
    // (F2 spec §4). This map is dots, full stop.
    render(<FriendsMap data={data} now={NOW} />);
    await waitFor(() => expect(circleMarker).toHaveBeenCalled());
    expect(polyline).not.toHaveBeenCalled();
  });

  it("labels every dot with its gamertag, permanently", async () => {
    // A dot with no callsign is unreadable on a squad map, and a click-to-reveal popup
    // defeats the point of showing friends at a glance.
    render(<FriendsMap data={data} now={NOW} />);
    await waitFor(() => expect(bindTooltip).toHaveBeenCalledTimes(2));
    const labels = bindTooltip.mock.calls.map((c) => c[0] as string);
    expect(labels).toEqual(["You (you)", "Mate"]);
    for (const call of bindTooltip.mock.calls) {
      expect((call[1] as { permanent?: boolean }).permanent).toBe(true);
    }
  });

  it("labels places under the dots, in a dedicated low pane", async () => {
    // Leaflet puts markers at z-index 600 and our dots at 400, so without an explicit pane
    // a town name paints OVER the friend it is meant to help you find.
    render(<FriendsMap data={data} now={NOW} />);
    await waitFor(() => expect(marker).toHaveBeenCalled());
    expect(mapObj.createPane).toHaveBeenCalledWith("places");
    for (const call of marker.mock.calls) {
      const opts = call[1] as { pane?: string; interactive?: boolean };
      expect(opts.pane).toBe("places");
      expect(opts.interactive).toBe(false); // must not swallow a click meant for a dot
    }
  });

  it("adds more place labels as the reader zooms in", async () => {
    render(<FriendsMap data={data} now={NOW} />);
    await waitFor(() => expect(marker).toHaveBeenCalled());
    const wide = marker.mock.calls.length;

    currentZoom = 4;
    for (const fn of zoomHandlers) fn();
    expect(marker.mock.calls.length - wide).toBeGreaterThan(wide);
  });

  it("wraps each label in a chip span, with the name escaped", async () => {
    // The span is load-bearing, not decoration: `iconSize: [0,0]` puts an inline
    // `width: 0; height: 0` on the ROOT, so a background there paints a dash and the text
    // overflows it unbacked — the v0.38.1 bug. The visible box must be an inner element.
    // The name itself still has to be escaped, since divIcon takes raw markup.
    render(<FriendsMap data={data} now={NOW} />);
    await waitFor(() => expect(divIcon).toHaveBeenCalled());
    for (const call of divIcon.mock.calls) {
      const { html } = call[0] as { html: string };
      expect(html).toMatch(/^<span class="map-place-chip">[^<>]*<\/span>$/);
    }
  });

  it("fills its container rather than a fixed-height panel", async () => {
    const { container } = render(<FriendsMap data={data} now={NOW} />);
    await waitFor(() => expect(mapFn).toHaveBeenCalled());
    const canvas = container.querySelector(".isolate")!;
    expect(canvas.className).toContain("h-full");
    expect(canvas.className).not.toContain("h-[420px]");
  });
});
