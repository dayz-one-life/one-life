// apps/web/src/lib/use-life-track.ts
"use client";
import { useQuery } from "@tanstack/react-query";
import { getLifeTrack, ApiError } from "./api";

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
    refetchInterval: alive ? 60_000 : false,
  });
}
