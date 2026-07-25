import { cookies } from "next/headers";
import { getLastPlayedMap, getServers } from "@/lib/api";
import { SESSION_MAP_COOKIE, resolveMapDestination } from "@/lib/map-resolution";

/**
 * Server-side half of the one resolution rule, shared by `/maps` and `/survivors` so the two bare
 * paths can never drift apart.
 *
 * Returns `null` when there is nowhere to send anyone — either the fleet has no slugged server or
 * the servers fetch failed. The caller renders an honest failure and MUST NOT guess a path.
 *
 * ⚠️ The servers fetch is the only hard dependency. `getLastPlayedMap` failing is a lost TIER, not
 * a lost resolution: it degrades to session memory → alphabetical, which is exactly what a
 * signed-out viewer gets anyway. Wrapping both in one try/catch would let a per-viewer hint take
 * down a public redirect.
 *
 * ⚠️ A remembered slug is NEVER trusted without the live list to check it against, and the
 * API-outage path is not an exception: redirecting on a raw cookie sends a returning visitor to a
 * slug that during an outage renders a broken page anyway. Resolve ONLY when we have the list.
 */
export async function resolveDestinationSlug(): Promise<string | null> {
  const session = (await cookies()).get(SESSION_MAP_COOKIE)?.value ?? null;

  let servers;
  try {
    servers = await getServers();
  } catch {
    return null;
  }

  let lastPlayed: string | null = null;
  try {
    lastPlayed = (await getLastPlayedMap()).slug;
  } catch {
    lastPlayed = null;
  }

  return resolveMapDestination(servers, { session, lastPlayed });
}
