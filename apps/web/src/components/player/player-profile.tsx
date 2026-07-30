import Link from "next/link";
import type { PlayerPage } from "@/lib/types";
import { absoluteUrl, profileLd, ldScript } from "@/lib/seo";
import { playerSlug } from "@/lib/slug";
import { TicketStage } from "./ticket-stage";
import { Morgue } from "./morgue";
import { FriendButton } from "./friend-button";
import { Stat } from "./stat";
import { heroStats, monthYear } from "./format";

/**
 * The public dossier. The SAME stage the owner sees at `/`, with every owner affordance removed
 * (no pencil, no spend, no invite link) — `viewer="public"` is the single switch, so the two pages
 * cannot drift apart. `/players/{me}` 307s here's owner back to `/`.
 *
 * ⚠️ No horizontal padding on `<main>`. Every section below the stage runs the full width of the
 * page column and states its own `px-6 md:px-10`, so they measure exactly as the stage does. A
 * padded wrapper is what made the slabs read narrower than the hero during the design.
 */
export function PlayerProfile({ page, now }: { page: PlayerPage; now: Date }) {
  const slug = playerSlug(page.gamertag);
  const ld = profileLd(page, absoluteUrl(`/players/${slug}`));
  const stats = heroStats(page.totals);

  return (
    <main className="mx-auto w-full max-w-5xl pb-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldScript(ld) }} />

      {/* ⚠️ This strip is `bg-dark` and butts straight against the masthead (no top padding on
       *  `<main>`) ON PURPOSE. It sits between two dark surfaces — the masthead above and the
       *  stage below — so a light back-link left a white bar band across the top of the page.
       *  Dark link tokens, not `text-ink-muted`, for the same reason. */}
      <div className="bg-dark px-6 pb-3 pt-6 md:px-10">
        <Link
          href="/survivors"
          className="font-mono text-[11px] uppercase tracking-[.06em] text-cream-muted hover:text-paper"
        >
          <span aria-hidden>← </span>Survivors
        </Link>
      </div>

      <TicketStage page={page} viewer="public" now={now} />

      <section className="px-6 py-7 md:px-10">
        {page.firstSeenAt && (
          <p className="font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
            First seen {monthYear(page.firstSeenAt)}
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-end justify-between gap-x-9 gap-y-5">
          <div className="grid grid-cols-2 gap-y-4 sm:flex sm:gap-x-9">
            {stats.map((st) => (
              <Stat key={st.label} value={st.value} label={st.label} size="lg" hot={st.hot} />
            ))}
          </div>
          {page.verified && <FriendButton gamertag={page.gamertag} />}
        </div>
      </section>

      <Morgue
        entries={page.obituaries}
        total={page.obituariesTotal}
        viewer="public"
        state="ready"
        playerSlug={slug}
        now={now}
      />
    </main>
  );
}
