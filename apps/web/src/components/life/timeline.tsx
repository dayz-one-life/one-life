import type { LifeTimelineView, TimelineEvent } from "@/lib/life-timeline";
import { GamertagLink } from "@/components/gamertag-link";
import { verdictPhrase } from "@/lib/cause-format";

const DOT: Record<TimelineEvent["marker"], string> = {
  blue: "bg-blue",
  red: "bg-red",
  gray: "bg-dash",
};

function meters(d: number | null): string | null {
  return d == null ? null : `${Math.round(d)}m`;
}

function killDetail(weapon: string | null, distanceMeters: number | null): string {
  return [weapon, meters(distanceMeters)].filter(Boolean).join(" · ");
}

function WithheldBar() {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 border border-hairline bg-bone px-4 py-3">
      <span className="flex-none font-display text-xs font-bold uppercase tracking-[.1em] text-ink">Positions withheld</span>
      <span className="font-mono text-[11px] leading-relaxed tracking-[.03em] text-ink-soft">
        This survivor is alive. The desk does not print the coordinates of the living.
      </span>
    </div>
  );
}

function EventRow({ e }: { e: TimelineEvent }) {
  const timeColor = e.marker === "blue" ? "font-bold text-blue" : "text-ink-muted";
  return (
    <div className="grid grid-cols-[72px_1fr] gap-x-4 md:grid-cols-[96px_1fr] md:gap-x-[22px]">
      <div className={`pt-0.5 text-right font-mono text-[11px] tracking-[.03em] ${timeColor}`}>{e.timeLabel}</div>
      <div className="relative border-l-2 border-hairline pb-6 pl-6">
        <span aria-hidden className={`absolute -left-[7px] top-[3px] h-3.5 w-3.5 rounded-full border-2 border-paper ${DOT[e.marker]}`} />
        {e.kind === "kill" ? (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-display text-xl font-bold uppercase leading-none text-ink">
                Kill — <GamertagLink gamertag={e.victimGamertag} />
              </span>
              {e.longestKill && (
                <span className="-skew-x-[5deg] bg-yellow px-2 pb-0.5 pt-1 font-display text-[10px] font-bold uppercase tracking-[.08em] text-ink">Longest kill</span>
              )}
            </div>
            <p className="mt-1.5 font-mono text-xs leading-relaxed text-ink-soft">{killDetail(e.weapon, e.distanceMeters)}</p>
          </>
        ) : e.kind === "death" ? (
          <>
            <p className="font-display text-xl font-bold uppercase leading-none text-ink">
              {e.cause === "pvp" ? (
                <>Killed by {e.byGamertag ? <GamertagLink gamertag={e.byGamertag} /> : "unknown"}</>
              ) : (
                <>Died — {verdictPhrase(e.verdict, e.cause)}</>
              )}
            </p>
            <p className="mt-1.5 font-mono text-xs leading-relaxed text-ink-soft">
              {[killDetail(e.weapon, e.distanceMeters) || null, e.vitals].filter(Boolean).join(" · ") || "—"}
            </p>
          </>
        ) : (
          <>
            <p className={`font-display font-bold uppercase leading-none text-ink ${e.kind === "session" || e.kind === "session-group" ? "text-base" : "text-xl"}`}>{e.title}</p>
            <p className="mt-1.5 font-mono text-xs leading-relaxed text-ink-soft">{e.line}</p>
          </>
        )}
      </div>
    </div>
  );
}

export function Timeline({ view, heading = "The record so far" }: { view: LifeTimelineView; heading?: string }) {
  return (
    <div>
      {view.alive && <WithheldBar />}
      <h2 className="mt-7 font-display text-xl font-bold uppercase tracking-[.1em] text-ink">{heading}</h2>
      <div className="mt-4">
        {view.events.map((e, idx) => (
          <EventRow key={`${e.kind}-${idx}`} e={e} />
        ))}
      </div>
    </div>
  );
}
