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
const setMinZoom = vi.fn();
const setMaxBounds = vi.fn();
let boundsZoom = 2;
const getBoundsZoom = vi.fn((_b: unknown, _inside?: boolean) => boundsZoom);
/** Call order across the double, for assertions about sequencing. */
const calls: string[] = [];
const mapFn = vi.fn((_el: unknown, _opts: Record<string, unknown>) => mapObj);
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
  setMinZoom: (z: number) => { calls.push(`setMinZoom:${z}`); setMinZoom(z); },
  setMaxBounds,
  getBoundsZoom: (b: unknown, inside?: boolean) => { calls.push("getBoundsZoom"); return getBoundsZoom(b, inside); },
  remove: vi.fn(),
  on: (evt: string, fn: () => void) => {
    (handlers[evt] ??= []).push(fn);
  },
  createPane: vi.fn(() => document.createElement("div")),
};
vi.mock("leaflet", () => ({
  default: {
    CRS: { Simple: "SIMPLE" },
    map: (el: unknown, opts: Record<string, unknown>) => mapFn(el, opts),
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

/** Pending frame callbacks, drained by `flushFrame()`. */
const frames: FrameRequestCallback[] = [];
const cancelled: number[] = [];
function flushFrame() {
  const pending = frames.splice(0, frames.length);
  for (const cb of pending) cb(0);
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(handlers)) delete handlers[k];
  // A MANUAL frame queue, not a synchronous stub. Running the callback inline means one call
  // is always one frame, so the coalescing branch can never be entered and a cleanup that
  // forgot cancelAnimationFrame would still pass — the two behaviours the rAF layer exists for.
  frames.length = 0;
  cancelled.length = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length; // 1-based handle
  });
  vi.stubGlobal("cancelAnimationFrame", (h: number) => { cancelled.push(h); });
  boundsZoom = 2;
  calls.length = 0;
});

describe("MapCanvas world bounds", () => {
  it("floors the zoom where the world stops covering the viewport", async () => {
    // Zooming out past this shows blank space around the map — see the Livonia screenshot in
    // v0.39.0. `inside: true` asks Leaflet for the lowest zoom at which the VIEW still fits
    // inside the world, which is exactly the no-blank-space floor.
    render(<MapCanvas mapCodename="chernarusplus" draw={draw} drawKey={1} />);
    await waitFor(() => expect(setMinZoom).toHaveBeenCalledWith(2));
    expect(getBoundsZoom.mock.calls[0]![1]).toBe(true);
  });

  it("pens the viewer inside the map's own extent", async () => {
    render(<MapCanvas mapCodename="chernarusplus" draw={draw} drawKey={1} />);
    await waitFor(() => expect(setMaxBounds).toHaveBeenCalledTimes(1));
  });

  it("recomputes the floor when the viewport changes", async () => {
    // A phone rotating, or a desktop window widening, changes which zoom covers the view; a
    // floor computed once leaves blank space at the new size.
    render(<MapCanvas mapCodename="chernarusplus" draw={draw} drawKey={1} />);
    // Not a call COUNT: each pass also resets the floor to 0 before measuring, so counting
    // calls measures the reset rather than the floor.
    await waitFor(() => expect(setMinZoom).toHaveBeenLastCalledWith(2));
    boundsZoom = 3;
    handlers.resize![0]!();
    expect(setMinZoom).toHaveBeenLastCalledWith(3);
  });

  it("allows a fractional floor, so it stops exactly where grey would start", async () => {
    // Leaflet's getBoundsZoom rounds an `inside` result UP to the next whole level
    // (`Math.ceil(zoom / snap) * snap`, and zoomSnap defaults to 1), so the floor lands up to
    // a full step short of the real edge — the map refuses to zoom out while the terrain
    // still covers the view. zoomSnap: 0 disables the rounding entirely.
    render(<MapCanvas mapCodename="chernarusplus" draw={draw} drawKey={1} />);
    await waitFor(() => expect(mapFn).toHaveBeenCalled());
    expect(mapFn.mock.calls[0]![1]).toMatchObject({ zoomSnap: 0 });
  });

  it("re-measures from a clean floor, so a shrinking viewport can zoom out again", async () => {
    // getBoundsZoom returns `Math.max(currentMinZoom, ...)`, so a floor raised once becomes a
    // latch: narrow the window afterwards and the map stays clamped at the wider view's floor,
    // unable to zoom out to its own edge. Reset to 0 before measuring.
    render(<MapCanvas mapCodename="chernarusplus" draw={draw} drawKey={1} />);
    await waitFor(() => expect(calls).toContain("getBoundsZoom"));
    // Assert PRESENCE before order: indexOf returns -1 when absent, which is trivially less
    // than any real index, so an order-only assertion passes when the reset does not happen.
    expect(calls).toContain("setMinZoom:0");
    expect(calls.indexOf("setMinZoom:0")).toBeLessThan(calls.indexOf("getBoundsZoom"));
  });

  it("ignores a nonsense floor rather than locking the map at it", async () => {
    // A container Leaflet measures as zero-sized yields Infinity. Setting that as minZoom
    // makes the map unusable — every gesture clamps to a zoom whose tiles do not exist.
    boundsZoom = Infinity;
    render(<MapCanvas mapCodename="chernarusplus" draw={draw} drawKey={1} />);
    await waitFor(() => expect(setMaxBounds).toHaveBeenCalled());
    // The pre-measurement reset to 0 is fine and expected; what must never be applied is the
    // nonsense value itself.
    expect(setMinZoom).not.toHaveBeenCalledWith(Infinity);
    expect(setMinZoom.mock.calls.every(([z]) => Number.isFinite(z))).toBe(true);
  });

  it("opens on the whole world, not a hardcoded zoom", async () => {
    // The default view used to be setView(centre, 1), which on Livonia (a 12800m world) left
    // the map a small square adrift in grey.
    render(<MapCanvas mapCodename="chernarusplus" draw={draw} drawKey={1} />);
    await waitFor(() => expect(fitBounds).toHaveBeenCalled());
    expect(setView).not.toHaveBeenCalled();
  });
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
    await waitFor(() => expect(frames.length).toBeGreaterThan(0));
    flushFrame();
    // project() returns pixel (8192, 4096) on a 16384 canvas over a 15360m map:
    // x = 8192/16384*15360 = 7680; y = 15360 - 4096/16384*15360 = 11520.
    expect(onCenterChange).toHaveBeenLastCalledWith({ x: 7680, y: 11520 });
  });

  it("subscribes to move, and coalesces a burst of them into ONE frame", async () => {
    // Leaflet fires `move` many times per drag frame and the consumer re-renders a text chip
    // on every call. Without the rafRef guard this queues a frame per event.
    const onCenterChange = vi.fn();
    render(
      <MapCanvas mapCodename="chernarusplus" draw={draw} drawKey={1} onCenterChange={onCenterChange} />,
    );
    await waitFor(() => expect(handlers.move?.length).toBe(1));
    flushFrame(); // the initial report made at map creation
    onCenterChange.mockClear();
    for (let i = 0; i < 5; i++) handlers.move![0]!();
    expect(frames.length).toBe(1);
    flushFrame();
    expect(onCenterChange).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending frame on teardown", async () => {
    // Otherwise the callback runs against a removed map after unmount.
    const { unmount } = render(
      <MapCanvas mapCodename="chernarusplus" draw={draw} drawKey={1} onCenterChange={vi.fn()} />,
    );
    await waitFor(() => expect(frames.length).toBeGreaterThan(0));
    unmount();
    expect(cancelled.length).toBeGreaterThan(0);
  });
});
