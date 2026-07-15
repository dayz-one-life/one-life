import type { PastLife } from "@/lib/types";
import { PlayerAvatar } from "./player-avatar";
import { KillList } from "./kill-list";
import { GamertagLink } from "@/components/gamertag-link";
import { formatDuration, mapLabel } from "./format";

function Stat({ value, label }: { value: string; label: string }) {
  return <div className="flex-1 rounded bg-panel-2 py-2 text-center"><span className="block font-mono text-bone">{value}</span><span className="text-[9px] uppercase text-muted">{label}</span></div>;
}

export function PastLifeCard({ life }: { life: PastLife }) {
  return (
    <details className="rounded-lg border border-line bg-panel p-3">
      <summary className="flex cursor-pointer items-center gap-3 list-none">
        <PlayerAvatar character={life.character} size={34} dim />
        <span className="font-hand text-bone">{mapLabel(life.map)}</span>
        <span className="text-xs text-muted">{formatDuration(life.timeAliveSeconds)} · {life.kills} kills</span>
      </summary>
      <div className="mt-2">
        {life.death?.cause && (
          <p className="text-xs text-red-300">☠ {life.death.cause === "pvp" ? "Killed by " : "Died — "}
            {life.death.byGamertag ? <GamertagLink gamertag={life.death.byGamertag} /> : life.death.cause}
            {life.death.weapon ? ` · ${life.death.weapon}` : ""}{life.death.distanceMeters != null ? ` · ${Math.round(life.death.distanceMeters)}m` : ""}
          </p>
        )}
        <div className="mt-2 flex gap-2">
          <Stat value={String(life.kills)} label="Kills" />
          <Stat value={life.longestKillMeters == null ? "—" : `${Math.round(life.longestKillMeters)}m`} label="Longest kill" />
          <Stat value={formatDuration(life.timeAliveSeconds)} label="Time alive" />
          <Stat value={String(life.sessions)} label="Sessions" />
        </div>
        <KillList kills={life.killList} />
        {(life.vitals.energy != null || life.vitals.bleedSources != null) && (
          <p className="mt-2 text-[10px] text-muted">At death: energy {life.vitals.energy ?? "—"} · water {life.vitals.water ?? "—"} · bleeding from {life.vitals.bleedSources ?? 0}</p>
        )}
      </div>
    </details>
  );
}
