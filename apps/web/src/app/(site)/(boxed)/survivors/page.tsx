import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveDestinationSlug } from "@/lib/resolve-destination";

export const metadata: Metadata = {
  title: "Leaderboard",
  robots: { index: false }, // it is a redirect, and its destination is per-viewer anyway
};

/**
 * `/survivors` is a REDIRECT, not a board. It resolves where "here" is through the SAME rule
 * `/maps` uses — session memory → last map played → alphabetical by display label — so a player
 * who opens one and then the other lands on the same map.
 *
 * ⚠️ There is no combined board to fall back to. A life is per-server, so ranking across servers
 * would put lives in one race that were never in it. `/survivors/<slug>` is the real board, and
 * it is the stable, shareable, indexable URL.
 *
 * ⚠️ `redirect()` works by THROWING (`NEXT_REDIRECT`), so it must never sit inside a try/catch
 * around the fetches — the catch would swallow it and every visitor would get the error page.
 * The fetching and its error handling live in `resolveDestinationSlug`; the throw lives here.
 */
export default async function SurvivorsPage() {
  const slug = await resolveDestinationSlug();
  if (slug) redirect(`/survivors/${slug}`);

  // No slug to send anyone to. Guessing a path would 404, and an empty board would imply nobody
  // is alive — a claim about the game, which a failed fetch is not evidence for.
  return (
    <div className="mx-auto w-full max-w-[68ch] px-4 py-8">
      <h1 className="font-display text-3xl uppercase tracking-[.02em]">Leaderboard</h1>
      <p role="status" className="mt-6 font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
        Couldn&apos;t load the servers.{" "}
        <Link href="/" className="font-bold text-red-deep underline">
          Back to the front page
        </Link>
      </p>
    </div>
  );
}
