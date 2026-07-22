import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import TrackMap from "./track-map";
import type { LifeTrack } from "@/lib/types";

// jsdom has no layout, so real Leaflet cannot initialise. The mock must cover EVERY
// symbol the component touches — a partial mock throws inside the effect's promise as an
// unhandled rejection, which can leave the test green while exercising nothing.
const addTo = vi.fn();
const bindPopup = vi.fn();
const polyline = vi.fn((..._a: unknown[]) => ({ addTo }));
const circleMarker = vi.fn((..._a: unknown[]) => ({ addTo, bindPopup }));
const tileLayer = vi.fn((..._a: unknown[]) => ({ addTo }));
const fitBounds = vi.fn();
const setView = vi.fn();
const removeMap = vi.fn();
const clearLayers = vi.fn();
const unproject = vi.fn((p: [number, number]) => ({ lat: p[1], lng: p[0] }));
const mapFn = vi.fn((..._a: unknown[]) => ({ unproject, fitBounds, setView, remove: removeMap }));
// Every `L.map(...)` call gets its own layer group instance recording its own
// `clearLayers` calls, so a test can assert redraw-without-recreate (a NEW track object
// clears+redraws the SAME map's layer group rather than a fresh `L.map(...)` call).
interface LayerGroupObj { addTo: () => LayerGroupObj; clearLayers: typeof clearLayers }
const layerGroupObj: LayerGroupObj = { addTo: () => layerGroupObj, clearLayers };
const layerGroup = vi.fn((..._a: unknown[]) => layerGroupObj);

vi.mock("leaflet", () => ({
  default: {
    CRS: { Simple: "SIMPLE" },
    map: (...a: unknown[]) => mapFn(...a),
    tileLayer: (...a: unknown[]) => tileLayer(...a),
    polyline: (...a: unknown[]) => polyline(...a),
    circleMarker: (...a: unknown[]) => circleMarker(...a),
    layerGroup: (...a: unknown[]) => layerGroup(...a),
    latLngBounds: (v: unknown) => v,
  },
}));

const track: LifeTrack = {
  mapCodename: "chernarusplus",
  segments: [
    { sessionId: 1, points: [{ x: 1000, y: 1000, at: "2026-07-14T00:05:00Z" }, { x: 2000, y: 2000, at: "2026-07-14T00:25:00Z" }] },
    { sessionId: 2, points: [{ x: 5000, y: 5000, at: "2026-07-14T01:05:00Z" }, { x: 6000, y: 6000, at: "2026-07-14T01:59:00Z" }] },
  ],
  markers: [
    { kind: "death", at: "2026-07-14T02:00:00Z", x: 6000, y: 6000, sampleAt: "2026-07-14T01:59:00Z", sampleAgeSeconds: 60, label: null },
  ],
  sampleCount: 4,
  truncated: false,
  alive: false,
};

beforeEach(() => { vi.clearAllMocks(); });

