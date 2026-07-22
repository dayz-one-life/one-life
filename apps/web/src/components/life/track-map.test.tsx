import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import TrackMap from "./track-map";
import type { LifeTrack } from "@/lib/types";

// jsdom has no layout, so real Leaflet cannot initialise. The mock must cover EVERY
// symbol the component touches — a partial mock throws inside the effect's promise as an
// unhandled rejection, which can leave the test green while exercising nothing.
const addTo = vi.fn();
const polyline = vi.fn((..._a: unknown[]) => ({ addTo }));
const circleMarker = vi.fn((..._a: unknown[]) => ({ addTo, bindPopup: vi.fn() }));
const tileLayer = vi.fn((..._a: unknown[]) => ({ addTo }));
const fitBounds = vi.fn();
const setView = vi.fn();
const unproject = vi.fn((p: [number, number]) => ({ lat: p[1], lng: p[0] }));

vi.mock("leaflet", () => ({
  default: {
    CRS: { Simple: "SIMPLE" },
    map: () => ({ unproject, fitBounds, setView, remove: vi.fn() }),
    tileLayer: (...a: unknown[]) => tileLayer(...a),
    polyline: (...a: unknown[]) => polyline(...a),
    circleMarker: (...a: unknown[]) => circleMarker(...a),
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
    expect(tileLayer.mock.calls[0]![0]).toBe("/tiles/chernarusplus/terrain/{z}/{x}/{y}.webp");
  });

  it("keeps a single-point session from becoming a zero-length polyline", async () => {
    const one = { ...track, segments: [{ sessionId: 1, points: [{ x: 1, y: 1, at: "2026-07-14T00:05:00Z" }] }], markers: [] };
    render(<TrackMap track={one} />);
    await waitFor(() => expect(unproject).toHaveBeenCalled());
    expect(polyline).not.toHaveBeenCalled();
  });

  it("renders an explicit notice for a map codename we have no world size for", () => {
    render(<TrackMap track={{ ...track, mapCodename: "banov" }} />);
    expect(screen.getByText(/unmapped terrain/i)).toBeInTheDocument();
    expect(tileLayer).not.toHaveBeenCalled();
  });
});
