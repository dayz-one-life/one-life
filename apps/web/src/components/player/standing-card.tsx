import type { ServerStanding } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PlayerAvatar } from "./player-avatar";
import { KillList } from "./kill-list";
import { SelfUnbanButton } from "./self-unban-button";
import { formatDuration, banCountdown, mapLabel } from "./format";

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex-1 rounded-lg bg-black/20 py-3 text-center">
      <span className="block font-mono text-lg text-bone">{value}</span>
      <span className="mt-1 block text-[9px] uppercase tracking-wide text-muted">{label}</span>
    </div>
  );
}

export function StandingCard({ standing, now, pageGamertag }: { standing: ServerStanding; now: Date; pageGamertag: string }) {
  const tone =
    standing.state === "alive" ? "border-blue/40 bg-blue/[0.06]"
    : standing.state === "banned" ? "border-red/40 bg-red/[0.06]"
    : "border-line";
  const pill =
    standing.state === "alive" ? "bg-blue/15 text-blue"
    : standing.state === "banned" ? "bg-red/15 text-red"
    : "bg-white/10 text-muted";
  const sub =
    standing.state === "alive" && standing.alive ? `Alive ${formatDuration(standing.alive.timeAliveSeconds)}`
    : standing.state === "banned" ? "Died — awaiting respawn"
    : "No open life";
  return (
    <div className={cn("rounded-xl border p-5", tone)}>
      <div className="flex items-center gap-3">
        <PlayerAvatar character={standing.character} size={48} dim={standing.state !== "alive"} />
        <div className="flex-1">
          <p className="font-hand text-lg text-bone">{mapLabel(standing.map)}</p>
          <p className="text-xs text-muted">{sub}</p>
        </div>
        <span className={cn("rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wide", pill)}>
          {standing.state === "alive" ? "● Alive" : standing.state === "banned" ? "⛔ Banned" : "Idle"}
        </span>
      </div>

      {standing.state === "alive" && standing.alive && (
        <>
          <div className="mt-4 flex gap-2">
            <Stat value={String(standing.alive.kills)} label="Kills" />
            <Stat value={standing.alive.longestKillMeters == null ? "—" : `${Math.round(standing.alive.longestKillMeters)}m`} label="Longest kill" />
            <Stat value={formatDuration(standing.alive.timeAliveSeconds)} label="Time alive" />
          </div>
          <KillList kills={standing.alive.killList} limit={10} />
        </>
      )}

      {standing.state === "banned" && standing.ban && (
        <div className="mt-4 text-center">
          {banCountdown(standing.ban.expiresAt, now) && (
            <p className="font-display text-2xl text-red">
              {banCountdown(standing.ban.expiresAt, now)}
              <span className="mt-1 block text-[9px] uppercase tracking-wide text-muted">ban lifts in</span>
            </p>
          )}
          <SelfUnbanButton banId={standing.ban.banId} pageGamertag={pageGamertag} liftPending={standing.ban.liftPending} />
        </div>
      )}
    </div>
  );
}
