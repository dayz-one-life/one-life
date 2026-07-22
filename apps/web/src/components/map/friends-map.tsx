"use client";
import { useState } from "react";
import MapCanvas, { type DrawContext, type MapFocus } from "./map-canvas";
import type { FriendMap, FriendPositionDto } from "@/lib/types";
import { CoordChip } from "./shell/coord-chip";

const SELF_COLOR = "#2563eb";
const FRIEND_COLOR = "#c8102e";

/** Age of one fix, per dot — the page never stamps a single time across all of them. */
export function positionAge(recordedAt: string, now: Date): string {
  const mins = Math.floor((now.getTime() - new Date(recordedAt).getTime()) / 60_000);
  return mins < 1 ? "just now" : `${mins}m ago`;
}

/** ⚠️ DARK SURFACE — the map shell is dark end to end (app/maps/layout.tsx), so this carries
 *  cream tokens, never `text-ink`. RTL asserts the DOM, not contrast: ink here renders present,
 *  functional and invisible, with every other test still green.
 *
 *  The accessible companion to the canvas: every dot as text, with its own age. A map alone
 *  is unreadable to a screen reader, and this is also the honest place to say nobody is here. */
export function FriendsMapLegend({ positions, now }: { positions: FriendPositionDto[]; now: Date }) {
  if (positions.length === 0) {
    return (
      <p className="mt-3 font-mono text-[11px] uppercase tracking-[.05em] text-cream-muted">
        Nobody is sharing a position here right now.
      </p>
    );
  }
  return (
    <ul role="list" className="mt-3 flex flex-col gap-1">
      {positions.map((p) => (
        <li key={p.gamertag} className="font-mono text-[11px] uppercase tracking-[.05em] text-cream-dim">
          {p.gamertag}{p.self ? " (you)" : ""} · {positionAge(p.recordedAt, now)}
        </li>
      ))}
    </ul>
  );
}

export default function FriendsMap({ data, now, focus }: {
  data: FriendMap; now: Date; focus?: MapFocus | null;
}) {
  const [world, setWorld] = useState<{ x: number; y: number } | null>(null);

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
      // click to learn who it is defeats the point. The age stays in the popup/legend — the
      // label carries identity only, so a crowded map does not become a wall of text.
      c.bindTooltip?.(`${p.gamertag}${p.self ? " (you)" : ""}`, {
        permanent: true, direction: "top", offset: [0, -8], className: "friend-label",
      });
      all.push(at);
    }
    return all;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative min-h-0 flex-1">
        <MapCanvas
          mapCodename={data.mapCodename}
          draw={draw}
          drawKey={data}
          focus={focus}
          onCenterChange={setWorld}
          className="h-full w-full"
        />
        {/* Decorative: the chip carries the same information as text. */}
        <span aria-hidden className="map-crosshair" />
        <CoordChip world={world} />
      </div>
      <FriendsMapLegend positions={data.positions} now={now} />
    </div>
  );
}
