import type { PastLife } from "@/lib/types";
import { PlayerAvatar } from "./player-avatar";
import { KillList } from "./kill-list";
import { GamertagLink } from "@/components/gamertag-link";
import { formatDuration, mapLabel, relativeDate } from "./format";

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex-1 rounded-lg bg-black/20 py-3 text-center">
      <span className="block font-mono text-lg text-bone">{value}</span>
      <span className="mt-1 block text-[9px] uppercase tracking-wide text-muted">{label}</span>
    </div>
  );
}

export function PastLifeCard({ life, now }: { life: PastLife; now: Date }) {
  return (
    <div className="rounded-xl border border-line/70 bg-white/[0.015] p-5">
      <div className="flex items-center gap-3">
        <PlayerAvatar character={life.character} size={40} dim />
        <div>
          <p className="font-hand text-lg text-bone">{mapLabel(life.map)}</p>
          <p className="text-xs text-muted">{relativeDate(life.endedAt, now)} · lasted {formatDuration(life.timeAliveSeconds)}</p>
        </div>
      </div>

      {life.death?.cause && (
        <p className="mt-4 rounded-lg bg-red/[0.05] px-3 py-2 text-xs text-red/90">
          ☠ {life.death.cause === "pvp" ? "Killed by " : "Died — "}
          {life.death.byGamertag ? <GamertagLink gamertag={life.death.byGamertag} /> : life.death.cause}
          {life.death.weapon ? ` · ${life.death.weapon}` : ""}
          {life.death.distanceMeters != null ? ` · ${Math.round(life.death.distanceMeters)}m` : ""}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <Stat value={String(life.kills)} label="Kills" />
        <Stat value={life.longestKillMeters == null ? "—" : `${Math.round(life.longestKillMeters)}m`} label="Longest kill" />
        <Stat value={String(life.sessions)} label="Sessions" />
      </div>

      <KillList kills={life.killList} />

      {(life.vitals.energy != null || life.vitals.bleedSources != null) && (
        <p className="mt-3 text-[10px] text-muted">At death: energy {life.vitals.energy ?? "—"} · water {life.vitals.water ?? "—"} · bleeding from {life.vitals.bleedSources ?? 0}</p>
      )}
    </div>
  );
}
