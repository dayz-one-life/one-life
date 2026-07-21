import Link from "next/link";
import type { PlayerPage, PlayerArticlesFeed } from "@/lib/types";
import { absoluteUrl, profileLd, ldScript } from "@/lib/seo";
import { playerSlug } from "@/lib/slug";
import { PlayerHero } from "./player-hero";
import { StandingCard } from "./standing-card";
import { PastLifeCard } from "./past-life-card";
import { PlayerPagination } from "./player-pagination";
import { InThePaper } from "./in-the-paper";
import { PaperPagination } from "./paper-pagination";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="font-display text-xl font-bold uppercase tracking-[.1em] text-ink">{children}</h2>;
}

export function PlayerProfile({
  page,
  now,
  articles,
  articlesFailed,
  articlesPage,
}: {
  page: PlayerPage;
  now: Date;
  /** null on a failed fetch — see `articlesFailed`. Never presented as an authoritative empty
   *  feed on failure (live-data honesty). */
  articles: PlayerArticlesFeed | null;
  articlesFailed: boolean;
  articlesPage: number;
}) {
  const slug = playerSlug(page.gamertag);
  const aliveOrBanned = page.standing.filter((s) => s.state !== "idle");
  const ld = profileLd(page, absoluteUrl(`/players/${slug}`));
  const funerals = `${page.pastLivesTotal} funeral${page.pastLivesTotal === 1 ? "" : "s"} on file`;
  const articleRows = articles?.rows ?? [];
  const articlesTotal = articles?.total ?? 0;
  const articlesPageSize = articles?.pageSize ?? 10;

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10 md:px-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldScript(ld) }} />

      <Link href="/survivors" className="font-mono text-[11px] uppercase tracking-[.06em] text-ink-muted hover:text-red">
        <span aria-hidden>← </span>Survivors
      </Link>

      <div className="mt-3">
        <PlayerHero page={page} />
      </div>

      {aliveOrBanned.length > 0 && (
        <section className="mt-7">
          <SectionHeading>Current standing</SectionHeading>
          <ul role="list" className="m-0 mt-3 grid list-none gap-5 p-0 md:grid-cols-2">
            {aliveOrBanned.map((s) => (
              <li key={s.serverId} className="grid">
                <StandingCard standing={s} now={now} pageGamertag={page.gamertag} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <InThePaper
        slug={slug}
        rows={articleRows}
        total={articlesTotal}
        page={articlesPage}
        pageSize={articlesPageSize}
        failed={articlesFailed}
      />
      {!articlesFailed && (
        <PaperPagination
          slug={slug}
          page={articlesPage}
          total={articlesTotal}
          pageSize={articlesPageSize}
          otherPage={page.pastLivesPage}
        />
      )}

      {page.pastLivesTotal > 0 && (
        <section className="mt-8">
          <SectionHeading>
            Past lives <span className="font-mono text-xs font-normal tracking-[.06em] text-ink-muted">· {funerals}</span>
          </SectionHeading>
          <ul role="list" className="m-0 mt-3 grid list-none gap-5 p-0 md:grid-cols-2">
            {page.pastLives.map((l) => (
              <li key={`${l.serverId}:${l.lifeId}`} className="grid">
                <PastLifeCard life={l} now={now} gamertag={page.gamertag} />
              </li>
            ))}
          </ul>
          <div className="mt-5">
            <PlayerPagination
              slug={slug}
              page={page.pastLivesPage}
              total={page.pastLivesTotal}
              pageSize={page.pastLivesPageSize}
              ap={articlesPage}
            />
          </div>
        </section>
      )}
    </main>
  );
}
