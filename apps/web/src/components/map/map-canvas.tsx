"use client";
import { useEffect, useRef, useState } from "react";
import { worldSize, worldToPixel } from "@/lib/dayz-projection";
// Next.js's bundler special-cases global stylesheets imported FROM node_modules: unlike an
// app-authored global .css (which must live in the root layout), a third-party package's CSS
// may be imported directly in the component that needs it and still gets extracted + emitted —
// scoped to this component's chunk rather than loaded on every page. This is that import; do
// not move it to app/layout.tsx (that would load Leaflet's CSS globally) and do not delete it —
// without it Leaflet's panes/tiles/controls have no positioning CSS in a real browser.
import "leaflet/dist/leaflet.css";

/** DZMap's vanilla pyramid tops out at zoom 6 (its loader's --zoom-limit default),
 *  giving a pixel extent of 256 * 2**6 = 16384 at that zoom. This is a DOCUMENTED
 *  ASSUMPTION, NOT YET VERIFIED against real mirrored tiles — deploy/mirror-tiles.sh
 *  had no production host or mirrored tile set available at the time this was written
 *  (see deploy/README.md's "Verify the tile projection" step, which is REQUIRED and
 *  still outstanding). If a life's trail renders uniformly offset or scaled relative
 *  to a known in-game landmark once real tiles are being served, CANVAS_PX (and/or
 *  MAX_ZOOM) is wrong for the mirrored pyramid and this is the constant to correct —
 *  worldToPixel takes canvasPx as a parameter precisely so this stays a one-line fix.
 *  Do NOT touch worldToPixel itself: it is unit-tested and correct by construction. */
const MAX_ZOOM = 6;
const CANVAS_PX = 256 * 2 ** MAX_ZOOM;

// Vendored verbatim from deploy/dzmap.yaml's top-level `attribution:` — the same string
// DZMap's own upstream config attaches to these tiles. Attribution is a real obligation
// here, not decoration (see the CC BY-SA note on character portraits in CLAUDE.md), so
// this renders through Leaflet's own attribution control rather than being suppressed.
const TILE_ATTRIBUTION = '<a href="https://dayz.xam.nu" target="_blank">Tiles © Xam.nu</a>';

// Minimal structural types for the pieces of Leaflet's API this component touches —
// enough to keep the two effects below (map lifecycle vs. layer redraw) honest without
// pulling in `@types/leaflet` for a dynamically-imported module.
export interface LeafletMap {
  unproject: (p: [number, number], zoom: number) => unknown;
  fitBounds: (bounds: unknown, opts?: unknown) => void;
  setView: (center: unknown, zoom: number) => void;
  remove: () => void;
}
export interface LeafletLayer {
  addTo: (target: unknown) => LeafletLayer;
  bindPopup?: (text: string) => void;
  bindTooltip?: (text: string, opts?: Record<string, unknown>) => void;
  clearLayers?: () => void;
}
export interface LeafletModule {
  CRS: { Simple: unknown };
  map: (el: HTMLElement, opts: Record<string, unknown>) => LeafletMap;
  tileLayer: (url: string, opts: Record<string, unknown>) => LeafletLayer;
  polyline: (latlngs: unknown[], opts: Record<string, unknown>) => LeafletLayer;
  circleMarker: (latlng: unknown, opts: Record<string, unknown>) => LeafletLayer;
  layerGroup: () => LeafletLayer;
  latLngBounds: (v: unknown[]) => unknown;
}

export interface DrawContext {
  L: LeafletModule;
  map: LeafletMap;
  group: LeafletLayer;
  /** World metres → a Leaflet latlng on this map's pyramid. */
  pt: (x: number, y: number) => unknown;
}

/** Draws into the supplied group and returns the points the shell should fit on first draw. */
export type DrawFn = (ctx: DrawContext) => unknown[];

/**
 * The Leaflet shell: lifecycle, tiles, projection, first-fit and failure states.
 *
 * Extracted from TrackMap so the life trail and the friends map cannot drift apart on tile
 * paths or projection details. Consumers supply only a `draw` function; everything subtle
 * (map lifecycle vs. redraw split, the first-fit latch, the LayerGroup pattern, the dynamic
 * import, the error/unmapped-terrain states, the stacking context) lives here.
 */
