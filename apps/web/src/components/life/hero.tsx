import Link from "next/link";
import type { LifeTimelineData } from "@/lib/types";
import type { LifeTimelineView } from "@/lib/life-timeline";
import { CharacterImage } from "@/components/character-image";
import { GamertagLink } from "@/components/gamertag-link";
import { mapLabel, formatDuration } from "@/components/player/format";
import { playerSlug } from "@/lib/slug";

function Stat({ value, label, blue = false, srLabel }: { value: string; label: string; blue?: boolean; srLabel?: string }) {
  return (
    <div>
      <div
        className={`font-display text-[28px] font-bold leading-none ${blue ? "text-blue" : "text-ink"}`}
        aria-label={srLabel}
      >
        {srLabel ? (
          <>
            <span aria-hidden="true">{value}</span>
            <span className="sr-only">{srLabel}</span>
          </>
        ) : (
          value
        )}
      </div>
      <div className="mt-[3px] font-mono text-[11px] uppercase tracking-[.07em] text-ink-muted">{label}</div>
    </div>
  );
}

export function LifeHero({ data, view }: { data: LifeTimelineData; view: LifeTimelineView }) {
  const map = mapLabel(data.map);
  const dossier = `/players/${playerSlug(data.gamertag)}`;
  const h = view.hero;

  return (
    <div>
      <Link href={dossier} className="font-mono text-[11px] uppercase tracking-[.06em] text-ink-muted hover:text-red">
        <span aria-hidden>← </span>
        {data.gamertag}&apos;s dossier
      </Link>

      <div className="mt-3 flex flex-col gap-5 border-b-[3px] border-ink pb-5 sm:flex-row sm:gap-6">
        <div className="w-[132px] flex-none">
          <CharacterImage character={{ name: data.character?.name ?? null }} size={132} dim={!view.alive} />
          <p className="mt-2 text-center font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">Snapshot · this life</p>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
              A life of <GamertagLink gamertag={data.gamertag} className="font-bold text-ink underline" /> · {map}
            </span>
            {view.alive ? (
              <span className="bg-blue px-2 pb-0.5 pt-1 font-display text-[11px] font-bold uppercase tracking-[.1em] text-white">Alive</span>
            ) : (
              <span className="bg-red px-2 pb-0.5 pt-1 font-display text-[11px] font-bold uppercase tracking-[.1em] text-white">Died</span>
            )}
          </div>
          <h1 className="mt-1 font-display text-5xl font-bold uppercase leading-[.92] text-ink md:text-6xl">
            Life {data.life.lifeNumber} · {map}
          </h1>
          <div className="mt-4 flex flex-wrap gap-x-7 gap-y-3">
            <Stat value={formatDuration(h.timeAliveSeconds)} label="Time alive" />
            <Stat value={String(h.kills)} label="Kills" />
            <Stat value={h.longestKillMeters == null ? "—" : `${Math.round(h.longestKillMeters)}m`} label="Longest kill" />
            <Stat value={String(h.sessions)} label="Sessions" />
            <Stat
              value={h.qualified ? "✓" : "—"}
              label="Qualified"
              blue={h.qualified}
              srLabel={h.qualified ? "Qualified" : "Not qualified"}
            />
          </div>
          {data.obituarySlug && (
            <Link
              href={`/obituaries/${data.obituarySlug}`}
              className="mt-4 inline-block font-mono text-[11px] font-bold uppercase tracking-[.06em] text-red-deep underline"
            >
              Read the obituary →
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
