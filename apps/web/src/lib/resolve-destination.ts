import { cookies } from "next/headers";
import { getLastPlayedMap, getServers } from "@/lib/api";
import { SESSION_MAP_COOKIE, resolveMapDestination, type SluggedServer } from "@/lib/map-resolution";

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
  let servers;
  try {
    servers = await getServers();
  } catch {
    return null;
  }
  return resolveDestinationFrom(servers);
}

/**
 * The same rule against a server list the caller ALREADY has.
 *
 * Home fetches `/servers` for the How-to-connect panel and would otherwise fetch it a second time
 * just to resolve its board strip. A `null` list means the caller's own fetch failed — treated
 * exactly like ours failing, i.e. no destination.
 */
export async function resolveDestinationFrom(
  servers: readonly SluggedServer[] | null,
): Promise<string | null> {
  if (!servers) return null;
  const session = (await cookies()).get(SESSION_MAP_COOKIE)?.value ?? null;

  let lastPlayed: string | null = null;
  try {
    lastPlayed = (await getLastPlayedMap()).slug;
  } catch {
    lastPlayed = null;
  }

  return resolveMapDestination(servers, { session, lastPlayed });
}
