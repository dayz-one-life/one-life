"use client";
import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { getNotifications, markNotificationsRead } from "@/lib/api";
import { useAccountStatus } from "@/lib/use-account-status";
import type { AppNotification, NotificationsFeed } from "@/lib/types";

export type Notifications = {
  items: AppNotification[];
  /** Page 1 only — the popover renders this slice and nothing deeper. */
  firstPage: AppNotification[];
  unreadCount: number;
  hasMore: boolean;
  loadMore: () => void;
  loadingMore: boolean;
  /** Signed in but no data yet. */
  loading: boolean;
  /** Failed with a cold cache — a warm cache keeps rendering rows instead. */
  error: boolean;
  refetch: () => void;
  markRead: (ids: number[]) => void;
};

/** One hook, one cache: the masthead bell mounts this globally (that's what makes the badge
 *  ambient) and the /notifications page shares the same ["notifications"] entry, so the inbox
 *  opens warm. */
export function useNotifications(): Notifications {
  const status = useAccountStatus();
  const signedIn = status.kind === "unlinked" || status.kind === "pending" || status.kind === "verified";
  const qc = useQueryClient();
  const query = useInfiniteQuery({
    queryKey: ["notifications"],
    queryFn: ({ pageParam }) => getNotifications(pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    enabled: signedIn,
    refetchInterval: 60_000,
  });
  const mark = useMutation({
    mutationFn: (ids: number[]) => markNotificationsRead(ids),
    // Stamp locally instead of invalidating: an invalidation refetches the open list and
    // visibly flattens the rows the user is reading. The 60s interval is the reconciler.
    // On failure: no stamp — the server still has the rows unread and the next refetch
    // re-surfaces them; the worst case is a badge that won't zero until a later success.
    onSuccess: (_data, ids) => {
      const idSet = new Set(ids);
      qc.setQueryData<InfiniteData<NotificationsFeed>>(["notifications"], (data) =>
        data && {
          ...data,
          pages: data.pages.map((p) => ({
            ...p,
            unreadCount: Math.max(0, p.unreadCount - ids.length),
            items: p.items.map((n) =>
              idSet.has(n.id) && !n.readAt ? { ...n, readAt: new Date().toISOString() } : n,
            ),
          })),
        },
      );
    },
  });
  const pages = query.data?.pages ?? [];
  return {
    items: pages.flatMap((p) => p.items),
    firstPage: pages[0]?.items ?? [],
    // Whole-inbox figure on every page; the freshest is the last one fetched.
    unreadCount: pages[pages.length - 1]?.unreadCount ?? 0,
    hasMore: query.hasNextPage,
    loadMore: () => void query.fetchNextPage(),
    loadingMore: query.isFetchingNextPage,
    loading: signedIn && query.isPending,
    error: query.isError && !query.data,
    refetch: () => void query.refetch(),
    markRead: (ids) => mark.mutate(ids),
  };
}

/** Frozen-tint + at-most-once reporting for one surface session (spec §5.2–5.3). While
 *  `active`, every rendered unread row is reported read exactly once, and its id joins the
 *  returned set — the row keeps its unread look even after the cache stamps `readAt`.
 *  Deactivating (popover close) ends the session and empties the set; `sent` persists for
 *  the component lifetime so a row is never reported twice. */
export function useNotificationSeen(
  items: AppNotification[],
  active: boolean,
  markRead: (ids: number[]) => void,
): Set<number> {
  const sent = useRef<Set<number>>(new Set());
  const [initiallyUnread, setInitiallyUnread] = useState<Set<number>>(new Set());
  // Call sites pass inline arrows; keep the latest in a ref so the effect depends on data only.
  const markRef = useRef(markRead);
  useEffect(() => {
    markRef.current = markRead;
  });
  useEffect(() => {
    if (!active) {
      setInitiallyUnread((prev) => (prev.size ? new Set<number>() : prev));
      return;
    }
    const fresh = items.filter((n) => !n.readAt && !sent.current.has(n.id)).map((n) => n.id);
    if (fresh.length === 0) return;
    for (const id of fresh) sent.current.add(id);
    setInitiallyUnread((prev) => new Set([...prev, ...fresh]));
    markRef.current(fresh);
  }, [active, items]);
  return initiallyUnread;
}
