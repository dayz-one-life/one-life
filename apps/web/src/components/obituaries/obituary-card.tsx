import Link from "next/link";
import type { ObituaryCard as Card } from "@/lib/types";
import { GamertagLink } from "@/components/gamertag-link";
import { cn } from "@/lib/utils";
import { obituaryHref, dateline, rapSheetFacts } from "@/lib/obituary-format";

/** One obituary in the reverse-chron feed — headline → interior, dek, dateline, Rap Sheet strip. */
export function ObituaryCard({ card, now }: { card: Card; now: Date }) {
  const facts = rapSheetFacts(card);
  return (
    <article className="border-b border-hairline py-6">
      <p className="font-mono text-[11px] uppercase tracking-[.06em] text-ink-muted">{dateline(card.map, card.deathAt, now)}</p>
      <h2 className="mt-1.5 font-display text-3xl font-bold uppercase leading-[.95] text-ink md:text-4xl">
        <Link href={obituaryHref(card.slug)} className="hover:text-red">{card.headline}</Link>
      </h2>
      <p className="mt-2 max-w-2xl font-mono text-[13px] leading-relaxed text-ink-soft">{card.lede}</p>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5">
        <span className="font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
          <GamertagLink gamertag={card.gamertag} className="font-bold text-ink underline" />
        </span>
        {facts.map((f) => (
          <span key={f.label} className="font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
            {f.label} <span className={cn("font-bold", f.hot ? "text-red" : "text-ink")}>{f.value}</span>
          </span>
        ))}
      </div>
    </article>
  );
}
