import Link from "next/link";
import type { NewsCard as Card } from "@/lib/types";
import { GamertagLink } from "@/components/gamertag-link";
import { newsArticleHref, newsDateline, triggerLabel } from "@/lib/news-format";
import { editorialKicker } from "./editorial-article";
import { relativeDate } from "@/components/player/format";

/** One feature in the reverse-chron news feed. Text-only: the hero photograph is the interior's
 *  signal that a piece is a feature, and repeating it at thumbnail size on the feed spends the
 *  rationing rule for nothing. */
export function NewsCard({ card, now }: { card: Card; now: Date }) {
  return (
    <article className="border-b border-hairline py-6">
      <p className="font-mono text-[11px] uppercase tracking-[.06em] text-ink-muted">
        {/* An editorial piece has no bureau; it files from the desk under its own kicker. */}
        {card.map
          ? newsDateline(card.map, card.createdAt, now)
          : `${editorialKicker(card.editorialFormat)} · ${relativeDate(card.createdAt, now)}`}
      </p>
      <h2 className="mt-1.5 font-display text-3xl font-bold uppercase leading-[.95] text-ink md:text-4xl">
        <Link href={newsArticleHref(card.slug)} className="hover:text-red">{card.headline}</Link>
      </h2>
      <p className="mt-2 max-w-2xl font-mono text-[13px] leading-relaxed text-ink-soft">{card.lede}</p>
      {/* Subject chips render only for a piece that HAS a subject. An editorial card carries
          gamertag=null; a GamertagLink here would link a player who is not in the story. */}
      {card.gamertag && (
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5">
          <span className="font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
            <GamertagLink gamertag={card.gamertag} className="font-bold text-ink underline" />
          </span>
          <span className="font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
            {triggerLabel(card.trigger)}
          </span>
          {card.subjectCount > 1 && (
            <span className="font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
              {card.subjectCount} subjects
            </span>
          )}
        </div>
      )}
    </article>
  );
}
