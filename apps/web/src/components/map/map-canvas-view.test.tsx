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
/** Container size Leaflet reports. The zoom floor is derived from it. */
let mapSize = { x: 1024, y: 512 };
const getSize = vi.fn(() => mapSize);
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
  getSize: () => { calls.push("getSize"); return getSize(); },
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
  mapSize = { x: 1024, y: 512 };
  calls.length = 0;
});

describe("MapCanvas world bounds", () => {
  it("floors the zoom where the world stops covering the viewport", async () => {
    // Zooming out past this shows blank space around the map — see the Livonia screenshot in
    // v0.39.0. The pyramid is one 256px tile at zoom 0, so the world spans 256 * 2**z px;
    // a 1024px-wide container is covered from log2(1024 / 256) = 2.
    render(<MapCanvas mapCodename="chernarusplus" draw={draw} drawKey={1} />);
    await waitFor(() => expect(setMinZoom).toHaveBeenCalledWith(2));
  });

  it("measures the LONGER side, so neither dimension can show grey", async () => {
    // A tall phone in portrait: height drives the floor, not width.
    mapSize = { x: 256, y: 1024 };
    render(<MapCanvas mapCodename="chernarusplus" draw={draw} drawKey={1} />);
    await waitFor(() => expect(setMinZoom).toHaveBeenCalledWith(2));
  });

  it("pens the viewer inside the map's own extent", async () => {
    render(<MapCanvas mapCodename="chernarusplus" draw={draw} drawKey={1} />);
    await waitFor(() => expect(setMaxBounds).toHaveBeenCalledTimes(1));
  });

  it("recomputes the floor when the viewport changes", async () => {
    // A phone rotating, or a desktop window widening, changes which zoom covers the view; a
    // floor computed once leaves blank space at the new size.
    render(<MapCanvas mapCodename="chernarusplus" draw={draw} drawKey={1} />);
    await waitFor(() => expect(setMinZoom).toHaveBeenLastCalledWith(2));
    mapSize = { x: 2048, y: 1024 };
    handlers.resize![0]!();
    expect(setMinZoom).toHaveBeenLastCalledWith(3);
  });

  it("puts the floor ON a snap point, so zooming out can actually reach it", async () => {
    // ⚠️ THE v0.41.2 BUG. Leaflet applies `_limitZoom` TWICE on the way to a new view: it
    // rounds to the snap and clamps to min, then does it again. A floor BETWEEN snap points
    // survives the first pass and is rounded away by the second, bouncing the map back to the
    // level above — zoom-out becomes a silent no-op with the control still enabled. Verified
    // live on Livonia at 1502x1517: exact floor 2.567, map stuck at 3.
    mapSize = { x: 1502, y: 1517 };
    render(<MapCanvas mapCodename="chernarusplus" draw={draw} drawKey={1} />);
    await waitFor(() => expect(setMinZoom).toHaveBeenCalled());
    const floor = setMinZoom.mock.calls.at(-1)![0] as number;
    // The exact edge is 2.567; the reachable floor is the next quarter step above it.
    expect(Math.log2(1517 / 256)).toBeCloseTo(2.567, 3);
    expect(floor).toBeCloseTo(2.75, 6);
    // Still well inside the whole step the old getBoundsZoom floor would have cost.
    expect(floor).toBeLessThan(3);
  });

  it("never floors BELOW the world-covering zoom — grey must not come back", async () => {
    // Rounding the exact floor DOWN to a snap point would let the world stop covering the
    // viewport, which is the original Livonia-adrift-in-grey report.
    for (const size of [{ x: 1502, y: 1517 }, { x: 700, y: 400 }, { x: 1024, y: 512 }]) {
      setMinZoom.mockClear();
      mapSize = size;
      const { unmount } = render(<MapCanvas mapCodename="chernarusplus" draw={draw} drawKey={1} />);
      await waitFor(() => expect(setMinZoom).toHaveBeenCalled());
      const floor = setMinZoom.mock.calls.at(-1)![0] as number;
      expect(floor).toBeGreaterThanOrEqual(Math.log2(Math.max(size.x, size.y) / 256));
      unmount();
    }
  });

  it("keeps the wheel stepping — never zoomSnap: 0", async () => {
    // `zoomSnap: 0` (v0.39.2) makes wheel zoom continuous: every notch rescales tiles rather
    // than stepping between rendered levels, reported as slow and choppy. A quarter step still
    // moves a whole level per notch, because _performZoom takes ceil(d2 / snap) * snap.
    render(<MapCanvas mapCodename="chernarusplus" draw={draw} drawKey={1} />);
    await waitFor(() => expect(mapFn).toHaveBeenCalled());
    expect((mapFn.mock.calls[0]![1] as Record<string, unknown>).zoomSnap).toBe(0.25);
  });

  it("lets a shrinking viewport zoom out further — the floor never latches", async () => {
    // getBoundsZoom returned `Math.max(currentMinZoom, ...)`, so a floor raised once could
    // never be measured lower: widen the window, narrow it, and the map stayed clamped at the
    // wider view's floor. Deriving the floor from the container size cannot latch.
    render(<MapCanvas mapCodename="chernarusplus" draw={draw} drawKey={1} />);
    await waitFor(() => expect(setMinZoom).toHaveBeenCalledWith(2));
    mapSize = { x: 512, y: 256 };
    handlers.resize![0]!();
    expect(setMinZoom).toHaveBeenLastCalledWith(1);
    // 1024 and 512 are exact powers of two, so the snap rounding is a no-op on both — the
    // point of this test is the direction of travel, not the rounding.
  });

  it("ignores a nonsense floor rather than locking the map at it", async () => {
    // A container Leaflet measures as zero-sized yields Infinity. Setting that as minZoom
    // makes the map unusable — every gesture clamps to a zoom whose tiles do not exist.
    // A container Leaflet measures as zero-sized gives log2(0) = -Infinity.
    mapSize = { x: 0, y: 0 };
    render(<MapCanvas mapCodename="chernarusplus" draw={draw} drawKey={1} />);
    await waitFor(() => expect(setMaxBounds).toHaveBeenCalled());
    expect(setMinZoom).not.toHaveBeenCalled();
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
