import Link from "next/link";
import type { BirthNoticeCard as Card } from "@/lib/types";
import { GamertagLink } from "@/components/gamertag-link";
import { birthNoticeHref, birthDateline } from "@/lib/birth-format";

/** One birth notice in the freshest-first feed — dateline, headline → interior, dek, arrival strip. */
export function BirthNoticeCard({ card, now }: { card: Card; now: Date }) {
  return (
    <article className="border-b border-hairline py-6">
      <p className="font-mono text-[11px] uppercase tracking-[.06em] text-ink-muted">{birthDateline(card.map, card.bornAt, now)}</p>
      <h2 className="mt-1.5 font-display text-3xl font-bold uppercase leading-[.95] text-ink md:text-4xl">
        <Link href={birthNoticeHref(card.slug)} className="hover:text-blue">{card.headline}</Link>
      </h2>
      <p className="mt-2 max-w-2xl font-mono text-[13px] leading-relaxed text-ink-soft">{card.lede}</p>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5">
        <span className="font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
          <GamertagLink gamertag={card.gamertag} className="font-bold text-ink underline" />
        </span>
        <span className="font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
          {card.priorLives > 0 ? (
            <>Prior lives <span className="font-bold text-ink">{card.priorLives}</span></>
          ) : (
            <span className="font-bold text-blue">First life</span>
          )}
        </span>
        {card.minutesToQualify != null && (
          <span className="font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
            Qualified in <span className="font-bold text-ink">{card.minutesToQualify}m</span>
          </span>
        )}
      </div>
    </article>
  );
}
