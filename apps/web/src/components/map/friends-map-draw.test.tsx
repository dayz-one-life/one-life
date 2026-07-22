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
const mapFn = vi.fn((..._a: unknown[]) => ({
  unproject, fitBounds: vi.fn(), setView: vi.fn(), remove: vi.fn(),
}));
interface LayerGroupObj { addTo: () => LayerGroupObj; clearLayers: () => void }
const layerGroupObj: LayerGroupObj = { addTo: () => layerGroupObj, clearLayers: vi.fn() };

vi.mock("leaflet", () => ({
  default: {
    CRS: { Simple: "SIMPLE" },
    map: (...a: unknown[]) => mapFn(...a),
    tileLayer: (...a: unknown[]) => tileLayer(...a),
    polyline: (...a: unknown[]) => polyline(...a),
    circleMarker: (...a: unknown[]) => circleMarker(...a),
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

beforeEach(() => { vi.clearAllMocks(); });

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

  it("fills its container rather than a fixed-height panel", async () => {
    const { container } = render(<FriendsMap data={data} now={NOW} />);
    await waitFor(() => expect(mapFn).toHaveBeenCalled());
    const canvas = container.querySelector(".isolate")!;
    expect(canvas.className).toContain("h-full");
    expect(canvas.className).not.toContain("h-[420px]");
  });
});
