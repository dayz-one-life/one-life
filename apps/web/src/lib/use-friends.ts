"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError, getFriends, getFriendStatus,
  sendFriendRequest, acceptFriendRequest, declineFriendRequest, deleteFriendship,
} from "@/lib/api";
import { useAccountStatus } from "@/lib/use-account-status";
import type { FriendsFeed, FriendStatusDto } from "@/lib/types";

function useSignedIn(): boolean {
  const status = useAccountStatus();
  return status.kind === "unlinked" || status.kind === "pending" || status.kind === "verified";
}

/** Only a verified user can hold a friendship, so the control never fetches for anyone else. */
function useVerified(): boolean {
  return useAccountStatus().kind === "verified";
}

/**
 * The viewer's relationship with one player. Deliberately its own query rather than a
 * field on the player page: getPlayerPage is a public, viewer-independent read-model
 * feeding a cached SSR page and the OG card (spec §5.4).
 */
export function useFriendStatus(gamertag: string | null): {
  data: FriendStatusDto | null; loading: boolean; error: boolean;
} {
  const enabled = useVerified() && !!gamertag;
  const q = useQuery({
    queryKey: ["friend-status", gamertag],
    queryFn: () => getFriendStatus(gamertag as string),
    enabled,
  });
  return {
    data: q.data ?? null,
    loading: enabled && q.isPending,
    // A warm cache keeps rendering; only a cold failure is an error state.
    error: q.isError && !q.data,
  };
}

export function useFriends(): { data: FriendsFeed | null; loading: boolean; error: boolean } {
  const enabled = useSignedIn();
  const q = useQuery({ queryKey: ["friends"], queryFn: () => getFriends(), enabled, refetchInterval: 60_000 });
  return { data: q.data ?? null, loading: enabled && q.isPending, error: q.isError && !q.data };
}

/**
 * Every mutation invalidates BOTH ["friends"] and ["friend-status"] — the roster page and
 * any mounted profile control describe the same relationship and must never disagree.
 * Same discipline as SelfUnbanButton invalidating ["tokens"] + ["player-page"].
 */
export function useFriendActions() {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["friends"] });
    void qc.invalidateQueries({ queryKey: ["friend-status"] });
  };
  const opts = { onSuccess: invalidate };

  const send = useMutation({ mutationFn: (gamertag: string) => sendFriendRequest(gamertag), ...opts });
  const acc = useMutation({ mutationFn: (id: number) => acceptFriendRequest(id), ...opts });
  const dec = useMutation({ mutationFn: (id: number) => declineFriendRequest(id), ...opts });
  const del = useMutation({ mutationFn: (id: number) => deleteFriendship(id), ...opts });
  const all = [send, acc, dec, del];
  const failed = all.find((m) => m.isError);

  return {
    sendRequest: (gamertag: string) => send.mutate(gamertag),
    acceptRequest: (id: number) => acc.mutate(id),
    declineRequest: (id: number) => dec.mutate(id),
    removeFriend: (id: number) => del.mutate(id),
    pending: all.some((m) => m.isPending),
    errorCode: failed?.error instanceof ApiError ? failed.error.code : (failed ? "http_error" : null),
  };
}
