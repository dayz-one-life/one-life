"use client";
import MapCanvas, { type DrawContext, type MapFocus } from "./map-canvas";
import type { FriendPositionDto } from "@/lib/types";

const SELF_COLOR = "#2563eb";
const FRIEND_COLOR = "#c8102e";

/** Age of one fix, per dot — the page never stamps a single time across all of them. */
export function positionAge(recordedAt: string, now: Date): string {
  const mins = Math.floor((now.getTime() - new Date(recordedAt).getTime()) / 60_000);
  return mins < 1 ? "just now" : `${mins}m ago`;
}

/**
 * ⚠️ Takes the codename and the dots SEPARATELY, not one `FriendMap` payload, because they now
 * come from different places and one of them is optional. The codename comes from the PUBLIC
 * server list, so terrain and towns draw for everyone; the dots come from the session-gated
 * `/me/maps/:slug`, so a signed-out or unverified visitor renders the same map with none.
 */
export default function FriendsMap({ mapCodename, positions, now, focus }: {
  mapCodename: string;
  positions: readonly FriendPositionDto[];
  now: Date;
  focus?: MapFocus | null;
  /** Passed straight through to MapCanvas. The centre is owned by MapPage, because the chip
   *  that reads it is chrome — on a phone it renders in the bottom bar, outside this map. */
}) {

  function draw({ L, group, pt }: DrawContext): unknown[] {
    const all: unknown[] = [];
    for (const p of positions) {
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

  // No legend/list is rendered here: it lives in the map's FriendsPanel (the online list,
  // @/components/map/shell/online-list), which is its only home.
  //
  // ⚠️ `absolute inset-0`, NOT a `h-full` chain. The map fills a `flex-1` box, and a percentage
  // height whose ancestor sizes by flex-grow is not reliably resolvable — this shipped as a
  // 2px-tall Leaflet container with 77 markers drawn into it and every test green, because
  // jsdom computes no layout. Absolute positioning against the caller's `relative` box has no
  // such ambiguity. The caller MUST therefore be positioned; MapPage's map box is `relative`.
  return (
    <div className="absolute inset-0">
      <MapCanvas
        mapCodename={mapCodename}
        draw={draw}
        drawKey={positions}
        focus={focus}
        className="h-full w-full"
      />
    </div>
  );
}
