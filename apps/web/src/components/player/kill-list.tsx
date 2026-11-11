import type { PlayerKill } from "@/lib/types";
import { GamertagLink } from "@/components/gamertag-link";
import { formatMeters } from "@/components/player/format";
import { TRAP_LIST_FOOTNOTE, TRAP_LIST_LABEL } from "@/lib/trap-kill";

/** The note under a list that shows a trap kill (death-verdict spec 2.4). */
export function TrapFootnote({ className = "" }: { className?: string }) {
  return <p className={`font-mono text-[11px] leading-relaxed text-ink-muted ${className}`}>{TRAP_LIST_FOOTNOTE}</p>;
}

export function KillList({ kills, limit }: { kills: PlayerKill[]; limit?: number }) {
  if (kills.length === 0) {
    return <p className="mt-1.5 font-mono text-xs uppercase tracking-[.04em] text-ink-muted">None yet. The pacifist era.</p>;
  }
  const shown = limit ? kills.slice(0, limit) : kills;
  // ⚠️ A trap kill is a kill, counted like any other, but the log names no killer for it: the row
  // must say "by trap", and the list must say what that means. Never "Killed", never "their trap".
  const anyTrap = shown.some((k) => k.basis === "trap_placement");
  return (
    <>
      <ul className="mt-1.5 space-y-1.5">
        {shown.map((k, i) => (
          <li key={i} className="flex justify-between gap-3 font-mono text-xs text-ink-soft">
            <span>
              <span aria-hidden>✝ </span>
              <GamertagLink gamertag={k.victimGamertag} className="font-bold text-ink" />
            </span>
            <span className="uppercase text-ink-muted">
              {k.weapon ?? "—"}
              {k.distanceMeters != null ? <> · <span className="normal-case">{formatMeters(k.distanceMeters)}</span></> : null}
              {k.basis === "trap_placement" ? <> · <span className="normal-case">{TRAP_LIST_LABEL}</span></> : null}
            </span>
          </li>
        ))}
        {limit && kills.length > limit && <li className="font-mono text-xs text-ink-muted">+ {kills.length - limit} more</li>}
      </ul>
      {anyTrap && <TrapFootnote className="mt-2" />}
    </>
  );
}