export default function MapCanvas({ mapCodename, draw, drawKey, className }: {
  mapCodename: string;
  draw: DrawFn;
  /** Changes whenever the data to draw changes; drives the redraw effect. */
  drawKey: unknown;
  /** Sizing only — the container's own box. Defaults to the life-trail's fixed panel; the
   *  friends map passes `h-full w-full` to fill a flex parent. Leaflet reads the element's
   *  computed size on creation, so a parent chain with no definite height collapses it to 0. */
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const size = worldSize(mapCodename);
  const [loadError, setLoadError] = useState(false);

  // Kept live so the async import callback (which closes over the draw fn current when the
  // creation effect FIRST ran) draws up-to-date layers once Leaflet resolves.
  const drawRef = useRef(draw);
  drawRef.current = draw;

  const leafletRef = useRef<LeafletModule | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerGroupRef = useRef<LeafletLayer | null>(null);
  const hasFitRef = useRef(false);

  function runDraw() {
    const L = leafletRef.current;
    const m = mapRef.current;
    if (!L || !m || size === null) return;

    // The SAME LayerGroup, cleared and rebuilt, rather than diffed — keeps what's on the map
    // in lockstep with the data, with no stale layer and no ever-growing layer count.
    if (layerGroupRef.current) {
      layerGroupRef.current.clearLayers?.();
    } else {
      // Created and added as two separate calls, NOT `L.layerGroup().addTo(m)`. Real Leaflet's
      // addTo() returns `this`, but relying on that return means a double whose addTo() returns
      // undefined creates a NEW LayerGroup every poll forever, since the ref stays null and the
      // clearLayers() branch is never taken — the unbounded-layer leak this split removed.
      const group = L.layerGroup();
      group.addTo(m);
      layerGroupRef.current = group;
    }

    const pt = (x: number, y: number) => m.unproject(worldToPixel(x, y, size, CANVAS_PX), MAX_ZOOM);
    const fitPoints = drawRef.current({ L, map: m, group: layerGroupRef.current, pt });

    // fitBounds only on the FIRST draw: a live poll must never snap the view out from under
    // someone who has zoomed in and opened a popup.
    if (!hasFitRef.current) {
      if (fitPoints.length > 0) {
        m.fitBounds(L.latLngBounds(fitPoints), { padding: [24, 24] });
        // Only latched on a REAL first draw. Latching on an empty draw would leave a map that
        // never fits once data arrives on a later poll.
        hasFitRef.current = true;
      } else {
        m.setView(pt(size / 2, size / 2), 1);
      }
    }
  }

  // Effect 1: create the map. Keyed ONLY on `size` — not on the data, whose identity changes
  // every poll. Re-running this per poll destroyed and rebuilt the map, snapping the view and
  // closing popups with no user input.
  useEffect(() => {
    // Reset BEFORE the early-return guard: a `size` change while in the error state (e.g.
    // the mapCodename changing to one this component has no world size for) must clear the
    // stale error rather than latch it — the `size === null` branch below renders its own
    // honest "Unmapped terrain" message, and the error line must not persist alongside or
    // instead of it.
    setLoadError(false);
    if (!ref.current || size === null) return;
    let cancelled = false;
    hasFitRef.current = false;

    // Dynamically imported so Leaflet never enters the server bundle and never runs during
    // SSR — the page must stay coordinate-free on the server.
    void import("leaflet")
      .then((mod) => {
        if (cancelled || !ref.current) return;
        const L = mod.default as unknown as LeafletModule;
        leafletRef.current = L;
        const m = L.map(ref.current, {
          crs: L.CRS.Simple, minZoom: 0, maxZoom: MAX_ZOOM, attributionControl: true,
        });
        mapRef.current = m;

        // errorTileUrl blank + a dark backdrop on the container: when tiles are absent
        // (dev, or before the mirror has run) the drawn layers still read, instead of showing
        // a broken-tile checkerboard that looks like a broken feature.
        L.tileLayer(`/tiles/${mapCodename}/topographic/{z}/{x}/{y}.webp`, {
          minZoom: 0, maxZoom: MAX_ZOOM, noWrap: true,
          errorTileUrl: "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==",
          attribution: TILE_ATTRIBUTION,
        }).addTo(m);
        runDraw();
      })
      .catch(() => {
        // A chunk 404 (realistic mid-deploy) or any other load failure must surface honestly,
        // not degrade to a silently blank dark box.
        if (!cancelled) setLoadError(true);
      });

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      layerGroupRef.current = null;
      leafletRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, mapCodename]);

  // Effect 2: redraw when the data changes. A no-op until the creation effect has resolved.
  useEffect(() => {
    runDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawKey]);

  if (size === null) {
    return (
      <p className="border border-hairline bg-bone px-4 py-3 font-mono text-[11px] text-ink-soft">
        Unmapped terrain — the desk has no chart for this server.
      </p>
    );
  }
  if (loadError) {
    return (
      <p role="status" className="border border-hairline bg-bone px-4 py-3 font-mono text-[11px] text-red-deep">
        Couldn&apos;t load the map.
      </p>
    );
  }

  // `isolate` is load-bearing, not cosmetic. See the LAYER LEGEND at the <header> in
  // header.tsx: the app has exactly three z-altitudes (content, z-40 masthead, z-50
  // overlays). Leaflet assigns its panes 200-700 and its controls 1000, absolutely
  // positioned — without a stacking context here it paints straight over the masthead,
  // the notification popover and the ControlsSheet.
  return (
    <div
      ref={ref}
      className={`isolate border border-ink bg-dark-well ${className ?? "h-[420px] w-full"}`}
    />
  );
}
