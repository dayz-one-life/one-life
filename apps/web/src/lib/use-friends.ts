"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError, getFriends, getFriendStatus,
  sendFriendRequest, acceptFriendRequest, declineFriendRequest, deleteFriendship,
  patchFriendPresence, patchPreferences,
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

/**
 * `page` scopes only the server-paginated `friends` list (`FriendsFeed.friends`) — `incoming`/
 * `outgoing` are always returned whole regardless of `page`. Invalidating the bare `["friends"]`
 * key (see useFriendActions below) still catches every page: TanStack Query's default
 * `exact: false` matches any query key with that prefix, including `["friends", page]`.
 */
export function useFriends(page = 1): { data: FriendsFeed | null; loading: boolean; error: boolean } {
  const enabled = useSignedIn();
  const q = useQuery({
    queryKey: ["friends", page],
    queryFn: () => getFriends(page),
    enabled,
    refetchInterval: 60_000,
  });
  return { data: q.data ?? null, loading: enabled && q.isPending, error: q.isError && !q.data };
}

/**
 * Every mutation invalidates BOTH ["friends"] and ["friend-status"] — the roster page and
 * any mounted profile control describe the same relationship and must never disagree.
 * Same discipline as SelfUnbanButton invalidating ["tokens"] + ["player-page"].
 */
type FriendAction = "send" | "accept" | "decline" | "remove" | "presence" | "master"
  | "location" | "masterLocation";

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
  const pres = useMutation({
    mutationFn: (v: { id: number; share?: boolean; notify?: boolean }) =>
      patchFriendPresence(v.id, { share: v.share, notify: v.notify }),
    ...opts,
  });
  const master = useMutation({
    mutationFn: (sharePresence: boolean) => patchPreferences({ sharePresence }),
    ...opts,
  });
  const loc = useMutation({
    mutationFn: (v: { id: number; share: boolean }) =>
      patchFriendPresence(v.id, { shareLocation: v.share }),
    ...opts,
  });
  const masterLoc = useMutation({
    mutationFn: (shareLocation: boolean) => patchPreferences({ shareLocation }),
    ...opts,
  });
  const all = [send, acc, dec, del, pres, master, loc, masterLoc];

  // errorCode must describe only the most recently invoked action — TanStack Query does
  // not clear one mutation's isError when a *different* mutation succeeds, so without this
  // tracking a stale failure from an earlier action would outlive a later, successful one.
  const [lastAction, setLastAction] = useState<FriendAction | null>(null);
  const lastMutation = lastAction === "send" ? send
    : lastAction === "accept" ? acc
    : lastAction === "decline" ? dec
    : lastAction === "remove" ? del
    : lastAction === "presence" ? pres
    : lastAction === "master" ? master
    : lastAction === "location" ? loc
    : lastAction === "masterLocation" ? masterLoc
    : null;
  const failed = lastMutation?.isError ? lastMutation : undefined;

  // Callers that need to know the OUTCOME of a specific invocation (not just the trailing
  // errorCode above, which describes only the most recently invoked action and can be
  // stomped by a second call before the first settles) pass onSettled. It fires once, from
  // the mutation's own onSuccess/onError — never synchronously at call time — so a caller
  // can never announce success before the mutation has actually resolved.
  type Settled = (ok: boolean, errorCode: string | null) => void;
  const codeOf = (err: unknown) => (err instanceof ApiError ? err.code : "http_error");

  return {
    sendRequest: (gamertag: string, onSettled?: Settled) => {
      setLastAction("send");
      send.mutate(gamertag, {
        onSuccess: () => onSettled?.(true, null),
        onError: (err) => onSettled?.(false, codeOf(err)),
      });
    },
    acceptRequest: (id: number, onSettled?: Settled) => {
      setLastAction("accept");
      acc.mutate(id, {
        onSuccess: () => onSettled?.(true, null),
        onError: (err) => onSettled?.(false, codeOf(err)),
      });
    },
    declineRequest: (id: number, onSettled?: Settled) => {
      setLastAction("decline");
      dec.mutate(id, {
        onSuccess: () => onSettled?.(true, null),
        onError: (err) => onSettled?.(false, codeOf(err)),
      });
    },
    removeFriend: (id: number, onSettled?: Settled) => {
      setLastAction("remove");
      del.mutate(id, {
        onSuccess: () => onSettled?.(true, null),
        onError: (err) => onSettled?.(false, codeOf(err)),
      });
    },
    setPresence: (
      id: number, body: { share?: boolean; notify?: boolean }, onSettled?: Settled,
    ) => {
      setLastAction("presence");
      pres.mutate({ id, ...body }, {
        onSuccess: () => onSettled?.(true, null),
        onError: (err) => onSettled?.(false, codeOf(err)),
      });
    },
    setSharePresence: (value: boolean, onSettled?: Settled) => {
      setLastAction("master");
      master.mutate(value, {
        onSuccess: () => onSettled?.(true, null),
        onError: (err) => onSettled?.(false, codeOf(err)),
      });
    },
    setLocation: (id: number, share: boolean, onSettled?: Settled) => {
      setLastAction("location");
      loc.mutate({ id, share }, {
        onSuccess: () => onSettled?.(true, null),
        onError: (err) => onSettled?.(false, codeOf(err)),
      });
    },
    setShareLocation: (value: boolean, onSettled?: Settled) => {
      setLastAction("masterLocation");
      masterLoc.mutate(value, {
        onSuccess: () => onSettled?.(true, null),
        onError: (err) => onSettled?.(false, codeOf(err)),
      });
    },
    pending: all.some((m) => m.isPending),
    errorCode: failed?.error instanceof ApiError ? failed.error.code : (failed ? "http_error" : null),
  };
}
