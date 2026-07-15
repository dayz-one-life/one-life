import type { PlayerPage } from "@/lib/types";
import { absoluteUrl, profileLd } from "@/lib/seo";
import { playerSlug } from "@/lib/slug";
import { PlayerHero } from "./player-hero";
import { StandingCard } from "./standing-card";
import { PastLifeCard } from "./past-life-card";
import { PlayerPagination } from "./player-pagination";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-3 text-xs font-bold uppercase tracking-widest text-muted">
      <span>{children}</span>
      <span className="h-px flex-1 bg-line" />
    </h2>
  );
}

export function PlayerProfile({ page, now }: { page: PlayerPage; now: Date }) {
  const slug = playerSlug(page.gamertag);
  const aliveOrBanned = page.standing.filter((s) => s.state !== "idle");
  const ld = profileLd(page, absoluteUrl(`/players/${slug}`));
  return (
    <main className="mx-auto max-w-xl space-y-10 p-4 py-8 sm:p-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <PlayerHero page={page} />

      {aliveOrBanned.length > 0 && (
        <section className="space-y-4">
          <SectionHeading>Current standing</SectionHeading>
          {aliveOrBanned.map((s) => <StandingCard key={s.serverId} standing={s} now={now} pageGamertag={page.gamertag} />)}
        </section>
      )}

      {page.pastLivesTotal > 0 && (
        <section className="space-y-4">
          <SectionHeading>Past lives · {page.pastLivesTotal}</SectionHeading>
          {page.pastLives.map((l) => <PastLifeCard key={`${l.serverId}:${l.lifeId}`} life={l} now={now} />)}
          <PlayerPagination slug={slug} page={page.pastLivesPage} total={page.pastLivesTotal} pageSize={page.pastLivesPageSize} />
        </section>
      )}
    </main>
  );
}
