import type { ReactNode } from "react";
import Link from "next/link";
import { GamertagLink } from "@/components/gamertag-link";
import { RapSheet } from "./rap-sheet";
import { PullQuote } from "@/components/shared/pull-quote";
import { ArticleBody } from "@/components/shared/article-body";
import { MoreFromMorgue } from "./more-from-morgue";
import { Timeline } from "@/components/life/timeline";
import type { ObituaryArticle, ObituaryCard } from "@/lib/types";
import type { LifeTimelineView } from "@/lib/life-timeline";
import { dateline } from "@/lib/obituary-format";
import { mapLabel } from "@/components/player/format";
import { lifeHref } from "@/lib/life-href";
import { obituaryRoster } from "@/lib/article-roster";
import { linkifyGamertags } from "@/lib/linkify-gamertags";

export function ObituaryArticleView({
  article,
  more,
  finalReload,
  now,
}: {
  article: ObituaryArticle;
  more: ObituaryCard[];
  finalReload: LifeTimelineView | null;
  now: Date;
}): ReactNode {
  const roster = obituaryRoster(article);
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10 md:px-10">
      <div className="border-b-[3px] border-red pb-5">
        <p className="font-mono text-[11px] uppercase tracking-[.06em] text-red-deep">Obituary · {dateline(article.map, article.deathAt, now)}</p>
        <h1 className="mt-2 font-display text-5xl font-bold uppercase leading-[.92] text-ink md:text-6xl">{article.headline}</h1>
        <p className="mt-3 font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
          Filed by The Desk · A life of <GamertagLink gamertag={article.gamertag} className="font-bold text-ink underline" /> ·{" "}
          {article.mapSlug ? (
            <Link href={lifeHref(article.gamertag, article.mapSlug, article.lifeNumber)} className="font-bold text-ink underline">
              Life {article.lifeNumber}
            </Link>
          ) : (
            <>Life {article.lifeNumber}</>
          )}{" "}
          · {mapLabel(article.map)}
        </p>
      </div>

      <p className="mt-6 font-mono text-[15px] font-bold leading-relaxed text-ink">{linkifyGamertags(article.lede, roster)}</p>

      <div className="mt-5">
        <RapSheet article={article} />
      </div>

      {article.pullQuote && <PullQuote text={article.pullQuote.text} attribution={article.pullQuote.attribution} />}

      <ArticleBody blocks={article.bodyBlocks} fallback={article.body} className="mt-5" roster={roster} />

      {article.tags.length > 0 && (
        <p className="mt-6 flex flex-wrap gap-2">
          {article.tags.map((t) => (
            <span key={t} className="border border-dash px-2 py-1 font-mono text-[10px] uppercase tracking-[.06em] text-ink-muted">{t}</span>
          ))}
        </p>
      )}

      {finalReload && (
        <div className="mt-8">
          <Timeline view={finalReload} heading="The Final Reload" />
        </div>
      )}

      <MoreFromMorgue rows={more} />
    </main>
  );
}
