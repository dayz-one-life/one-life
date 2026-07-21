import type { ReactNode } from "react";
import Link from "next/link";
import { GamertagLink } from "@/components/gamertag-link";
import { PullQuote } from "@/components/shared/pull-quote";
import { ArticleBody } from "@/components/shared/article-body";
import { PriorsBox } from "./priors-box";
import { MoreFreshMeat } from "./more-fresh-meat";
import type { BirthNoticeArticle, BirthNoticeCard } from "@/lib/types";
import { birthDateline } from "@/lib/birth-format";
import { cn } from "@/lib/utils";
import { mapLabel } from "@/components/player/format";
import { lifeHref } from "@/lib/life-href";

export function BirthNoticeArticleView({
  article,
  more,
  now,
}: {
  article: BirthNoticeArticle;
  more: BirthNoticeCard[];
  now: Date;
}): ReactNode {
  // The §6 live status: recomputed at request time (packages/read-models/getBirthNoticeSubjectStatus),
  // never the frozen `article.endedAt` a subject who has since died would still read alive under.
  // Optional access: a response from a deploy predating this field (stale cache/CDN) would omit
  // `subjectStatus` entirely — treat that as "not dead", the same safe default as `{kind:"alive"}`.
  const dead = article.subjectStatus?.kind === "dead";
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10 md:px-10">
      <div className="border-b-[3px] border-blue pb-5">
        <p className="font-mono text-[11px] uppercase tracking-[.06em] text-blue">Birth Notice · {birthDateline(article.map, article.bornAt, now)}</p>
        <h1 className="mt-2 font-display text-5xl font-bold uppercase leading-[.92] text-ink md:text-6xl">{article.headline}</h1>
        <p className="mt-3 font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
          Filed by The Desk · <GamertagLink gamertag={article.gamertag} className="font-bold text-ink underline" /> ·{" "}
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

      <ArticleBody blocks={article.bodyBlocks} fallback={article.body} className="mt-6" />

      {article.pullQuote && <PullQuote text={article.pullQuote.text} attribution={article.pullQuote.attribution} />}

      <div className="mt-5">
        <PriorsBox article={article} />
      </div>

      {article.tags.length > 0 && (
        <p className="mt-6 flex flex-wrap gap-2">
          {article.tags.map((t) => (
            <span key={t} className="border border-dash px-2 py-1 font-mono text-[10px] uppercase tracking-[.06em] text-ink-muted">{t}</span>
          ))}
        </p>
      )}

      <p className={cn("mt-6 font-mono text-[11px] uppercase tracking-[.06em]", dead ? "text-red-deep" : "text-blue")}>
        {dead ? "Didn't last the day — already in the morgue." : "Still drawing breath — for now."}
      </p>

      <MoreFreshMeat rows={more} />
    </main>
  );
}
