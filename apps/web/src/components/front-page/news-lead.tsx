import Link from "next/link";
import Image from "next/image";
import type { NewsCard } from "@/lib/types";
import { newsArticleHref, newsDateline } from "@/lib/news-format";
import { editorialKicker } from "@/components/news/editorial-article";
import { relativeDate } from "@/components/player/format";

/** The card's over-line: bureau dateline for a subjectful piece, desk kicker for an editorial. */
function overline(card: NewsCard, now: Date): string {
  return card.map
    ? newsDateline(card.map, card.createdAt, now)
    : `${editorialKicker(card.editorialFormat)} · ${relativeDate(card.createdAt, now)}`;
}

/**
 * The news-led front page (the §15 follow-up, shipped): the newest feature leads full-width with
 * its hero photo; the next two sit in a two-column rank below. Renders NOTHING with no lead —
 * the page falls back to the manifesto hero, so an empty newsroom never prints an empty box.
 */
export function NewsLead({ lead, secondary, now }: {
  lead: NewsCard | null;
  secondary: NewsCard[];
  now: Date;
}) {
  if (!lead) return null;
  return (
    <section className="border-b-[3px] border-ink px-6 py-8 md:px-10">
      <article>
        {lead.imageUrl && (
          <div className="relative aspect-video w-full overflow-hidden border border-hairline">
            <Image src={lead.imageUrl} alt="" fill priority sizes="(min-width: 1024px) 944px, 100vw" className="object-cover" />
          </div>
        )}
        <p className="mt-4 font-mono text-[11px] uppercase tracking-[.06em] text-ink-muted">
          {overline(lead, now)}
        </p>
        <h1 className="mt-2 font-display text-4xl font-bold uppercase leading-[.95] md:text-6xl">
          <Link href={newsArticleHref(lead.slug)} className="text-ink hover:text-red">{lead.headline}</Link>
        </h1>
        <p className="mt-3 max-w-3xl font-mono text-[14px] leading-relaxed text-ink-soft">{lead.lede}</p>
      </article>

      {secondary.length > 0 && (
        <div className="mt-8 grid gap-6 border-t border-hairline pt-6 md:grid-cols-2 md:gap-0 md:divide-x md:divide-hairline">
          {secondary.map((card, i) => (
            <article key={card.slug} className={i === 0 ? "md:pr-6" : "md:pl-6"}>
              {card.imageUrl && (
                <div className="relative aspect-video w-full overflow-hidden border border-hairline">
                  <Image src={card.imageUrl} alt="" fill sizes="(min-width: 768px) 460px, 100vw" className="object-cover" />
                </div>
              )}
              <p className="mt-3 font-mono text-[10.5px] uppercase tracking-[.06em] text-ink-muted">
                {overline(card, now)}
              </p>
              <h2 className="mt-1.5 font-display text-2xl font-bold uppercase leading-[.95]">
                <Link href={newsArticleHref(card.slug)} className="text-ink hover:text-red">{card.headline}</Link>
              </h2>
              <p className="mt-2 font-mono text-[12.5px] leading-relaxed text-ink-soft">{card.lede}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
