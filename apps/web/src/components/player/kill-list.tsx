import type { PlayerKill } from "@/lib/types";
import { GamertagLink } from "@/components/gamertag-link";

export function KillList({ kills, limit }: { kills: PlayerKill[]; limit?: number }) {
  if (kills.length === 0) {
    return <p className="mt-1.5 font-mono text-xs uppercase tracking-[.04em] text-ink-muted">None yet. The pacifist era.</p>;
  }
  const shown = limit ? kills.slice(0, limit) : kills;
  return (
    <ul className="mt-1.5 space-y-1.5">
      {shown.map((k, i) => (
        <li key={i} className="flex justify-between gap-3 font-mono text-xs text-ink-soft">
          <span>
            <span aria-hidden>✝ </span>
            <GamertagLink gamertag={k.victimGamertag} className="font-bold text-ink" />
          </span>
          <span className="uppercase text-ink-muted">
            {k.weapon ?? "—"}
            {k.distanceMeters != null ? ` · ${Math.round(k.distanceMeters)}m` : ""}
          </span>
        </li>
      ))}
      {limit && kills.length > limit && <li className="font-mono text-xs text-ink-muted">+ {kills.length - limit} more</li>}
    </ul>
  );
}
