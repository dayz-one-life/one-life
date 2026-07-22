"use client";
import MapCanvas, { type DrawContext } from "@/components/map/map-canvas";
import type { LifeTrack } from "@/lib/types";
import { staleness } from "./track-marker-list";

const MARKER_COLOR: Record<LifeTrack["markers"][number]["kind"], string> = {
  kill: "#c8102e",
  death: "#1b1b1b",
  now: "#2563eb",
};

export default function TrackMap({ track }: { track: LifeTrack }) {
  function draw({ L, group, pt }: DrawContext): unknown[] {
    const all: unknown[] = [];
    for (const seg of track.segments) {
      const latlngs = seg.points.map((p) => pt(p.x, p.y));
      all.push(...latlngs);
      if (latlngs.length > 1) L.polyline(latlngs, { color: "#c8102e", weight: 2 }).addTo(group);
    }
    for (const mk of track.markers) {
      // Held as its own reference rather than chained off addTo() — real Leaflet returns
      // `this`, but relying on that broke against a double whose addTo() returns nothing.
      const c = L.circleMarker(pt(mk.x, mk.y), {
        radius: 6, color: MARKER_COLOR[mk.kind], weight: 2, fill: false,
        dashArray: "3 3", // dashed = approximate, always
      });
      c.addTo(group);
      all.push(pt(mk.x, mk.y));
      // Routed through the same `staleness` helper as the accessible marker list: for a `now`
      // marker sampleAgeSeconds is 0 by construction, so rendering it directly would tell a
      // living player their position is current when it may be many minutes old.
      c.bindPopup?.(`${mk.kind}${mk.label ? ` — ${mk.label}` : ""} · ${staleness(mk, Date.now())}`);
    }
    return all;
  }

  return <MapCanvas mapCodename={track.mapCodename} draw={draw} drawKey={track} />;
}
