import type { PlayerPage } from "@/lib/types";
import { absoluteUrl, profileLd } from "@/lib/seo";
import { playerSlug } from "@/lib/slug";
import { PlayerHero } from "./player-hero";
import { StandingCard } from "./standing-card";
import { PastLifeCard } from "./past-life-card";

export function PlayerProfile({ page, now }: { page: PlayerPage; now: Date }) {
  const aliveOrBanned = page.standing.filter((s) => s.state !== "idle");
  const ld = profileLd(page, absoluteUrl(`/players/${playerSlug(page.gamertag)}`));
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <PlayerHero page={page} />

      {aliveOrBanned.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-bold uppercase tracking-wide text-muted">Current standing</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {aliveOrBanned.map((s) => <StandingCard key={s.serverId} standing={s} now={now} pageGamertag={page.gamertag} />)}
          </div>
        </section>
      )}

      {page.pastLives.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-bold uppercase tracking-wide text-muted">Past lives · {page.pastLives.length}</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {page.pastLives.map((l) => <PastLifeCard key={`${l.serverId}:${l.lifeId}`} life={l} />)}
          </div>
        </section>
      )}
    </main>
  );
}
