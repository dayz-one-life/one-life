import type { ReactNode } from "react";
import { ArticleBody } from "@/components/shared/article-body";
import { ArticleHero } from "@/components/shared/article-hero";
import { MoreFromTheDesk } from "./more-from-the-desk";
import { newsDateline } from "@/lib/news-format";
import { relativeDate } from "@/components/player/format";
import type { NewsArticle, NewsCard } from "@/lib/types";

/** Kicker for an editorial piece. Unknown formats title-case rather than throwing, so a format
 *  added by a future session renders sanely before anyone ships a label for it. */
export function editorialKicker(format: string | null): string {
  if (!format) return "THE DESK";
  return `THE ${format.replace(/[-_]/g, " ").toUpperCase()}`;
}

/**
 * The interior for an institutional editorial piece: no dossier, no status line, no timelines —
 * it has no subject to build them from. Prose, a pull quote, tags, and the related rail.
 */
export function EditorialArticleView({
  article, more, now,
}: {
  article: NewsArticle;
  more: NewsCard[];
  now: Date;
}): ReactNode {
  // An institutional piece usually has no map; the dateline files from the desk instead.
  const dateline = article.map
    ? newsDateline(article.map, article.createdAt, now)
    : `FROM THE DESK · ${relativeDate(article.createdAt, now)}`;

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10 md:px-10">
      {article.status === "draft" && (
        <p className="mb-5 border-[3px] border-red bg-red px-3 py-1.5 text-center font-display text-[13px] font-bold uppercase tracking-[.14em] text-paper">
          Draft — not published
        </p>
      )}
      {article.retracted && (
        <p className="mb-5 border-[3px] border-red px-3 py-1.5 text-center font-display text-[13px] font-bold uppercase tracking-[.14em] text-red-deep">
          Retracted
        </p>
      )}

      <div className="border-b-[3px] border-ink pb-5">
        <p className="font-mono text-[11px] uppercase tracking-[.06em] text-ink-muted">
          {editorialKicker(article.editorialFormat)} · {dateline}
        </p>
        <h1 className="mt-2 font-display text-5xl font-bold uppercase leading-[.92] text-ink md:text-6xl">
          {article.headline}
        </h1>
        {/* No GamertagLink: an institutional piece has no subject, and an empty link would
            resolve to /players/ and read as a real player who is not in the story. */}
        <p className="mt-3 font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
          Filed by The Desk
        </p>
      </div>

      {article.imageUrl && (
        <ArticleHero src={article.imageUrl} caption={article.imageCaption} accent="ink" />
      )}

      <p className="mt-6 font-display text-xl leading-snug text-ink">{article.lede}</p>

      <div className="mt-5">
        <ArticleBody blocks={article.bodyBlocks ?? null} fallback={article.body} />
      </div>

      {article.pullQuote && (
        <blockquote className="my-7 border-l-[5px] border-ink pl-5">
          <p className="font-display text-2xl uppercase leading-tight text-ink">{article.pullQuote.text}</p>
          <footer className="mt-2 font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
            — {article.pullQuote.attribution}
          </footer>
        </blockquote>
      )}

      {article.tags.length > 0 && (
        <ul className="mt-7 flex flex-wrap gap-2 border-t border-hairline pt-4">
          {article.tags.map((t) => (
            <li key={t} className="border border-ink px-2 py-0.5 font-mono text-[10px] uppercase tracking-[.06em] text-ink">
              {t}
            </li>
          ))}
        </ul>
      )}

      <MoreFromTheDesk rows={more} />
    </main>
  );
}
