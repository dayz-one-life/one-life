"use client";
import MapCanvas, { type DrawContext } from "./map-canvas";
import type { FriendMap, FriendPositionDto } from "@/lib/types";

const SELF_COLOR = "#2563eb";
const FRIEND_COLOR = "#c8102e";

/** Age of one fix, per dot — the page never stamps a single time across all of them. */
export function positionAge(recordedAt: string, now: Date): string {
  const mins = Math.floor((now.getTime() - new Date(recordedAt).getTime()) / 60_000);
  return mins < 1 ? "just now" : `${mins}m ago`;
}

/** The accessible companion to the canvas: every dot as text, with its own age. A map alone
 *  is unreadable to a screen reader, and this is also the honest place to say nobody is here. */
export function FriendsMapLegend({ positions, now }: { positions: FriendPositionDto[]; now: Date }) {
  if (positions.length === 0) {
    return (
      <p className="mt-3 font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
        Nobody is sharing a position here right now.
      </p>
    );
  }
  return (
    <ul role="list" className="mt-3 flex flex-col gap-1">
      {positions.map((p) => (
        <li key={p.gamertag} className="font-mono text-[11px] uppercase tracking-[.05em] text-ink">
          {p.gamertag}{p.self ? " (you)" : ""} · {positionAge(p.recordedAt, now)}
        </li>
      ))}
    </ul>
  );
}

export default function FriendsMap({ data, now }: { data: FriendMap; now: Date }) {
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
      all.push(at);
    }
    return all;
  }

  return (
    <>
      <MapCanvas mapCodename={data.mapCodename} draw={draw} drawKey={data} />
      <FriendsMapLegend positions={data.positions} now={now} />
    </>
  );
}
