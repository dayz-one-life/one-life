import { getBlocks } from "@/lib/api";

/**
 * Has THIS request's viewer blocked `gamertag`?
 *
 * ⚠️ The page-layer counterpart to the read-models' `avatarOwnerNotBlockedBy` predicate, and it
 * exists for the surfaces that predicate deliberately cannot reach. `getLifeTimeline` is excluded
 * from it because apps/web also serves that payload through the cookie-free `getOrNullCached`
 * (the obituary page) — a shared, prerender-feeding response. Threading a viewer's block list
 * into it would leak one user's blocks into another user's page. So the payload stays
 * viewer-independent and the BLOCK IS APPLIED HERE, per request, where the viewer is known.
 *
 * `getBlocks()` goes through the cookie-forwarding, `no-store` transport, so this is a
 * per-request read of the caller's own list and nothing else.
 *
 * ⚠️ NEVER call this from an `opengraph-image` route or anything else whose output is shared
 * across viewers. Viewer-scoped hiding belongs only where the response is viewer-scoped.
 *
 * A signed-out visitor blocks nobody: `getBlocks()` 401s for them (and can fail for any other
 * reason), and a failure to answer must never take the page down — it degrades to `false`.
 */
export async function viewerHasBlocked(gamertag: string): Promise<boolean> {
  try {
    const { blocks } = await getBlocks();
    // Case-insensitive, like every other gamertag comparison here: the block snapshots the
    // canonical casing at block time and the page's gamertag can differ by a later rename.
    const want = gamertag.trim().toLowerCase();
    return blocks.some((b) => b.gamertag.trim().toLowerCase() === want);
  } catch {
    return false;
  }
}
