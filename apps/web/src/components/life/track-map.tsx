"use client";
import { useEffect, useRef, useState } from "react";
import { worldSize, worldToPixel } from "@/lib/dayz-projection";
import type { LifeTrack } from "@/lib/types";
import { staleness } from "./track-marker-list";
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

const MARKER_COLOR: Record<LifeTrack["markers"][number]["kind"], string> = {
  kill: "#c8102e",
  death: "#1b1b1b",
  now: "#2563eb",
};

// Minimal structural types for the pieces of Leaflet's API this component touches —
// enough to keep the two effects below (map lifecycle vs. layer redraw) honest without
// pulling in `@types/leaflet` for a dynamically-imported module.
interface LeafletMap {
  unproject: (p: [number, number], zoom: number) => unknown;
  fitBounds: (bounds: unknown, opts?: unknown) => void;
  setView: (center: unknown, zoom: number) => void;
  remove: () => void;
}
interface LeafletLayer {
  addTo: (target: unknown) => LeafletLayer;
  bindPopup?: (text: string) => void;
  clearLayers?: () => void;
}
interface LeafletModule {
  CRS: { Simple: unknown };
  map: (el: HTMLElement, opts: Record<string, unknown>) => LeafletMap;
  tileLayer: (url: string, opts: Record<string, unknown>) => LeafletLayer;
  polyline: (latlngs: unknown[], opts: Record<string, unknown>) => LeafletLayer;
  circleMarker: (latlng: unknown, opts: Record<string, unknown>) => LeafletLayer;
  layerGroup: () => LeafletLayer;
  latLngBounds: (v: unknown[]) => unknown;
}

export default function TrackMap({ track }: { track: LifeTrack }) {
  const ref = useRef<HTMLDivElement>(null);
  const size = worldSize(track.mapCodename);
  const [loadError, setLoadError] = useState(false);

  // Kept live across renders so the async `import("leaflet").then(...)` callback (which
  // closes over whatever `track` was current when the map-creation effect FIRST ran) can
  // still draw the up-to-date layers once Leaflet actually resolves.
  const trackRef = useRef(track);
  trackRef.current = track;

  const leafletRef = useRef<LeafletModule | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerGroupRef = useRef<LeafletLayer | null>(null);
  const hasFitRef = useRef(false);

  function drawLayers(t: LifeTrack) {
    const L = leafletRef.current;
    const m = mapRef.current;
    if (!L || !m || size === null) return;

    // Redrawn from scratch every time: the SAME LayerGroup, cleared and rebuilt, rather
    // than diffing segments/markers — the track is small (TRACK_POINT_CAP-bounded) and
    // this keeps "what's on the map" always in lockstep with `t`, with no stale layer
    // left over from a previous poll and no leaked, ever-growing layer count.
    if (layerGroupRef.current) {
      layerGroupRef.current.clearLayers?.();
    } else {
      layerGroupRef.current = L.layerGroup().addTo(m);
    }
    const group = layerGroupRef.current;

    const pt = (x: number, y: number) => m.unproject(worldToPixel(x, y, size, CANVAS_PX), MAX_ZOOM);
    const all: ReturnType<typeof pt>[] = [];
    for (const seg of t.segments) {
      const latlngs = seg.points.map((p) => pt(p.x, p.y));
      all.push(...latlngs);
      if (latlngs.length > 1) L.polyline(latlngs, { color: "#c8102e", weight: 2 }).addTo(group);
    }
    for (const mk of t.markers) {
      // Held as its own reference rather than chained off `.addTo(m)` — Leaflet's real
      // addTo() returns `this`, but relying on that return value to reach bindPopup is
      // fragile (and broke against a test double whose addTo() returns nothing).
      const c = L.circleMarker(pt(mk.x, mk.y), {
        radius: 6, color: MARKER_COLOR[mk.kind], weight: 2, fill: false,
        dashArray: "3 3", // dashed = approximate, always
      });
      c.addTo(group);
      all.push(pt(mk.x, mk.y));
      // Routed through the same `staleness` helper as the accessible marker list — for a
      // `now` marker, `sampleAgeSeconds` is 0 by construction (the fix IS the event), so
      // rendering it directly here would tell a living player their position is current
      // when it may be many minutes old. The popup and the list must never disagree.
      c.bindPopup?.(`${mk.kind}${mk.label ? ` — ${mk.label}` : ""} · ${staleness(mk, Date.now())}`);
    }

    // `fitBounds` only on the FIRST draw for this map instance. A live 60s poll must
    // never snap the view back out from under an owner who has zoomed into their base
    // and opened a marker popup — see the bug this guards against in track-map.test.tsx.
    if (!hasFitRef.current) {
      if (all.length > 0) m.fitBounds(L.latLngBounds(all), { padding: [24, 24] });
      else m.setView(pt(size / 2, size / 2), 1);
      hasFitRef.current = true;
    }
  }

  // Effect 1: create the Leaflet map instance itself. Keyed ONLY on `size` (which only
  // changes if `track.mapCodename` changes, i.e. never in practice for one life) — NOT on
  // `track`, whose identity changes every 60s poll. Re-running this whole effect on every
  // poll was the bug: cleanup called `map.remove()`, destroying and rebuilding the entire
  // map — snapping `fitBounds` back to the full-track view and closing any open popup,
  // with no user input, forever, on a loop no test could see (jsdom has no layout).
  useEffect(() => {
    if (!ref.current || size === null) return;
    let cancelled = false;
    setLoadError(false);
    hasFitRef.current = false;

    // Dynamically imported so Leaflet never enters the server bundle and never runs
    // during SSR — the page must stay coordinate-free on the server.
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
        // (dev, or before the mirror has run) the trail still reads, instead of showing a
        // broken-tile checkerboard that looks like a broken feature.
        L.tileLayer(`/tiles/${trackRef.current.mapCodename}/topographic/{z}/{x}/{y}.webp`, {
          minZoom: 0, maxZoom: MAX_ZOOM, noWrap: true,
          errorTileUrl: "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==",
          attribution: TILE_ATTRIBUTION,
        }).addTo(m);

        drawLayers(trackRef.current);
      })
      .catch(() => {
        // A chunk 404 (realistic mid-deploy) or any other load failure must surface
        // honestly, not degrade to a silently blank dark box next to marker text that
        // confidently claims "N fixes · every marker approximate".
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
  }, [size]);

  // Effect 2: redraw the trail/marker layers whenever `track` changes. A no-op until the
  // map-creation effect above has actually resolved (guarded inside `drawLayers`) — the
  // first real draw happens there, from `trackRef.current`, once Leaflet is ready.
  useEffect(() => {
    drawLayers(track);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track]);

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
        Couldn&apos;t load the map. Your fixes are still listed below.
      </p>
    );
  }

  // `isolate` is load-bearing, not cosmetic. See the LAYER LEGEND at the <header> in
  // header.tsx: the app has exactly three z-altitudes (content, z-40 masthead, z-50
  // overlays). Leaflet assigns its panes 200-700 and its controls 1000, absolutely
  // positioned — without a stacking context here it paints straight over the masthead,
  // the notification popover and the ControlsSheet.
  return <div ref={ref} className="isolate h-[420px] w-full border border-ink bg-dark-well" />;
}
