import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getServers } from "@/lib/api";
import { LAST_MAP_COOKIE, resolveMapSlug } from "@/lib/last-map";
import type { Server } from "@/lib/types";

export const metadata: Metadata = {
  title: "Maps",
  robots: { index: false }, // it is a redirect, and its destination is per-viewer anyway
};

/**
 * `/maps` is a REDIRECT, not a page. The nav's Maps item points here and this resolves where
 * "here" actually is: the map you last opened, else Chernarus, else whatever server exists.
 * (It replaced a picker page — the switcher inside the map shell covers that job.)
 *
 * ⚠️ It stays inside the (site) route group even though it normally renders nothing, because
 * the one path that DOES render — no slug to redirect to — needs the masthead, a way back, and
 * the light surface its tokens are written in. Only `/maps/[map]`, the tool itself, opts out.
 */
export default async function MapsPage() {
  const remembered = (await cookies()).get(LAST_MAP_COOKIE)?.value ?? null;

  let servers: Server[] | null = null;
  try {
    servers = await getServers();
  } catch {
    servers = null;
  }

  // ⚠️ A remembered slug is NEVER trusted without the live list to check it against — that is the
  // whole invariant, and the API-outage path is not an exception to it. Redirecting on the raw
  // cookie would send a returning visitor to `/maps/<stale>`, which during an outage renders a
  // broken map card anyway (the map page fetches `/servers` too); the honest fallback below is no
  // worse and does not pretend the slug is good. So we resolve ONLY when we have the list.
  //
  // ⚠️ `redirect()` works by THROWING (NEXT_REDIRECT), so it must stay outside the try above —
  // inside it, the catch would swallow the redirect and every visitor would get the error page.
  const slug = servers ? resolveMapSlug(servers, remembered) : null;
  if (slug) redirect(`/maps/${slug}`);

  // No slug to send anyone to. Guessing a path would 404, and an empty page would imply the
  // maps do not exist — so say which of the two it is.
  return (
    <div className="mx-auto max-w-[68ch] px-4 py-8">
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
