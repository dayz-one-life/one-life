import Link from "next/link";
import type { PastLife } from "@/lib/types";
import { GamertagLink } from "@/components/gamertag-link";
import { lifeHref } from "@/lib/life-href";
import { verdictPhrase } from "@/lib/cause-format";
import { formatDuration, mapLabel, relativeDate } from "./format";

export function PastLifeCard({ life, now, gamertag }: { life: PastLife; now: Date; gamertag: string }) {
  const death = life.death;
  return (
    <section className="border border-hairline border-t-4 border-t-ink bg-archive px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h3 className="font-display text-[17px] font-bold uppercase text-ink">{mapLabel(life.map)}</h3>
        <span className="font-mono text-[10px] uppercase tracking-[.04em] text-ink-muted">
          {relativeDate(life.endedAt, now)} · lasted {formatDuration(life.timeAliveSeconds)}
        </span>
      </div>

      {death?.cause && (
        <p className="mt-2 font-mono text-xs font-bold uppercase tracking-[.04em] text-red-deep">
          <span aria-hidden>✝ </span>
          {death.cause === "pvp" ? (
            <>Killed by {death.byGamertag ? <GamertagLink gamertag={death.byGamertag} className="text-red-deep underline" /> : "unknown"}</>
          ) : (
            <>Died — {verdictPhrase(death.verdict, death.cause)}</>
          )}
          {death.weapon ? ` · ${death.weapon}` : ""}
          {death.distanceMeters != null ? ` · ${Math.round(death.distanceMeters)}m` : ""}
        </p>
      )}

      <p className="mt-2.5 flex flex-wrap gap-x-5 border-t border-hairline-2 pt-2 font-mono text-[11px] uppercase text-ink-soft">
        <span>{life.kills} kill{life.kills === 1 ? "" : "s"}</span>
        <span>{life.longestKillMeters == null ? "—" : `${Math.round(life.longestKillMeters)}m`} longest kill</span>
        <span>{life.sessions} session{life.sessions === 1 ? "" : "s"}</span>
      </p>

      <p className="mt-2 text-right">
        <Link href={lifeHref(gamertag, life.slug, life.lifeNumber)} className="font-mono text-[10px] uppercase tracking-[.06em] text-ink-muted underline hover:text-red">
          Timeline <span aria-hidden>→</span>
        </Link>
      </p>
    </section>
  );
}
