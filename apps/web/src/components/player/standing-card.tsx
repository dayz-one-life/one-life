import Link from "next/link";
import type { ServerStanding } from "@/lib/types";
import { cn } from "@/lib/utils";
import { lifeHref } from "@/lib/life-href";
import { PlayerAvatar } from "./player-avatar";
import { KillList } from "./kill-list";
import { SelfUnbanButton } from "./self-unban-button";
import { formatDuration, banCountdown, mapLabel } from "./format";
import { Stat } from "./stat";

export function StandingCard({ standing, now, pageGamertag }: { standing: ServerStanding; now: Date; pageGamertag: string }) {
  const alive = standing.state === "alive";
  const banned = standing.state === "banned";
  const sub =
    alive && standing.alive ? `Alive ${formatDuration(standing.alive.timeAliveSeconds)}`
    : banned ? "Died — awaiting respawn"
    : "No open life";
  const timelineLifeNumber = alive && standing.alive ? standing.alive.lifeNumber : banned ? standing.ban?.triggeringLifeNumber ?? null : null;

  return (
    <section className={cn("border border-hairline bg-white p-5", banned && "border-l-4 border-l-red")}>
      <div className="flex items-center gap-3">
        <PlayerAvatar character={standing.character} size={48} dim={!alive} />
        <div className="min-w-0 flex-1">
          <p className="font-display text-[19px] font-bold uppercase leading-none text-ink">{mapLabel(standing.map)}</p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[.05em] text-ink-muted">
            {sub}
            {timelineLifeNumber != null && (
              <>
                {" · "}
                <Link href={lifeHref(pageGamertag, standing.slug, timelineLifeNumber)} className="underline hover:text-red">
                  Timeline <span aria-hidden>→</span>
                </Link>
              </>
            )}
          </p>
        </div>
        <span
          className={cn(
            "px-2 pb-0.5 pt-1 font-display text-[11px] font-bold uppercase tracking-[.1em]",
            alive ? "bg-blue text-white" : banned ? "bg-red text-white" : "border border-dashed border-dash text-ink-muted"
          )}
        >
          {alive ? "Alive" : banned ? "Banned" : "No life"}
        </span>
      </div>

      {alive && standing.alive && (
        <>
          <div className="mt-4 grid grid-cols-3 gap-x-3 border-t border-hairline-2 pt-3">
            <Stat value={formatDuration(standing.alive.timeAliveSeconds)} label="Time alive" />
            <Stat value={String(standing.alive.kills)} label="Kills" />
            <Stat
              value={standing.alive.longestKillMeters == null ? "—" : `${Math.round(standing.alive.longestKillMeters)}m`}
              label="Longest kill"
              muted={standing.alive.longestKillMeters == null}
            />
          </div>
          <div className="mt-3 border-t border-hairline-2 pt-2.5">
            <p className="font-display text-xs font-bold uppercase tracking-[.12em] text-red">Kills this life</p>
            <KillList kills={standing.alive.killList} limit={10} />
          </div>
        </>
      )}

      {banned && standing.ban && (
        <div className="mt-4">
          {banCountdown(standing.ban.expiresAt, now) && (
            <div className="flex items-center justify-between border border-hairline-2 bg-paper px-3 py-2">
              <span className="font-mono text-[10px] uppercase tracking-[.06em] text-ink-muted">Ban lifts in</span>
              <span className="font-display text-lg font-bold text-ink">{banCountdown(standing.ban.expiresAt, now)}</span>
            </div>
          )}
          <SelfUnbanButton banId={standing.ban.banId} pageGamertag={pageGamertag} liftPending={standing.ban.liftPending} />
        </div>
      )}
    </section>
  );
}
