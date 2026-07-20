import type { Challenge } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatExpiry } from "@/lib/format-expiry";
import { SkewCta } from "@/components/tabloid/skew-cta";

const quietBtn =
  "font-mono text-[10.5px] uppercase tracking-[.05em] text-cream-muted underline underline-offset-2 hover:text-paper disabled:opacity-50";

/** Pending rail state (canvas 10d): yellow-bordered dark panel with the emote sequence. */
export function ProveItPanel({
  gamertag,
  challenge,
  now,
  onCancel,
  onReclaim,
  canceling,
  reclaiming,
}: {
  gamertag: string;
  challenge: Challenge | null;
  now: number;
  onCancel: () => void;
  onReclaim: () => void;
  canceling?: boolean;
  reclaiming?: boolean;
}) {
  const expired = !challenge || challenge.expired;
  if (expired) {
    return (
      <section className="border-2 border-yellow bg-dark p-5">
        <p className="font-display text-xs font-bold uppercase tracking-[.16em] text-yellow">Prove it's you</p>
        <p className="mt-2 font-display text-2xl font-bold uppercase leading-none text-paper">
          Your verification for {gamertag} expired
        </p>
        <p className="mt-2 font-mono text-[10.5px] uppercase leading-relaxed tracking-[.04em] text-cream-muted">
          The emote challenge timed out. Start a fresh one and perform the new sequence in game.
        </p>
        <div className="mt-3.5 flex flex-wrap items-center gap-4">
          <SkewCta onClick={onReclaim} disabled={reclaiming}>Start a new challenge →</SkewCta>
          <button type="button" onClick={onCancel} disabled={canceling} className={quietBtn}>
            Cancel claim
          </button>
        </div>
      </section>
    );
  }
  return (
    <section className="border-2 border-yellow bg-dark p-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-display text-xs font-bold uppercase tracking-[.16em] text-yellow">Prove it's you</p>
        <span className="font-mono text-[11px] font-bold uppercase text-yellow">{formatExpiry(challenge.expiresAt, now)}</span>
      </div>
      <p className="mt-2 font-display text-2xl font-bold uppercase leading-none text-paper">{gamertag} — perform, in order:</p>
      <ol className="mt-3.5 flex gap-2 font-mono text-[12px] tracking-[.03em]">
        {challenge.sequence.map((emote, i) => {
          const done = i < challenge.progressIndex;
          const current = i === challenge.progressIndex;
          return (
            <li
              key={i}
              data-done={String(done)}
              className={cn(
                "flex-1 px-2 py-3 text-center uppercase",
                done && "bg-paper font-bold text-ink",
                current && "border border-dashed border-dark-edge-bright bg-dark-hollow text-yellow",
                !done && !current && "border border-dashed border-dark-line text-cream-muted",
              )}
            >
              {i + 1} {emote}
              {done ? " ✓" : current ? " ←" : ""}
            </li>
          );
        })}
      </ol>
      <p className="mt-3 font-mono text-[10px] uppercase leading-relaxed tracking-[.04em] text-cream-muted">
        On any One Life server. Other emotes between are fine — order is what counts. Only whoever controls the tag can finish this.
      </p>
      <div className="mt-3">
        <button type="button" onClick={onCancel} disabled={canceling} className={quietBtn}>
          Cancel claim
        </button>
      </div>
    </section>
  );
}
