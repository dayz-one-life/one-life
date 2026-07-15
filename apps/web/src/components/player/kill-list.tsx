import type { PlayerKill } from "@/lib/types";
import { GamertagLink } from "@/components/gamertag-link";

export function KillList({ kills, limit }: { kills: PlayerKill[]; limit?: number }) {
  if (kills.length === 0) return <p className="text-xs text-muted">No kills this life.</p>;
  const shown = limit ? kills.slice(0, limit) : kills;
  return (
    <div className="mt-2">
      <p className="mb-1 text-[10px] uppercase tracking-wide text-muted">Kills this life</p>
      <ul className="space-y-1">
        {shown.map((k, i) => (
          <li key={i} className="flex justify-between border-b border-line/40 pb-1 text-xs text-bone">
            <GamertagLink gamertag={k.victimGamertag} />
            <span className="font-mono text-muted">{k.weapon ?? "—"}{k.distanceMeters != null ? ` · ${Math.round(k.distanceMeters)}m` : ""}</span>
          </li>
        ))}
      </ul>
      {limit && kills.length > limit && <p className="mt-1 text-xs text-muted">+ {kills.length - limit} more</p>}
    </div>
  );
}
