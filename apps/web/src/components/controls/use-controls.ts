"use client";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccountStatus } from "@/lib/use-account-status";
import { useCancelLink, useClaimGamertag } from "@/lib/use-gamertag-links";
import { getMe, getNotifications, getPlayerPage, getServers, getTokens, markNotificationsRead, redeemToken, setReferrer, transferToken } from "@/lib/api";
import { playerSlug } from "@/lib/slug";
import type { AccountStatus } from "@/lib/account-status";
import type { AppNotification, Server, ServerStanding } from "@/lib/types";

export type Controls = {
  status: AccountStatus;
  name: string | null;
  provider: string | null;
  balance: number | null;
  servers: Server[];
  standing: ServerStanding[];
  notifications: AppNotification[];
  unreadCount: number;
  /** True while unloaded older pages remain. Drives the panel's "Load older" control — the
   *  only way a backlog deeper than one page is reachable, and therefore the only way a
   *  user with more than pageSize unread can ever get the badge to zero. */
  hasMore: boolean;
  loadMore: () => void;
  loadingMore: boolean;
};

/** One data source for all three control surfaces (rail, pill, sheet). */
export function useControls(): Controls {
  const status = useAccountStatus();
  const signedIn = status.kind === "unlinked" || status.kind === "pending" || status.kind === "verified";
  const me = useQuery({ queryKey: ["me"], queryFn: getMe, enabled: signedIn, staleTime: 60_000 });
  const tokens = useQuery({ queryKey: ["tokens"], queryFn: getTokens, enabled: signedIn });
  const servers = useQuery({ queryKey: ["servers"], queryFn: getServers, enabled: signedIn, staleTime: 5 * 60_000 });
  const gamertag = status.kind === "verified" ? status.link.gamertag : null;
  const player = useQuery({
    queryKey: ["player-page", gamertag],
    queryFn: () => getPlayerPage(playerSlug(gamertag!)),
    enabled: gamertag !== null,
    refetchInterval: 60_000, // ban countdowns tick once a minute
  });
  // Infinite rather than a plain query so the older pages are reachable at all. Every loaded
  // page stays loaded and refetches together on invalidation, so marking a page read updates
  // the rows already on screen instead of collapsing the list back to page 1.
  const notifications = useInfiniteQuery({
    queryKey: ["notifications"],
    queryFn: ({ pageParam }) => getNotifications(pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
    enabled: signedIn,
    refetchInterval: 60_000,
  });
  const pages = notifications.data?.pages ?? [];
  return {
    status,
    name: me.data?.user.name || me.data?.user.email?.split("@")[0] || null,
    provider: me.data?.accounts[0]?.providerId ?? null,
    balance: tokens.data?.balance ?? null,
    servers: servers.data ?? [],
    standing: player.data?.standing ?? [],
    notifications: pages.flatMap((p) => p.items),
    // The badge counts the whole inbox, so any loaded page carries the same figure; the
    // freshest is the last one fetched.
    unreadCount: pages[pages.length - 1]?.unreadCount ?? 0,
    hasMore: notifications.hasNextPage,
    loadMore: () => void notifications.fetchNextPage(),
    loadingMore: notifications.isFetchingNextPage,
  };
}

/** The mutations behind the rail/sheet controls, shared so both surfaces stay in sync. */
export function useControlsActions() {
  const qc = useQueryClient();
  const claim = useClaimGamertag();
  const cancel = useCancelLink();
  const send = useMutation({
    mutationFn: (gt: string) => transferToken(gt),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["tokens"] }),
  });
  const refer = useMutation({ mutationFn: (gt: string) => setReferrer(gt) });
  const redeem = useMutation({
    mutationFn: (banId: number) => redeemToken(banId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tokens"] });
      void qc.invalidateQueries({ queryKey: ["player-page"] });
    },
  });
  const markRead = useMutation({
    mutationFn: (ids: number[]) => markNotificationsRead(ids),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
  return { claim, cancel, send, refer, redeem, markRead };
}
