import type { LifeTimelineView, TimelineEvent } from "@/lib/life-timeline";
import { GamertagLink } from "@/components/gamertag-link";
import { verdictPhrase } from "@/lib/cause-format";
import { formatMeters } from "@/components/player/format";
import { TrapFootnote } from "@/components/player/kill-list";
import { CREDIT_PREFIX, TRAP_LIST_LABEL } from "@/lib/trap-kill";

const DOT: Record<TimelineEvent["marker"], string> = {
  blue: "bg-blue",
  red: "bg-red",
  gray: "bg-dash",
  yellow: "bg-yellow",
};

function meters(d: number | null): string | null {
  return d == null ? null : formatMeters(d);
}

function killDetail(weapon: string | null, distanceMeters: number | null, trap = false): string {
  return [weapon, meters(distanceMeters), trap ? TRAP_LIST_LABEL : null].filter(Boolean).join(" · ");
}

/**
 * The death row. A public death (stage 4) prints "Killed by <link>" only when the kill line names
 * the killer; otherwise its sentence, with a trap credit's name linked after it; then the detail
 * and the vitals; then the caption. ⚠️ A driver stays plain text inside the sentence, never a link,
 * never "Killed by". An old payload with only the legacy triple keeps the old rendering.
 */
function DeathRow({ e }: { e: Extract<TimelineEvent, { kind: "death" }> }) {
  if (!e.sentence) {
    return (
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
    );
  }
  return (
    <>
      <p className="font-display text-xl font-bold uppercase leading-none text-ink">
        {e.killerGamertag ? <>Killed by <GamertagLink gamertag={e.killerGamertag} /></> : e.sentence}
        {e.credit && !e.killerGamertag && (
          <>
            {" "}
            {CREDIT_PREFIX}{" "}
            <GamertagLink gamertag={e.credit.gamertag} />.
          </>
        )}
      </p>
      <p className="mt-1.5 font-mono text-xs leading-relaxed text-ink-soft">
        {[e.detail, e.vitals].filter(Boolean).join(" · ") || "—"}
      </p>
      {e.caption && <p className="mt-1 font-mono text-[11px] italic leading-relaxed text-ink-muted">{e.caption}</p>}
    </>
  );
}

export function WithheldBar() {
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
            <p className="mt-1.5 font-mono text-xs leading-relaxed text-ink-soft">{killDetail(e.weapon, e.distanceMeters, e.basis === "trap_placement")}</p>
          </>
        ) : e.kind === "death" ? (
          <DeathRow e={e} />
        ) : e.kind === "encounter" ? (
          <>
            <p className="font-display text-xl font-bold uppercase leading-none text-ink">
              {e.title}
              {e.attackerGamertag && (
                <>
                  {" "}
                  — hit by <GamertagLink gamertag={e.attackerGamertag} />
                </>
              )}
            </p>
            <p className="mt-1.5 font-mono text-xs leading-relaxed text-ink-soft">{e.line}</p>
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

export function Timeline({
  view,
  heading = "The record so far",
  locationSlot,
}: {
  view: LifeTimelineView;
  heading?: string;
  locationSlot?: React.ReactNode;
}) {
  return (
    <div>
      {locationSlot ?? (view.alive ? <WithheldBar /> : null)}
      <h2 className="mt-7 font-display text-xl font-bold uppercase tracking-[.1em] text-ink">{heading}</h2>
      <ol role="list" className="m-0 mt-4 list-none p-0">
        {view.events.map((e, idx) => (
          <li key={`${e.kind}-${idx}`}>
            <EventRow e={e} />
          </li>
        ))}
      </ol>
      {view.events.some((e) => e.kind === "kill" && e.basis === "trap_placement") && <TrapFootnote className="mt-1" />}
    </div>
  );
}
