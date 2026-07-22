import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import MapCanvas from "./map-canvas";

// Same shape as track-map.test.tsx / friends-map-draw.test.tsx: jsdom has no layout, so real
// Leaflet cannot initialise and EVERY symbol the component touches must be doubled — a partial
// mock throws inside the effect's promise as an unhandled rejection, leaving a green test that
// exercised nothing.
const addTo = vi.fn();
const flyTo = vi.fn();
const setView = vi.fn();
const fitBounds = vi.fn();
const project = vi.fn((_l: unknown, _z: number) => ({ x: 8192, y: 4096 }));
const getCenter = vi.fn(() => ({ lat: -64, lng: 128 }));
const handlers: Record<string, Array<() => void>> = {};
const mapObj = {
  unproject: (p: [number, number]) => ({ lat: p[1], lng: p[0] }),
  fitBounds,
  setView,
  flyTo,
  project,
  getCenter,
  getZoom: () => 3,
  remove: vi.fn(),
  on: (evt: string, fn: () => void) => {
    (handlers[evt] ??= []).push(fn);
  },
  createPane: vi.fn(() => document.createElement("div")),
};
vi.mock("leaflet", () => ({
  default: {
    CRS: { Simple: "SIMPLE" },
    map: () => mapObj,
    tileLayer: () => ({ addTo }),
    polyline: () => ({ addTo }),
    circleMarker: () => ({ addTo, bindPopup: vi.fn(), bindTooltip: vi.fn() }),
    marker: () => ({ addTo }),
    divIcon: (o: unknown) => o,
    latLng: (lat: number, lng: number) => ({ lat, lng }),
    layerGroup: () => {
      const g = { addTo: () => g, clearLayers: vi.fn() };
      return g;
    },
    latLngBounds: (v: unknown) => v,
  },
}));

const draw = () => [];

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(handlers)) delete handlers[k];
  // rAF is what throttles centre reporting; jsdom has it, but run it synchronously so a test
  // never has to guess how long a frame takes.
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

describe("MapCanvas focus", () => {
  it("flies to a focus target", async () => {
    render(
      <MapCanvas
        mapCodename="chernarusplus"
        draw={draw}
        drawKey={1}
        focus={{ lat: -100, lng: 50, zoom: 5, nonce: 1 }}
      />,
    );
    await waitFor(() => expect(flyTo).toHaveBeenCalledTimes(1));
    expect(flyTo.mock.calls[0]![1]).toBe(5);
  });

  it("flies again when the same place is chosen twice — the nonce is what moves it", async () => {
    const target = { lat: -100, lng: 50, zoom: 5 };
    const { rerender } = render(
      <MapCanvas mapCodename="chernarusplus" draw={draw} drawKey={1} focus={{ ...target, nonce: 1 }} />,
    );
    await waitFor(() => expect(flyTo).toHaveBeenCalledTimes(1));
    rerender(
      <MapCanvas mapCodename="chernarusplus" draw={draw} drawKey={1} focus={{ ...target, nonce: 2 }} />,
    );
    await waitFor(() => expect(flyTo).toHaveBeenCalledTimes(2));
  });

  it("does not fly on an unrelated re-render", async () => {
    const focus = { lat: -100, lng: 50, zoom: 5, nonce: 1 };
    const { rerender } = render(
      <MapCanvas mapCodename="chernarusplus" draw={draw} drawKey={1} focus={focus} />,
    );
    await waitFor(() => expect(flyTo).toHaveBeenCalledTimes(1));
    rerender(<MapCanvas mapCodename="chernarusplus" draw={draw} drawKey={2} focus={focus} />);
    expect(flyTo).toHaveBeenCalledTimes(1);
  });
});

describe("MapCanvas onCenterChange", () => {
  it("reports the centre in world metres, not pixels or latlng", async () => {
    const onCenterChange = vi.fn();
    render(
      <MapCanvas mapCodename="chernarusplus" draw={draw} drawKey={1} onCenterChange={onCenterChange} />,
    );
    await waitFor(() => expect(handlers.move?.length).toBe(1));
    handlers.move![0]!();
    await waitFor(() => expect(onCenterChange).toHaveBeenCalled());
    // project() returns pixel (8192, 4096) on a 16384 canvas over a 15360m map:
    // x = 8192/16384*15360 = 7680; y = 15360 - 4096/16384*15360 = 11520.
    expect(onCenterChange).toHaveBeenLastCalledWith({ x: 7680, y: 11520 });
  });
});
