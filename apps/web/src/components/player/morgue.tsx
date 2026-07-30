import Link from "next/link";
import type { ObituaryEntry } from "@/lib/types";
import { cn } from "@/lib/utils";
import { lifeHrefBySlug } from "@/lib/life-href";
import { obituaryHref, dateline, rapSheetFacts } from "@/lib/obituary-format";
import type { Viewer } from "./ticket-stage";

/* ══════════════════════ the morgue — this player's obituaries ══════════════════════
 * Replaces the `PastLifeCard` grid. Each entry leads with the OBITUARY HEADLINE, linked to the
 * full article at `/obituaries/{slug}`; the timeline moves to its own button. This is where every
 * route into a life lives — the tickets on the stage carry only their own.
 *
 * ⚠️ THIS SECTION LISTS FILED OBITUARIES ONLY (Steve, 2026-07-30 — asked for explicitly after the
 * alternative was put to him). `apps/newsdesk` files one only for a QUALIFIED death, only past the
 * forward-only `NEWSDESK_SINCE` cutoff, and it can fail permanently at `NEWSDESK_MAX_ATTEMPTS`, so
 * the list is a strict SUBSET of the player's lives and unfiled lives appear nowhere on this page.
 * That is the intended behavior — do not "restore" the missing lives.
 *
 * ⚠️ Its consequence is that ZERO IS A REAL AND COMMON STATE — a player with eleven dead lives and
 * no filed obituary renders an empty section. It gets an explicit empty render, never a bare
 * heading over nothing, and never a count that implies the lives are missing.
 *
 * ⚠️ `state` is what keeps LOADING, FAILED and EMPTY three different renders. `entries.length === 0`
 * alone cannot tell "nothing filed" from "the fetch died", and asserting "no obituary has been
 * filed" over a failed fetch is a lie about the player's own history.
 *
 * ⚠️ The heading count is FILED OBITUARIES, not lives. "11 lives filed" read as a life count while
 * showing 2 rows; it is now unambiguous — and it is withheld entirely until the fetch resolves.
 */
export function Morgue({
  entries,
  total,
  viewer,
  state,
  playerSlug,
  now,
}: {
  entries: ObituaryEntry[];
  total: number;
  viewer: Viewer;
  state: "ready" | "loading" | "failed";
  playerSlug: string;
  now: Date;
}) {
  const owner = viewer === "owner";
  return (
    <section className="px-6 py-10 md:px-10 md:py-12">
      <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1 border-b-2 border-ink pb-3">
        <h2 className="font-display text-2xl font-bold uppercase tracking-[.06em] text-ink md:text-3xl">
          {owner ? "Your obituaries" : "Obituaries"}
        </h2>
        {state === "ready" && (
          <p className="font-mono text-[11px] uppercase tracking-[.14em] text-ink-muted">
            <span className="font-display text-xl font-bold tabular-nums text-ink">{total}</span>{" "}
            {total === 1 ? "obituary filed" : "obituaries filed"}
          </p>
        )}
      </div>

      {state === "loading" && (
        <p
          role="status"
          className="border-b border-hairline py-8 font-mono text-[11px] uppercase tracking-[.06em] text-ink-muted motion-safe:animate-pulse"
        >
          Opening the file…
        </p>
      )}

      {state === "failed" && (
        <p className="border-b border-hairline py-8 font-sans text-base leading-relaxed text-ink-soft">
          Couldn&apos;t load the obituaries just now. They are still on file — try again in a moment.
        </p>
      )}

      {state === "ready" && entries.length === 0 && (
        <p className="border-b border-hairline py-8 font-sans text-base leading-relaxed text-ink-soft">
          {owner
            ? "No obituary has been filed for you yet. One is written for every qualified life that ends — survive long enough to qualify, then don't."
            : "No obituary has been filed for this survivor yet."}
        </p>
      )}

      {state === "ready" && entries.length > 0 && (
        <ul role="list" className="flex flex-col">
          {entries.map((e) => (
            <li key={`${e.mapSlug}-${e.lifeNumber}`} className="border-b border-hairline py-6">
              <p className="font-mono text-[11px] uppercase tracking-[.06em] text-ink-muted">
                {dateline(e.map, e.deathAt, now)}
              </p>
              <h3 className="mt-1.5 font-display text-2xl font-bold uppercase leading-[.95] text-ink md:text-3xl">
                <Link href={obituaryHref(e.slug)} className="hover:text-red">
                  {e.headline}
                </Link>
              </h3>
              {e.lede && (
                <p className="mt-2 max-w-2xl font-mono text-[13px] leading-relaxed text-ink-soft">{e.lede}</p>
              )}
              <div className="mt-3.5 flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
                  {rapSheetFacts(e).map((f) => (
                    <span key={f.label} className="font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
                      {f.label}{" "}
                      <span className={cn("font-bold", f.hot ? "text-red-deep" : "text-ink")}>{f.value}</span>
                    </span>
                  ))}
                </div>
                <Link
                  href={lifeHrefBySlug(playerSlug, e.mapSlug, e.lifeNumber)}
                  className="flex min-h-[44px] flex-none items-center border-2 border-ink bg-white px-4 font-mono text-[10px] uppercase tracking-[.1em] text-ink hover:bg-ink hover:text-paper"
                >
                  Timeline <span aria-hidden className="ml-1.5">→</span>
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
