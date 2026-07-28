import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveDestinationSlug } from "@/lib/resolve-destination";

export const metadata: Metadata = {
  title: "Maps",
  robots: { index: false }, // it is a redirect, and its destination is per-viewer anyway
};

/**
 * `/maps` is a REDIRECT, not a page. It resolves where "here" actually is through the one shared
 * rule (`resolveDestinationSlug`) — session memory → last map played → alphabetical by label —
 * the same rule `/survivors` uses, so opening one and then the other lands on the same map.
 *
 * ⚠️ `redirect()` works by THROWING (`NEXT_REDIRECT`), so it must never sit inside a try/catch
 * around the fetches — the catch would swallow it and every visitor would get the error page.
 * The fetching and its error handling live in `resolveDestinationSlug`; the throw lives here.
 */
export default async function MapsPage() {
  const slug = await resolveDestinationSlug();
  if (slug) redirect(`/maps/${slug}`);

  // No slug to send anyone to. Guessing a path would 404, and an empty page would imply the maps
  // do not exist — so say which of the two it is.
  return (
    <div className="mx-auto w-full max-w-[68ch] px-4 py-8">
      <h1 className="font-display text-3xl uppercase tracking-[.02em]">Maps</h1>
      <p role="status" className="mt-6 font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
        Couldn&apos;t load the maps.{" "}
        <Link href="/" className="font-bold text-red-deep underline">
          Back to the front page
        </Link>
      </p>
    </div>
  );
}
