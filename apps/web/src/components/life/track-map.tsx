"use client";
import { useEffect, useRef } from "react";
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

const MARKER_COLOR: Record<LifeTrack["markers"][number]["kind"], string> = {
  kill: "#c8102e",
  death: "#1b1b1b",
  now: "#2563eb",
};

export default function TrackMap({ track }: { track: LifeTrack }) {
  const ref = useRef<HTMLDivElement>(null);
  const size = worldSize(track.mapCodename);

  useEffect(() => {
    if (!ref.current || size === null) return;
    let cancelled = false;
    let map: { remove: () => void } | null = null;

    // Dynamically imported so Leaflet never enters the server bundle and never runs
    // during SSR — the page must stay coordinate-free on the server.
    void import("leaflet").then((mod) => {
      if (cancelled || !ref.current) return;
      const L = mod.default;
      const m = L.map(ref.current, {
        crs: L.CRS.Simple, minZoom: 0, maxZoom: MAX_ZOOM, attributionControl: false,
      });
      map = m;
      const pt = (x: number, y: number) => m.unproject(worldToPixel(x, y, size, CANVAS_PX), MAX_ZOOM);

      // errorTileUrl blank + a dark backdrop on the container: when tiles are absent
      // (dev, or before the mirror has run) the trail still reads, instead of showing a
      // broken-tile checkerboard that looks like a broken feature.
      L.tileLayer(`/tiles/${track.mapCodename}/topographic/{z}/{x}/{y}.webp`, {
        minZoom: 0, maxZoom: MAX_ZOOM, noWrap: true,
        errorTileUrl: "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==",
      }).addTo(m);

      const all: ReturnType<typeof pt>[] = [];
      for (const seg of track.segments) {
        const latlngs = seg.points.map((p) => pt(p.x, p.y));
        all.push(...latlngs);
        if (latlngs.length > 1) L.polyline(latlngs, { color: "#c8102e", weight: 2 }).addTo(m);
      }
      for (const mk of track.markers) {
        // Held as its own reference rather than chained off `.addTo(m)` — Leaflet's real
        // addTo() returns `this`, but relying on that return value to reach bindPopup is
        // fragile (and broke against a test double whose addTo() returns nothing).
        const c = L.circleMarker(pt(mk.x, mk.y), {
          radius: 6, color: MARKER_COLOR[mk.kind], weight: 2, fill: false,
          dashArray: "3 3", // dashed = approximate, always
        });
        c.addTo(m);
        all.push(pt(mk.x, mk.y));
        // Routed through the same `staleness` helper as the accessible marker list — for a
        // `now` marker, `sampleAgeSeconds` is 0 by construction (the fix IS the event), so
        // rendering it directly here would tell a living player their position is current
        // when it may be many minutes old. The popup and the list must never disagree.
        c.bindPopup(`${mk.kind}${mk.label ? ` — ${mk.label}` : ""} · ${staleness(mk, Date.now())}`);
      }
      if (all.length > 0) m.fitBounds(L.latLngBounds(all), { padding: [24, 24] });
      else m.setView(pt(size / 2, size / 2), 1);
    });

    return () => { cancelled = true; map?.remove(); };
  }, [track, size]);

  if (size === null) {
    return (
      <p className="border border-hairline bg-bone px-4 py-3 font-mono text-[11px] text-ink-soft">
        Unmapped terrain — the desk has no chart for this server.
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
