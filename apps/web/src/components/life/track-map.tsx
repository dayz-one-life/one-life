"use client";
import { useEffect, useRef } from "react";
import { worldSize, worldToPixel } from "@/lib/dayz-projection";
import type { LifeTrack } from "@/lib/types";

/** DZMap's vanilla pyramid tops out at zoom 6. The pixel extent of the pyramid at that
 *  zoom is 256 * 2**6 = 16384. If the mirrored tiles turn out to use a different max
 *  zoom, change these two together — worldToPixel takes canvasPx as a parameter
 *  precisely so this stays a one-line correction. */
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
      L.tileLayer(`/tiles/${track.mapCodename}/terrain/{z}/{x}/{y}.webp`, {
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
        c.bindPopup(`${mk.kind}${mk.label ? ` — ${mk.label}` : ""} · fix ${mk.sampleAgeSeconds}s earlier`);
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
