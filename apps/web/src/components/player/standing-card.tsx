import type { ServerStanding } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PlayerAvatar } from "./player-avatar";
import { KillList } from "./kill-list";
import { SelfUnbanButton } from "./self-unban-button";
import { formatDuration, banCountdown, mapLabel } from "./format";

function Stat({ value, label }: { value: string; label: string }) {
  return <div className="flex-1 rounded bg-panel-2 py-2 text-center"><span className="block font-mono text-bone">{value}</span><span className="text-[9px] uppercase text-muted">{label}</span></div>;
}

export function StandingCard({ standing, now, pageGamertag }: { standing: ServerStanding & { pageGamertag?: string }; now: Date; pageGamertag?: string }) {
  const gt = pageGamertag ?? standing.pageGamertag ?? "";
  const border = standing.state === "alive" ? "border-emerald-500/40" : standing.state === "banned" ? "border-red-500/40" : "border-line";
  return (
    <div className={cn("rounded-lg border bg-panel p-4", border)}>
      <div className="flex items-center gap-3">
        <PlayerAvatar character={standing.character} size={44} dim={standing.state !== "alive"} />
        <div className="flex-1">
          <p className="font-hand text-bone">{mapLabel(standing.map)}</p>
          <p className="text-xs text-muted">
            {standing.state === "alive" && standing.alive ? `Alive ${formatDuration(standing.alive.timeAliveSeconds)}` : standing.state === "banned" ? "Banned" : "No open life"}
          </p>
        </div>
        <span className="text-[9px] uppercase">{standing.state === "alive" ? "🟢 Alive" : standing.state === "banned" ? "⛔ Banned" : "⚪ Idle"}</span>
      </div>

      {standing.state === "alive" && standing.alive && (
        <details className="mt-3">
          <summary className="flex cursor-pointer gap-2 list-none">
            <Stat value={String(standing.alive.kills)} label="Kills" />
            <Stat value={standing.alive.longestKillMeters == null ? "—" : `${Math.round(standing.alive.longestKillMeters)}m`} label="Longest kill" />
            <Stat value={formatDuration(standing.alive.timeAliveSeconds)} label="Time alive" />
          </summary>
          <KillList kills={standing.alive.killList} limit={10} />
        </details>
      )}

      {standing.state === "banned" && standing.ban && (
        <div className="mt-3 text-center">
          {banCountdown(standing.ban.expiresAt, now) && (
            <p className="font-display text-xl text-red-300">{banCountdown(standing.ban.expiresAt, now)}<span className="block text-[9px] uppercase text-muted">ban lifts in</span></p>
          )}
          <SelfUnbanButton banId={standing.ban.banId} pageGamertag={gt} liftPending={standing.ban.liftPending} />
        </div>
      )}
    </div>
  );
}
