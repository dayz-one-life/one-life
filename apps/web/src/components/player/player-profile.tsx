import Link from "next/link";
import type { PlayerPage } from "@/lib/types";
import { absoluteUrl, profileLd } from "@/lib/seo";
import { playerSlug } from "@/lib/slug";
import { PlayerHero } from "./player-hero";
import { StandingCard } from "./standing-card";
import { PastLifeCard } from "./past-life-card";
import { PlayerPagination } from "./player-pagination";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="font-display text-xl font-bold uppercase tracking-[.1em] text-ink">{children}</h2>;
}

export function PlayerProfile({ page, now }: { page: PlayerPage; now: Date }) {
  const slug = playerSlug(page.gamertag);
  const aliveOrBanned = page.standing.filter((s) => s.state !== "idle");
  const ld = profileLd(page, absoluteUrl(`/players/${slug}`));
  const funerals = `${page.pastLivesTotal} funeral${page.pastLivesTotal === 1 ? "" : "s"} on file`;

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10 md:px-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />

      <Link href="/survivors" className="font-mono text-[11px] uppercase tracking-[.06em] text-ink-muted hover:text-red">
        <span aria-hidden>← </span>Survivors
      </Link>

      <div className="mt-3">
        <PlayerHero page={page} />
      </div>

      {aliveOrBanned.length > 0 && (
        <section className="mt-7">
          <SectionHeading>Current standing</SectionHeading>
          <div className="mt-3 grid gap-5 md:grid-cols-2">
            {aliveOrBanned.map((s) => (
              <StandingCard key={s.serverId} standing={s} now={now} pageGamertag={page.gamertag} />
            ))}
          </div>
        </section>
      )}

      {page.pastLivesTotal > 0 && (
        <section className="mt-8">
          <SectionHeading>
            Past lives <span className="font-mono text-xs font-normal tracking-[.06em] text-ink-muted">· {funerals}</span>
          </SectionHeading>
          <div className="mt-3 grid gap-5 md:grid-cols-2">
            {page.pastLives.map((l) => (
              <PastLifeCard key={`${l.serverId}:${l.lifeId}`} life={l} now={now} gamertag={page.gamertag} />
            ))}
          </div>
          <div className="mt-5">
            <PlayerPagination slug={slug} page={page.pastLivesPage} total={page.pastLivesTotal} pageSize={page.pastLivesPageSize} />
          </div>
        </section>
      )}
    </main>
  );
}
