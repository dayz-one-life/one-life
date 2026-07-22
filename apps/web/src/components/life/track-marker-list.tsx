import type { TrackMarkerDto } from "@/lib/types";

const KIND_LABEL: Record<TrackMarkerDto["kind"], string> = {
  kill: "Kill",
  death: "Death",
  now: "Last known position",
};

function span(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.round(seconds / 60)}m`;
}

/**
 * The staleness clause.
 *
 * For a kill or a death, the honest statement is how long BEFORE the event the fix was
 * taken. For `now` the fix *is* the event (sampleAgeSeconds is 0 by construction), so
 * the honest statement is how old that fix is at read time — computed here, from the
 * browser clock. There is no timer: this re-evaluates on render, which in practice is
 * essentially on every one of the hook's 60s polls — it does not tick on its own between
 * renders. Exported so the map popup (track-map.tsx) renders the identical text instead
 * of a competing, less honest computation. Spec §4.5.
 */
export function staleness(m: TrackMarkerDto, now: number): string {
  if (m.kind !== "now") return `approximate, from a fix ${span(m.sampleAgeSeconds)} before`;
  const age = Math.max(0, Math.round((now - new Date(m.sampleAt).getTime()) / 1000));
  return `last fix ${span(age)} ago`;
}

/** The text equivalent of the map. A map is unusable to a screen reader, so the same
 *  information exists here as real DOM — not as alt text on an image. */
export function TrackMarkerList({ markers, now = Date.now() }: { markers: TrackMarkerDto[]; now?: number }) {
  if (markers.length === 0) return null;
  return (
    <ul role="list" className="mt-3 space-y-1">
      {markers.map((m, i) => (
        <li key={`${m.kind}-${m.at}-${i}`} className="font-mono text-[11px] leading-relaxed text-ink-soft">
          <span className="font-bold text-ink">{KIND_LABEL[m.kind]}</span>
          {m.label ? ` — ${m.label}` : ""}
          {" · "}
          {staleness(m, now)}
        </li>
      ))}
    </ul>
  );
}
