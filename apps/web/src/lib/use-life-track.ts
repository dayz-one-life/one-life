"use client";
import { useQuery } from "@tanstack/react-query";
import { getLifeTrack, ApiError } from "./api";
import type { LifeTrack } from "./types";

/**
 * Lifted out for direct unit testing (the repo convention — see `isOwnerOf` in
 * `location-panel.tsx`) rather than exercised only through react-query's actual timers.
 *
 * `alivePropFallback` is only the server-rendered PAGE's snapshot at the time the page
 * was built — it goes stale the instant THIS life ends mid-poll. Once a fetch has
 * actually resolved, the fetched `LifeTrack.alive` (or the fact that the fetch resolved
 * to `null`, meaning the server told us we are not the owner) is authoritative and wins;
 * the prop is used only to decide whether to poll at all BEFORE the first fetch resolves.
 */
export function pollIntervalFor(data: LifeTrack | null | undefined, alivePropFallback: boolean): number | false {
  if (data === undefined) return alivePropFallback ? 60_000 : false;
  if (data === null) return false; // resolved not-owner — nothing left to keep polling for
  return data.alive ? 60_000 : false;
}

/**
 * `enabled` is the client-side owner guess and is a UX optimisation ONLY — it decides
 * whether to make a request that would otherwise 403. The real gate is the API route,
 * which derives the subject from the session cookie. Never treat this flag as security.
 *
 * The 60s poll matches useNotifications, not the 5s verification poll: nobody is sitting
 * and waiting on a position fix, and the underlying data only advances when the game
 * server writes a new ADM line.
 */
export function useLifeTrack(mapSlug: string, n: number, enabled: boolean, alive: boolean) {
  return useQuery({
    queryKey: ["life-track", mapSlug, n],
    queryFn: async () => {
      try {
        return await getLifeTrack(mapSlug, n);
      } catch (e) {
        if (e instanceof ApiError && e.status === 403) return null;
        throw e;
      }
    },
    enabled,
    refetchInterval: (query) => pollIntervalFor(query.state.data, alive),
  });
}