describe("TrackMap", () => {
  it("cages Leaflet in its own stacking context", () => {
    // Leaflet puts its controls at z-index 1000, which would paint over the z-40 masthead
    // and the z-50 controls sheet. `isolate` confines every Leaflet z-index to this box.
    // jsdom cannot observe paint order, so this pins the mechanism instead.
    const { container } = render(<TrackMap track={track} />);
    expect(container.querySelector(".isolate")).not.toBeNull();
  });

  it("draws ONE polyline per session — never one line joining them", async () => {
    // A single polyline across both sessions would draw a straight line over a
    // logout/login the player never walked. Spec §4.1.
    render(<TrackMap track={track} />);
    await waitFor(() => expect(polyline).toHaveBeenCalledTimes(2));
  });

  it("draws one circleMarker per marker", async () => {
    render(<TrackMap track={track} />);
    await waitFor(() => expect(circleMarker).toHaveBeenCalledTimes(1));
  });

  it("requests tiles from the mirrored DZMap layout for this map", async () => {
    render(<TrackMap track={track} />);
    await waitFor(() => expect(tileLayer).toHaveBeenCalled());
    expect(tileLayer.mock.calls[0]![0]).toBe("/tiles/chernarusplus/topographic/{z}/{x}/{y}.webp");
    // Absent tiles (dev, or before the mirror has run) must degrade to trail-on-a-dark-
    // background via errorTileUrl, not a broken-tile checkerboard — and must not wrap.
    const opts = tileLayer.mock.calls[0]![1] as { errorTileUrl?: string; noWrap?: boolean };
    expect(opts.errorTileUrl).toEqual(expect.any(String));
    expect(opts.errorTileUrl!.length).toBeGreaterThan(0);
    expect(opts.noWrap).toBe(true);
  });

  it("keeps a single-point session from becoming a zero-length polyline", async () => {
    const one = { ...track, segments: [{ sessionId: 1, points: [{ x: 1, y: 1, at: "2026-07-14T00:05:00Z" }] }], markers: [] };
    render(<TrackMap track={one} />);
    await waitFor(() => expect(unproject).toHaveBeenCalled());
    expect(polyline).not.toHaveBeenCalled();
  });

  it("popup text agrees with the accessible list — never a lying '0s' for a now marker", async () => {
    // A `now` marker's sampleAgeSeconds is 0 by construction (the fix IS the event). The
    // popup must route through the same clock-derived `staleness` helper as
    // TrackMarkerList, not render sampleAgeSeconds directly, or a living player's popup
    // would falsely claim their position is current.
    const nowTrack: LifeTrack = {
      ...track,
      markers: [
        { kind: "now", at: "2026-07-14T03:00:00Z", x: 7000, y: 7000, sampleAt: "2026-07-14T02:55:00Z", sampleAgeSeconds: 0, label: null },
      ],
    };
    render(<TrackMap track={nowTrack} />);
    await waitFor(() => expect(bindPopup).toHaveBeenCalled());
    const text = bindPopup.mock.calls[0]![0] as string;
    expect(text).not.toContain("0s");
    expect(text).toMatch(/\d+[ms] ago/);
  });

  it("renders an explicit notice for a map codename we have no world size for", () => {
    render(<TrackMap track={{ ...track, mapCodename: "banov" }} />);
    expect(screen.getByText(/unmapped terrain/i)).toBeInTheDocument();
    expect(tileLayer).not.toHaveBeenCalled();
  });

  it("passes the vendored upstream attribution string and enables the attribution control", async () => {
    render(<TrackMap track={track} />);
    await waitFor(() => expect(tileLayer).toHaveBeenCalled());
    const opts = tileLayer.mock.calls[0]![1] as { attribution?: string };
    expect(opts.attribution).toContain("Xam.nu");
    const mapOpts = mapFn.mock.calls[0]![1] as { attributionControl?: boolean };
    expect(mapOpts.attributionControl).toBe(true);
  });

  it("does NOT recreate the map on a re-render with a new track object — only redraws layers", async () => {
    // The bug: the effect depended on [track, size], and react-query hands back a fresh
    // object every 60s poll, so cleanup called map.remove() and the whole map
    // re-initialised — snapping fitBounds back and closing any open popup, forever,
    // with zero user input. `L.map(...)` must be called exactly once across a track
    // update; only the layer group should clear and redraw.
    const { rerender } = render(<TrackMap track={track} />);
    await waitFor(() => expect(mapFn).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(polyline).toHaveBeenCalledTimes(2));

    const newTrack: LifeTrack = { ...track, segments: [...track.segments] };
    rerender(<TrackMap track={newTrack} />);

    await waitFor(() => expect(clearLayers).toHaveBeenCalled());
    expect(mapFn).toHaveBeenCalledTimes(1);
    expect(removeMap).not.toHaveBeenCalled();
    // Layers were redrawn (polyline called again for the new track), not just left as-is.
    expect(polyline.mock.calls.length).toBeGreaterThan(2);
  });

  it("surfaces an explicit status line when the Leaflet chunk fails to load, instead of a blank box", async () => {
    mapFn.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    render(<TrackMap track={track} />);
    expect(await screen.findByRole("status")).toHaveTextContent(/couldn't load the map/i);
  });
});
