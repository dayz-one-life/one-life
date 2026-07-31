import Link from "next/link";
import type { LifeTimelineData } from "@/lib/types";
import type { LifeTimelineView } from "@/lib/life-timeline";
import { Avatar } from "@/components/shared/avatar";
import { GamertagLink } from "@/components/gamertag-link";
import { FitLine } from "@/components/front-page/fit-line";
import { mapLabel, formatDuration, formatMeters } from "@/components/player/format";
import { playerSlug } from "@/lib/slug";

const KICKER = "font-mono text-xs uppercase tracking-[.28em] text-cream-dim";

/** Light-on-dark stat — the dossier stage's vocabulary, not the old boxed hero's. */
function Stat({ value, label, blue = false, srLabel }: { value: string; label: string; blue?: boolean; srLabel?: string }) {
  return (
    <div>
      <div className={`font-display text-[28px] font-bold leading-none ${blue ? "text-blue" : "text-paper"}`} aria-label={srLabel}>
        {srLabel ? (<><span aria-hidden="true">{value}</span><span className="sr-only">{srLabel}</span></>) : value}
      </div>
      <div className="mt-[3px] font-mono text-[11px] uppercase tracking-[.07em] text-cream-muted">{label}</div>
    </div>
  );
}

/**
 * The life page's dark stage (v0.69 spec §6) — the dossier hero's treatment applied to one life.
 * Full-bleed: the PAGE owns no horizontal padding; this section states its own px, exactly like
 * `TicketStage`. The back-link strip above is part of the same dark band.
 */
export function LifeHero({ data, view }: { data: LifeTimelineData; view: LifeTimelineView }) {
  const map = mapLabel(data.map);
  const dossier = `/players/${playerSlug(data.gamertag)}`;
  const h = view.hero;
  return (
    <>
      <div className="bg-dark px-6 pb-3 pt-6 md:px-10">
        <Link href={dossier} className="font-mono text-[11px] uppercase tracking-[.06em] text-cream-muted hover:text-paper">
          <span aria-hidden>← </span>{data.gamertag}&apos;s dossier
        </Link>
      </div>
      <section className="border-b-[6px] border-red bg-dark px-6 py-10 text-paper md:px-10 md:py-14">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-5 sm:flex-nowrap">
          {data.avatarHash != null && (
            <div className="flex-none"><Avatar hash={data.avatarHash} size={132} dim={!view.alive} /></div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <p className={KICKER}>A life of <GamertagLink gamertag={data.gamertag} className="font-bold text-paper underline" /> · {map}</p>
              {view.alive ? (
                <span className="bg-blue px-2 pb-0.5 pt-1 font-display text-[11px] font-bold uppercase tracking-[.1em] text-white">Alive</span>
              ) : (
                <span className="bg-red px-2 pb-0.5 pt-1 font-display text-[11px] font-bold uppercase tracking-[.1em] text-white">Died</span>
              )}
            </div>
            <h1 className="mt-2 font-display font-bold uppercase leading-[.9]">
              <FitLine finalText={`Life ${data.life.lifeNumber} · ${map}`} lineClassName="text-[clamp(2rem,6vw,5rem)]">
                {`Life ${data.life.lifeNumber} · ${map}`}
              </FitLine>
            </h1>
          </div>
        </div>
        <div className="mt-7 flex flex-wrap gap-x-7 gap-y-3">
          <Stat value={formatDuration(h.timeAliveSeconds)} label="Time alive" />
          <Stat value={String(h.kills)} label="Kills" />
          <Stat value={h.longestKillMeters == null ? "—" : formatMeters(h.longestKillMeters)} label="Longest kill" />
          <Stat value={String(h.sessions)} label="Sessions" />
          <Stat value={h.qualified ? "✓" : "—"} label="Qualified" blue={h.qualified} srLabel={h.qualified ? "Qualified" : "Not qualified"} />
        </div>
        {data.obituarySlug && (
          <Link href={`/obituaries/${data.obituarySlug}`} className="mt-5 inline-block font-mono text-[11px] font-bold uppercase tracking-[.06em] text-paper underline hover:text-red">
            Read the obituary →
          </Link>
        )}
      </section>
    </>
  );
}
