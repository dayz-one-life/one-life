"use client";
import MapCanvas, { type DrawContext, type MapFocus } from "./map-canvas";
import type { FriendMap } from "@/lib/types";

const SELF_COLOR = "#2563eb";
const FRIEND_COLOR = "#c8102e";

/** Age of one fix, per dot — the page never stamps a single time across all of them. */
export function positionAge(recordedAt: string, now: Date): string {
  const mins = Math.floor((now.getTime() - new Date(recordedAt).getTime()) / 60_000);
  return mins < 1 ? "just now" : `${mins}m ago`;
}

export default function FriendsMap({ data, now, focus, onCenterChange }: {
  data: FriendMap;
  now: Date;
  focus?: MapFocus | null;
  /** Passed straight through to MapCanvas. The centre is owned by MapPage, because the chip
   *  that reads it is chrome — on a phone it renders in the bottom bar, outside this map. */
  onCenterChange?: (world: { x: number; y: number }) => void;
}) {

  function draw({ L, group, pt }: DrawContext): unknown[] {
    const all: unknown[] = [];
    for (const p of data.positions) {
      const at = pt(p.x, p.y);
      const c = L.circleMarker(at, {
        radius: 7, color: p.self ? SELF_COLOR : FRIEND_COLOR, weight: 2, fill: false,
        dashArray: "3 3", // dashed = approximate, matching the life trail's markers
      });
      c.addTo(group);
      c.bindPopup?.(`${p.gamertag}${p.self ? " (you)" : ""} · ${positionAge(p.recordedAt, now)}`);
      // Permanent label: a dot with no callsign is unreadable on a squad map, and requiring a
      // click to learn who it is defeats the point. The age stays in the popup and in the
      // bar's OnlineList (the accessible companion to this canvas) — the label carries
      // identity only, so a crowded map does not become a wall of text.
      c.bindTooltip?.(`${p.gamertag}${p.self ? " (you)" : ""}`, {
        permanent: true, direction: "top", offset: [0, -8], className: "friend-label",
      });
      all.push(at);
    }
    return all;
  }

  // No legend/list is rendered here: it lives in the top/bottom bars' FriendsPanel (now the
  // online list, @/components/map/shell/online-list), which is its only home now that the map
  // fills the viewport.
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative min-h-0 flex-1">
        <MapCanvas
          mapCodename={data.mapCodename}
          draw={draw}
          drawKey={data}
          focus={focus}
          onCenterChange={onCenterChange}
          className="h-full w-full"
        />
        {/* Decorative: the grid chip in the chrome carries the same information as text. */}
        <span aria-hidden className="map-crosshair" />
      </div>
    </div>
  );
}
