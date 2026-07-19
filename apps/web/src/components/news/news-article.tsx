import type { ReactNode } from "react";
import { GamertagLink } from "@/components/gamertag-link";
import { ArticleHero } from "@/components/shared/article-hero";
import { ArticleBody } from "@/components/shared/article-body";
import { PullQuote } from "@/components/shared/pull-quote";
import { Timeline } from "@/components/life/timeline";
import { NewsStatusLine } from "./news-status-line";
import { NewsDossier } from "./news-dossier";
import { MoreFromTheDesk } from "./more-from-the-desk";
import type { NewsArticle, NewsCard } from "@/lib/types";
import type { LifeTimelineView } from "@/lib/life-timeline";
import { newsDateline, triggerLabel } from "@/lib/news-format";
import { mapLabel } from "@/components/player/format";
import { cn } from "@/lib/utils";

/** One subject's record, already built by the route. The gamertag is carried alongside the view
 *  because two unlabelled parallel timelines are unreadable. */
export type NewsTimeline = { gamertag: string; view: LifeTimelineView };

/**
 * At most two records are embedded. A Long Form clique is a pair in every verified production
 * cluster, and beyond two the side-by-side comparison — the whole visual argument of the format —
 * stops being legible. A theoretical third subject is still named in the prose and the dossier's
 * subject count; only their timeline is omitted.
 */
export const NEWS_TIMELINE_LIMIT = 2;

export function NewsArticleView({
  article,
  more,
  timelines,
  now,
}: {
  article: NewsArticle;
  more: NewsCard[];
  timelines: NewsTimeline[];
  now: Date;
}): ReactNode {
  const shown = timelines.slice(0, NEWS_TIMELINE_LIMIT);
  // A Long Form piece labels every loaded timeline by its subject's callsign even when only one
  // of the (up to two) records loaded — the heading identifies WHO the record belongs to, which
  // still matters when the piece degrades. The side-by-side grid, in contrast, only makes sense
  // once there are actually two timelines to compare.
  const isLongForm = article.trigger === "long_form";
  const sideBySide = isLongForm && shown.length > 1;
  // The heading decision keys off actual multiplicity too, not just the trigger: a standing_dead
  // piece somehow handed two timelines must still label them by subject rather than rendering two
  // identically-headed "The Record So Far" blocks (the grid decision above is unaffected).
  const namedHeadings = isLongForm || shown.length > 1;

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10 md:px-10">
      <div className="border-b-[3px] border-ink pb-5">
        <p className="font-mono text-[11px] uppercase tracking-[.06em] text-ink-muted">
          {triggerLabel(article.trigger)} · {newsDateline(article.map, article.createdAt, now)}
        </p>
        <h1 className="mt-2 font-display text-5xl font-bold uppercase leading-[.92] text-ink md:text-6xl">{article.headline}</h1>
        <p className="mt-3 font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
          Filed by The Desk · <GamertagLink gamertag={article.gamertag} className="font-bold text-ink underline" /> · {mapLabel(article.map)}
        </p>
      </div>

      {/* A retracted piece never shows its photo: the media route serves bytes only for
          status='published', so the <img> would resolve to a 404 and render broken. The
          retraction banner is the honest replacement. */}
      {article.retracted ? (
        <p className="mt-6 border-[3px] border-red px-4 py-3 font-mono text-[11px] font-bold uppercase tracking-[.08em] text-red">
          Retracted — the subject acted, and this filing no longer describes the world.
        </p>
      ) : article.imageUrl ? (
        <ArticleHero src={article.imageUrl} caption={article.imageCaption} accent="ink" />
      ) : null}

      <p className="mt-6 font-mono text-[15px] font-bold leading-relaxed text-ink">{article.lede}</p>

      {/* Spec §4.1.3: computed at request time, never regenerated prose. Standing Dead only. */}
      {article.subjectStatus && <NewsStatusLine status={article.subjectStatus} />}

      <div className="mt-5">
        <NewsDossier article={article} />
      </div>

      {/* News is the first kind whose writer populates body_blocks; `blocks` takes precedence and
          a null/absent value falls back to splitting the flat body, byte-identically to every
          pre-R5d article. */}
      <ArticleBody blocks={article.bodyBlocks} fallback={article.body} className="mt-5" />

      {/* ONE pull quote, never two. PR-C2's schema admits a `quote` BLOCK (news-prompt.ts) and a
          standalone `pullQuote` independently, and nothing in the prompt discourages using both —
          a model that puts its best line in each ships two identical stacked blockquotes.
          ArticleBody already renders a `quote` block AS a PullQuote, so the standalone one is
          suppressed when the blocks carry one. Fixed render-side rather than at the writer or the
          read-model: it repairs rows already written, needs no change to frozen article data, and
          is reversible. */}
      {article.pullQuote && !article.bodyBlocks?.some((b) => b.type === "quote") && (
        <PullQuote text={article.pullQuote.text} attribution={article.pullQuote.attribution} />
      )}

      {article.tags.length > 0 && (
        <p className="mt-6 flex flex-wrap gap-2">
          {article.tags.map((t) => (
            <span key={t} className="border border-dash px-2 py-1 font-mono text-[10px] uppercase tracking-[.06em] text-ink-muted">{t}</span>
          ))}
        </p>
      )}

      {shown.length > 0 && (
        <div className={cn("mt-8", sideBySide && "grid gap-x-8 gap-y-6 lg:grid-cols-2 lg:divide-x lg:divide-hairline")}>
          {shown.map((t, i) => (
            <div key={`${t.gamertag}-${i}`} className={cn(sideBySide && i > 0 && "lg:pl-8")}>
              <Timeline
                view={t.view}
                heading={namedHeadings ? `${t.gamertag} — The Final Reload` : "The Record So Far"}
              />
            </div>
          ))}
        </div>
      )}

      <MoreFromTheDesk rows={more} />
    </main>
  );
}
