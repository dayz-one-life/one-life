# Notifications Convention Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move notifications from the account-controls surface to the platform convention: a masthead bell with badge (popover on desktop, link on mobile), a permanent `/notifications` inbox page, and a frozen-tint read-state model.

**Architecture:** A new `useNotifications()` hook owns the shared `["notifications"]` infinite query + mark-read mutation (local `setQueryData` stamp, no invalidation). Props-only `NotificationRow`/`NotificationList` render in both a dark masthead popover and the light `/notifications` page. The rail/sheet drop their notifications panel entirely; `PushToggle` moves to the page and loses `onDark`.

**Tech Stack:** Next.js App Router, TanStack Query v5, RTL + vitest, Tailwind design tokens (Paper/Ink/Red system).

**Spec:** `docs/superpowers/specs/2026-07-20-notifications-convention-restructure-design.md`

## Global Constraints

- Web-only: no API, notifier, or schema changes. API contract stays `getNotifications(page)` / `markNotificationsRead(ids)` (`apps/web/src/lib/api.ts:120-123`).
- Notifier invariant #6: only ids the client actually rendered are marked read. **No mark-all-read.**
- Empty-state copy is exactly `Nothing on the wire.` — survives verbatim.
- Two-surface token rule: anything rendered on both the dark popover and light page must swap tokens via an `onDark` flag, with a test pinning the swap.
- No emoji icons; the bell is an inline SVG (no icon package dependency).
- Badge display caps at `9+`; the `aria-label` carries the real number.
- Repo convention: presentational components are props-only + unit-tested; containers are thin and untested.
- Run web tests with `pnpm --filter @onelife/web run test`; typecheck with `pnpm --filter @onelife/web run typecheck` (or `pnpm turbo run typecheck`).
- Branch: `feature/notifications-convention-restructure` (already created; spec committed).

---

### Task 1: `useNotifications` + `useNotificationSeen` hooks

**Files:**
- Create: `apps/web/src/lib/use-notifications.ts`
- Test: `apps/web/src/lib/use-notifications.test.tsx`

**Interfaces:**
- Consumes: `getNotifications(page)`, `markNotificationsRead(ids)` from `@/lib/api`; `useAccountStatus()` from `@/lib/use-account-status` (returns `{ kind: "loading"|"signedOut"|"unlinked"|"pending"|"verified", ... }`); types `AppNotification`, `NotificationsFeed` from `@/lib/types`.
- Produces:
  ```ts
  export type Notifications = {
    items: AppNotification[];      // all loaded pages, flattened
    firstPage: AppNotification[];  // page 1 only — the popover's slice
    unreadCount: number;
    hasMore: boolean;
    loadMore: () => void;
    loadingMore: boolean;
    loading: boolean;              // signed in, no data yet
    error: boolean;                // failed with a cold cache
    refetch: () => void;
    markRead: (ids: number[]) => void;
  };
  export function useNotifications(): Notifications;
  export function useNotificationSeen(
    items: AppNotification[],
    active: boolean,
    markRead: (ids: number[]) => void,
  ): Set<number>; // the frozen "initially unread" id-set for the active surface session
  ```

- [ ] **Step 1: Write the failing tests**

`apps/web/src/lib/use-notifications.test.tsx`:

```tsx
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, test, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { useNotifications, useNotificationSeen } from "./use-notifications";
import type { AppNotification } from "./types";

vi.mock("@/lib/use-account-status", () => ({
  useAccountStatus: () => ({ kind: "verified", link: { gamertag: "Boots" } }),
}));
const getNotifications = vi.fn();
const markNotificationsRead = vi.fn();
vi.mock("@/lib/api", () => ({
  getNotifications: (...a: unknown[]) => getNotifications(...a),
  markNotificationsRead: (...a: unknown[]) => markNotificationsRead(...a),
}));

const note = (id: number, readAt: string | null = null): AppNotification => ({
  id, kind: "token_received", title: `T${id}`, body: `B${id}`, href: `/players/x`,
  createdAt: "2026-07-20T10:00:00Z", readAt,
});
const feed = (items: AppNotification[], unreadCount: number, page = 1, total = items.length) => ({
  items, unreadCount, total, page, pageSize: 20,
});

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  getNotifications.mockReset();
  markNotificationsRead.mockReset();
  markNotificationsRead.mockResolvedValue({ ok: true });
});

describe("useNotifications", () => {
  test("markRead stamps the cache locally instead of invalidating", async () => {
    getNotifications.mockResolvedValue(feed([note(1), note(2, "2026-07-20T09:00:00Z")], 1));
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.unreadCount).toBe(1);

    act(() => result.current.markRead([1]));
    await waitFor(() => expect(result.current.unreadCount).toBe(0));
    // No refetch happened — the stamp was local.
    expect(getNotifications).toHaveBeenCalledTimes(1);
    expect(result.current.items.find((n) => n.id === 1)?.readAt).not.toBeNull();
  });

  test("firstPage is page 1 only; items flatten all pages", async () => {
    getNotifications.mockImplementation((page: number) =>
      Promise.resolve(page === 1 ? feed([note(1)], 0, 1, 2) : feed([note(2)], 0, 2, 2)),
    );
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.firstPage).toHaveLength(1);
    expect(result.current.hasMore).toBe(false);
  });
});

describe("useNotificationSeen", () => {
  test("reports each unread row at most once and freezes the tint set", async () => {
    const markRead = vi.fn();
    const items = [note(1), note(2, "2026-07-20T09:00:00Z")];
    const { result, rerender } = renderHook(
      ({ active, items }) => useNotificationSeen(items, active, markRead),
      { initialProps: { active: true, items } },
    );
    await waitFor(() => expect(markRead).toHaveBeenCalledWith([1]));
    expect(result.current.has(1)).toBe(true);
    expect(result.current.has(2)).toBe(false);

    // The cache stamps id 1 read; the frozen set must NOT lose it, and no re-report.
    rerender({ active: true, items: [note(1, "2026-07-20T10:01:00Z"), note(2, "x")] });
    expect(result.current.has(1)).toBe(true);
    expect(markRead).toHaveBeenCalledTimes(1);
  });

  test("inactive surface reports nothing; closing resets the frozen set", async () => {
    const markRead = vi.fn();
    const { result, rerender } = renderHook(
      ({ active }) => useNotificationSeen([note(1)], active, markRead),
      { initialProps: { active: false } },
    );
    expect(markRead).not.toHaveBeenCalled();
    rerender({ active: true });
    await waitFor(() => expect(markRead).toHaveBeenCalledWith([1]));
    expect(result.current.has(1)).toBe(true);
    rerender({ active: false }); // popover closed — session over
    expect(result.current.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @onelife/web run test -- src/lib/use-notifications.test.tsx`
Expected: FAIL — `use-notifications` module not found.

- [ ] **Step 3: Implement the hooks**

`apps/web/src/lib/use-notifications.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @onelife/web run test -- src/lib/use-notifications.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/use-notifications.ts apps/web/src/lib/use-notifications.test.tsx
git commit -m "feat(web): useNotifications + frozen-tint seen tracking hooks"
```

---

### Task 2: `NotificationRow` (+ `relativeTime`, `accentFor` relocation)

**Files:**
- Create: `apps/web/src/components/notifications/row.tsx`
- Test: `apps/web/src/components/notifications/row.test.tsx`

**Interfaces:**
- Consumes: `AppNotification` from `@/lib/types`.
- Produces:
  ```tsx
  export function relativeTime(iso: string, now: Date): string; // "just now"|"5m ago"|"3h ago"|"2d ago"|"JUL 12"
  export function accentFor(kind: string, onDark?: boolean): string;
  export function NotificationRow(props: {
    n: AppNotification;
    unread: boolean;        // from the surface's frozen set, NOT from n.readAt
    onDark?: boolean;       // popover = true, page = false
    compact?: boolean;      // popover density (py-1); page default py-2.5
    now: Date;
  }): JSX.Element;
  ```

- [ ] **Step 1: Write the failing tests**

`apps/web/src/components/notifications/row.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { NotificationRow, relativeTime, accentFor } from "./row";
import type { AppNotification } from "@/lib/types";

const n = (over: Partial<AppNotification> = {}): AppNotification => ({
  id: 1, kind: "token_received", title: "Token received", body: "From Boots.",
  href: "/players/boots", createdAt: "2026-07-20T10:00:00Z", readAt: null, ...over,
});
const NOW = new Date("2026-07-20T12:00:00Z");

describe("relativeTime", () => {
  test("ladder incl. the dateline rung past 7 days", () => {
    expect(relativeTime("2026-07-20T11:59:40Z", NOW)).toBe("just now");
    expect(relativeTime("2026-07-20T11:30:00Z", NOW)).toBe("30m ago");
    expect(relativeTime("2026-07-20T07:00:00Z", NOW)).toBe("5h ago");
    expect(relativeTime("2026-07-17T12:00:00Z", NOW)).toBe("3d ago");
    expect(relativeTime("2026-07-01T12:00:00Z", NOW)).toBe("JUL 1");
  });
});

describe("accentFor", () => {
  test("red for death, blue for life, ink for bookkeeping — paper on dark", () => {
    expect(accentFor("ban_applied")).toBe("border-l-red");
    expect(accentFor("obituary_published")).toBe("border-l-red");
    expect(accentFor("ban_lifted")).toBe("border-l-blue");
    expect(accentFor("gamertag_verified")).toBe("border-l-ink");
    expect(accentFor("gamertag_verified", true)).toBe("border-l-paper");
    expect(accentFor("some_future_kind")).toBe("border-l-ink");
  });
});

describe("NotificationRow", () => {
  test("unread comes from the prop, not readAt: stamped row keeps tint + NEW tag", () => {
    // readAt is set (the cache stamped it) but the surface's frozen set says unread.
    render(<NotificationRow n={n({ readAt: "2026-07-20T11:00:00Z" })} unread now={NOW} />);
    const link = screen.getByRole("link");
    expect(link.className).toContain("bg-bone");
    expect(screen.getByText("NEW")).toBeInTheDocument();
  });

  test("read row has no tint and no NEW tag", () => {
    render(<NotificationRow n={n()} unread={false} now={NOW} />);
    expect(screen.getByRole("link").className).not.toContain("bg-bone");
    expect(screen.queryByText("NEW")).not.toBeInTheDocument();
  });

  test("onDark swaps every token: paper text, dark-line tint, red-soft NEW", () => {
    render(<NotificationRow n={n()} unread onDark now={NOW} />);
    const link = screen.getByRole("link");
    expect(link.className).toContain("bg-dark-line");
    expect(link.className).not.toContain("bg-bone");
    expect(screen.getByText("Token received").className).toContain("text-paper");
    expect(screen.getByText("NEW").className).toContain("text-red-soft");
  });

  test("links to the notification href", () => {
    render(<NotificationRow n={n()} unread={false} now={NOW} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/players/boots");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @onelife/web run test -- src/components/notifications/row.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`apps/web/src/components/notifications/row.tsx`:

```tsx
import Link from "next/link";
import type { AppNotification } from "@/lib/types";

export function relativeTime(iso: string, now: Date): string {
  const ms = now.getTime() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  // Past a week, a count stops meaning anything — render the dateline instead.
  return new Date(iso)
    .toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
    .toUpperCase();
}

const RED = new Set(["ban_applied", "obituary_published"]);
const BLUE = new Set(["ban_lifted", "life_qualified", "survival_milestone", "birth_notice_published"]);

/** R5b/R5c convention: red for death and the Morgue, blue for life and the Nursery, ink for
 *  account bookkeeping. Unknown kinds fall back to ink rather than throwing. */
export function accentFor(kind: string, onDark = false): string {
  if (RED.has(kind)) return "border-l-red";
  if (BLUE.has(kind)) return "border-l-blue";
  // Ink is invisible on bg-dark; paper is the same bookkeeping-neutral there.
  return onDark ? "border-l-paper" : "border-l-ink";
}

/** One notification link row. `unread` comes from the surface's frozen id-set — never from
 *  n.readAt, which the cache stamps mid-glance (spec §5.3). */
export function NotificationRow({
  n, unread, onDark = false, compact = false, now,
}: {
  n: AppNotification;
  unread: boolean;
  onDark?: boolean;
  compact?: boolean;
  now: Date;
}) {
  return (
    <Link
      href={n.href}
      className={`block border-l-[3px] ${accentFor(n.kind, onDark)} ${compact ? "py-1" : "py-2.5"} pl-2.5 pr-2 ${
        unread ? (onDark ? "bg-dark-line" : "bg-bone") : ""
      }`}
    >
      <span className={`block font-display text-[12px] font-bold uppercase tracking-[.06em] ${onDark ? "text-paper" : "text-ink"}`}>
        {n.title}
      </span>
      <span className={`block text-[13px] ${onDark ? "text-paper" : "text-ink"}`}>{n.body}</span>
      <span className={`flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.05em] ${onDark ? "text-cream-muted" : "text-ink-muted"}`}>
        {relativeTime(n.createdAt, now)}
        {unread && <span className={`font-bold ${onDark ? "text-red-soft" : "text-red"}`}>NEW</span>}
      </span>
    </Link>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @onelife/web run test -- src/components/notifications/row.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/notifications/row.tsx apps/web/src/components/notifications/row.test.tsx
git commit -m "feat(web): NotificationRow with frozen-tint prop, NEW tag, dateline rung"
```

---

### Task 3: `NotificationList`

**Files:**
- Create: `apps/web/src/components/notifications/list.tsx`
- Test: `apps/web/src/components/notifications/list.test.tsx`

**Interfaces:**
- Consumes: `NotificationRow` from `./row` (Task 2 props).
- Produces:
  ```tsx
  export function NotificationList(props: {
    items: AppNotification[];
    unreadIds: Set<number>;   // Task 1's useNotificationSeen return
    now: Date;
    onDark?: boolean;
    compact?: boolean;
    hasMore?: boolean;
    onLoadMore?: () => void;
    loadingMore?: boolean;
  }): JSX.Element;
  ```

- [ ] **Step 1: Write the failing tests**

`apps/web/src/components/notifications/list.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { NotificationList } from "./list";
import type { AppNotification } from "@/lib/types";

const n = (id: number): AppNotification => ({
  id, kind: "token_received", title: `T${id}`, body: `B${id}`, href: "/players/x",
  createdAt: "2026-07-20T10:00:00Z", readAt: null,
});
const NOW = new Date("2026-07-20T12:00:00Z");

describe("NotificationList", () => {
  test("empty state renders the wire line", () => {
    render(<NotificationList items={[]} unreadIds={new Set()} now={NOW} />);
    expect(screen.getByText("Nothing on the wire.")).toBeInTheDocument();
  });

  test("renders a row per item; unreadIds drives the NEW tags", () => {
    render(<NotificationList items={[n(1), n(2)]} unreadIds={new Set([1])} now={NOW} />);
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(screen.getAllByText("NEW")).toHaveLength(1);
  });

  test("Load older renders only with hasMore, disables while loading, min-44pt on the page", () => {
    const onLoadMore = vi.fn();
    const { rerender } = render(
      <NotificationList items={[n(1)]} unreadIds={new Set()} now={NOW} hasMore onLoadMore={onLoadMore} />,
    );
    const btn = screen.getByRole("button", { name: "Load older" });
    expect(btn.className).toContain("min-h-[44px]");
    fireEvent.click(btn);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    rerender(
      <NotificationList items={[n(1)]} unreadIds={new Set()} now={NOW} hasMore onLoadMore={onLoadMore} loadingMore />,
    );
    expect(screen.getByRole("button", { name: "Loading…" })).toBeDisabled();
  });

  test("no Load older without hasMore; compact list drops the 44pt floor", () => {
    render(<NotificationList items={[n(1)]} unreadIds={new Set()} now={NOW} compact hasMore onLoadMore={() => {}} />);
    expect(screen.getByRole("button", { name: "Load older" }).className).not.toContain("min-h-[44px]");
    render(<NotificationList items={[n(1)]} unreadIds={new Set()} now={NOW} />);
    expect(screen.queryByRole("button", { name: "Load older" })).toBeNull();
  });

  test("onDark empty state swaps to the on-dark muted token", () => {
    render(<NotificationList items={[]} unreadIds={new Set()} now={NOW} onDark />);
    expect(screen.getByText("Nothing on the wire.").className).toContain("text-cream-muted");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @onelife/web run test -- src/components/notifications/list.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`apps/web/src/components/notifications/list.tsx`:

```tsx
import type { AppNotification } from "@/lib/types";
import { NotificationRow } from "./row";

/** Rows + empty state + optional load-older. Props-only; the container supplies the frozen
 *  unread set (useNotificationSeen) and the pagination callbacks (useNotifications). */
export function NotificationList({
  items, unreadIds, now, onDark = false, compact = false, hasMore = false, onLoadMore, loadingMore = false,
}: {
  items: AppNotification[];
  unreadIds: Set<number>;
  now: Date;
  onDark?: boolean;
  compact?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  loadingMore?: boolean;
}) {
  if (items.length === 0) {
    return (
      <p className={`font-mono text-[11px] uppercase tracking-[.05em] ${onDark ? "text-cream-muted" : "text-ink-muted"}`}>
        Nothing on the wire.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      {items.map((n) => (
        <NotificationRow key={n.id} n={n} unread={unreadIds.has(n.id)} onDark={onDark} compact={compact} now={now} />
      ))}
      {hasMore && onLoadMore && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={loadingMore}
          className={`mt-0.5 text-left font-mono text-[11px] uppercase tracking-[.06em] underline disabled:no-underline disabled:opacity-60 ${
            compact ? "self-start" : "min-h-[44px] w-full"
          } ${onDark ? "text-cream-muted hover:text-paper" : "text-ink-muted hover:text-ink"}`}
        >
          {loadingMore ? "Loading…" : "Load older"}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @onelife/web run test -- src/components/notifications/list.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/notifications/list.tsx apps/web/src/components/notifications/list.test.tsx
git commit -m "feat(web): NotificationList with empty state and load-older"
```

---

### Task 4: `MastheadBell` + `NotificationsPopover`, mounted in the masthead

**Files:**
- Create: `apps/web/src/components/notifications/popover.tsx`
- Create: `apps/web/src/components/notifications/bell.tsx`
- Test: `apps/web/src/components/notifications/bell.test.tsx`
- Modify: `apps/web/src/components/header.tsx` (mount the bell in the top row)
- Modify: `apps/web/src/components/header.test.tsx` (stub the bell)

**Interfaces:**
- Consumes: `useNotifications`, `useNotificationSeen` (Task 1); `NotificationList` (Task 3); `useAccountStatus`; `useModalBehavior(open, onClose)` from `@/lib/use-modal-behavior`.
- Produces: `export function MastheadBell(): JSX.Element | null` — the only export `header.tsx` needs.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/components/notifications/bell.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, test, vi, beforeEach } from "vitest";
import { MastheadBell } from "./bell";
import type { Notifications } from "@/lib/use-notifications";

const mockStatus = vi.fn();
vi.mock("@/lib/use-account-status", () => ({ useAccountStatus: () => mockStatus() }));
const mockNotifications = vi.fn();
vi.mock("@/lib/use-notifications", () => ({
  useNotifications: () => mockNotifications(),
  useNotificationSeen: () => new Set<number>(),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

const base: Notifications = {
  items: [], firstPage: [], unreadCount: 0, hasMore: false, loadMore: vi.fn(),
  loadingMore: false, loading: false, error: false, refetch: vi.fn(), markRead: vi.fn(),
};

beforeEach(() => {
  mockStatus.mockReturnValue({ kind: "verified", link: { gamertag: "Boots" } });
  mockNotifications.mockReturnValue(base);
});

describe("MastheadBell", () => {
  test("renders nothing signed out or while loading", () => {
    mockStatus.mockReturnValue({ kind: "signedOut" });
    const { container, rerender } = render(<MastheadBell />);
    expect(container).toBeEmptyDOMElement();
    mockStatus.mockReturnValue({ kind: "loading" });
    rerender(<MastheadBell />);
    expect(container).toBeEmptyDOMElement();
  });

  test("no-unread: plain aria-label, no badge", () => {
    render(<MastheadBell />);
    expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument();
    expect(screen.queryByTestId("bell-badge")).toBeNull();
  });

  test("unread: count in the aria-label, badge shows the number, capped at 9+", () => {
    mockNotifications.mockReturnValue({ ...base, unreadCount: 3 });
    const { rerender } = render(<MastheadBell />);
    expect(screen.getByRole("button", { name: "Notifications, 3 unread" })).toBeInTheDocument();
    expect(screen.getByTestId("bell-badge")).toHaveTextContent("3");
    mockNotifications.mockReturnValue({ ...base, unreadCount: 23 });
    rerender(<MastheadBell />);
    expect(screen.getByTestId("bell-badge")).toHaveTextContent("9+");
    expect(screen.getByRole("button", { name: "Notifications, 23 unread" })).toBeInTheDocument();
  });

  test("mobile is a link to /notifications; desktop is a popover button", () => {
    render(<MastheadBell />);
    const link = screen.getByRole("link", { name: "Notifications" });
    expect(link).toHaveAttribute("href", "/notifications");
    expect(link.className).toContain("md:hidden");
    const btn = screen.getByRole("button", { name: "Notifications" });
    expect(btn.className).toContain("md:flex");
    expect(btn).toHaveAttribute("aria-haspopup", "dialog");
  });

  test("clicking the desktop bell opens the popover with View all", () => {
    render(<MastheadBell />);
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    expect(screen.getByRole("dialog", { name: "Notifications" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view all/i })).toHaveAttribute("href", "/notifications");
    expect(screen.getByText("Nothing on the wire.")).toBeInTheDocument();
  });

  test("cold-cache error renders the retry line in the popover", () => {
    mockNotifications.mockReturnValue({ ...base, error: true });
    render(<MastheadBell />);
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    expect(screen.getByText("Couldn't reach the wire. Retrying.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @onelife/web run test -- src/components/notifications/bell.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement popover and bell**

`apps/web/src/components/notifications/popover.tsx`:

```tsx
"use client";
import Link from "next/link";
import type { RefObject } from "react";
import type { AppNotification } from "@/lib/types";
import { NotificationList } from "./list";

/** Dark dropdown chrome around a compact List — hangs off the bg-dark masthead, so the whole
 *  interior uses the on-dark token set (the ⚠️ two-surfaces rule). Page 1 only, by design:
 *  depth lives on /notifications. */
export function NotificationsPopover({
  items, unreadIds, now, error, panelRef,
}: {
  items: AppNotification[];
  unreadIds: Set<number>;
  now: Date;
  error: boolean;
  panelRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Notifications"
      tabIndex={-1}
      className="absolute right-0 top-full z-50 mt-2 w-[340px] border border-dark-line bg-dark p-3 shadow-[0_10px_30px_rgba(0,0,0,.45)]"
    >
      {error ? (
        <p className="font-mono text-[11px] uppercase tracking-[.05em] text-cream-muted">
          Couldn&apos;t reach the wire. Retrying.
        </p>
      ) : (
        <NotificationList items={items} unreadIds={unreadIds} now={now} onDark compact />
      )}
      <div className="mt-2.5 border-t border-dark-line pt-2 text-right">
        <Link
          href="/notifications"
          className="font-mono text-[11px] font-bold uppercase tracking-[.06em] text-cream-muted hover:text-paper"
        >
          View all →
        </Link>
      </div>
    </div>
  );
}
```

`apps/web/src/components/notifications/bell.tsx`:

```tsx
"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useAccountStatus } from "@/lib/use-account-status";
import { useNotifications, useNotificationSeen } from "@/lib/use-notifications";
import { useModalBehavior } from "@/lib/use-modal-behavior";
import { NotificationsPopover } from "./popover";

function BellGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Badge({ count }: { count: number }) {
  return (
    <span
      data-testid="bell-badge"
      aria-hidden
      className="absolute -right-0.5 -top-0.5 min-w-[18px] bg-red px-1 py-px text-center font-mono text-[10px] font-bold leading-[14px] text-paper"
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}

/** The masthead bell (spec §3.1). Signed-in only; renders before verification so the
 *  gamertag_verified notification has somewhere to land. Mobile: a plain link to
 *  /notifications. Desktop (md+): toggles the anchored popover. A broken query must never
 *  break the header — error states render inside the popover, never here. */
export function MastheadBell() {
  const status = useAccountStatus();
  const signedIn = status.kind === "unlinked" || status.kind === "pending" || status.kind === "verified";
  const n = useNotifications();
  const [open, setOpen] = useState(false);
  const panelRef = useModalBehavior(open, () => setOpen(false));
  const rootRef = useRef<HTMLDivElement>(null);

  // Row clicks navigate AND dismiss — the sheet-over-destination bug class cannot recur.
  const pathname = usePathname();
  const prevPath = useRef(pathname);
  useEffect(() => {
    if (pathname !== prevPath.current) {
      prevPath.current = pathname;
      setOpen(false);
    }
  }, [pathname]);

  // Outside click closes (useModalBehavior covers Escape/focus).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // The popover shows page 1 only, so only page 1 is ever reported seen (invariant #6).
  const seen = useNotificationSeen(n.firstPage, open, n.markRead);

  if (!signedIn) return null;
  const label = n.unreadCount > 0 ? `Notifications, ${n.unreadCount} unread` : "Notifications";

  return (
    <div ref={rootRef} className="absolute right-4 top-1/2 -translate-y-1/2 md:top-auto md:translate-y-0">
      <Link href="/notifications" aria-label={label} className="relative block p-2 text-paper md:hidden">
        <BellGlyph />
        {n.unreadCount > 0 && <Badge count={n.unreadCount} />}
      </Link>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="relative hidden p-2 text-paper hover:text-red-soft md:flex"
      >
        <BellGlyph />
        {n.unreadCount > 0 && <Badge count={n.unreadCount} />}
      </button>
      {open && (
        <NotificationsPopover
          items={n.firstPage}
          unreadIds={seen}
          now={new Date()}
          error={n.error}
          panelRef={panelRef}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Mount in the masthead**

In `apps/web/src/components/header.tsx`, add the import and mount. The bell sits in the top row (the `relative` div holding the hamburger and wordmark), so `absolute right-4` mirrors the hamburger's `left-4`:

```tsx
import { MastheadBell } from "@/components/notifications/bell";
```

In the JSX, after the wordmark `<Link>` inside the top-row `<div className="relative flex items-center justify-center px-4 pt-5 md:pt-7">`:

```tsx
        <Link href="/" aria-label="One Life — home">
          <img src="/brand/wordmark-primary@2x.png" alt="One Life" className="h-auto w-[150px] md:w-[280px]" />
        </Link>
        <MastheadBell />
```

- [ ] **Step 5: Stub the bell in the existing masthead test**

In `apps/web/src/components/header.test.tsx`, add below the existing `vi.mock("next/navigation", ...)` line:

```tsx
vi.mock("@/components/notifications/bell", () => ({ MastheadBell: () => null }));
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @onelife/web run test -- src/components/notifications/bell.test.tsx src/components/header.test.tsx`
Expected: PASS (bell: 6 tests; header: existing 3 still green).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/notifications/bell.tsx apps/web/src/components/notifications/popover.tsx apps/web/src/components/notifications/bell.test.tsx apps/web/src/components/header.tsx apps/web/src/components/header.test.tsx
git commit -m "feat(web): masthead bell with badge and desktop notifications popover"
```

---

### Task 5: `/notifications` page + `PushToggle` relocation with iOS explainer

**Files:**
- Create: `apps/web/src/components/notifications/push-toggle.tsx` (moved from `controls/`, `onDark` deleted, iOS state added)
- Create: `apps/web/src/components/notifications/push-toggle.test.tsx` (moved + extended)
- Create: `apps/web/src/components/notifications/inbox.tsx` (client container)
- Create: `apps/web/src/app/notifications/page.tsx`
- Create: `apps/web/src/app/notifications/loading.tsx`
- Delete: `apps/web/src/components/controls/push-toggle.tsx`, `apps/web/src/components/controls/push-toggle.test.tsx`

**Interfaces:**
- Consumes: `useNotifications`/`useNotificationSeen` (Task 1), `NotificationList` (Task 3), `useAccountStatus`, push API fns from `@/lib/api`, `currentPushSubscription` from `@/lib/push`.
- Produces: route `/notifications`; `PushToggle` (no props) — nothing else imports these.

- [ ] **Step 1: Move the push toggle and write the failing tests for the new states**

`git mv apps/web/src/components/controls/push-toggle.tsx apps/web/src/components/notifications/push-toggle.tsx`
`git mv apps/web/src/components/controls/push-toggle.test.tsx apps/web/src/components/notifications/push-toggle.test.tsx`

In the moved test file, update the import path to `./push-toggle`, remove any `onDark` prop usages/assertions, and add:

```tsx
  test("iOS Safari outside the installed app explains Add to Home Screen", async () => {
    vi.stubGlobal("navigator", { userAgent: "iPhone Safari", serviceWorker: undefined });
    render(<PushToggle />);
    expect(
      await screen.findByText(/push needs one life on your home screen/i),
    ).toBeInTheDocument();
  });

  test("genuinely unsupported browsers say so instead of rendering nothing", async () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 OldBrowser", serviceWorker: undefined });
    render(<PushToggle />);
    expect(await screen.findByText("Push isn't supported in this browser.")).toBeInTheDocument();
  });
```

(Keep the file's existing mock setup for `@/lib/api` and `@/lib/push`; `vi.unstubAllGlobals()` in `afterEach` if not already present.)

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `pnpm --filter @onelife/web run test -- src/components/notifications/push-toggle.test.tsx`
Expected: the two new tests FAIL (component returns null on unsupported); moved existing tests pass.

- [ ] **Step 3: Update `PushToggle`**

In `apps/web/src/components/notifications/push-toggle.tsx`:

1. Change the `State` union: `type State = "unsupported" | "ios" | "denied" | "off" | "on" | "working" | "error";`
2. Delete the `onDark` prop — signature becomes `export function PushToggle()` — and replace the `cls` line with the light-surface-only version:
   ```ts
   const cls = "mt-1 text-left font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted hover:text-red";
   ```
   (also update the component's doc comment: it now renders only on the light /notifications page, so the dual-surface swap is gone by construction).
3. In `reconcile()`, replace the unsupported branch:
   ```ts
   if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
     const nav = navigator as Navigator & { standalone?: boolean };
     const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
     // iOS Safari has push — but only for installed PWAs. Silence here was the old bug:
     // the platform our players actually carry saw no toggle and no reason why.
     setState(ios && nav.standalone !== true ? "ios" : "unsupported");
     return;
   }
   ```
4. Replace `if (state === "unsupported") return null;` with:
   ```tsx
   if (state === "unsupported") return <p className={cls}>Push isn&apos;t supported in this browser.</p>;
   if (state === "ios") {
     return (
       <p className={cls}>
         Push needs One Life on your home screen — Share → Add to Home Screen, then come back here.
       </p>
     );
   }
   ```
5. Give the on/off toggle button a 44pt floor: on its `className`, append `" flex min-h-[44px] items-center"`.

- [ ] **Step 4: Run the toggle tests**

Run: `pnpm --filter @onelife/web run test -- src/components/notifications/push-toggle.test.tsx`
Expected: PASS.

- [ ] **Step 5: Build the inbox container and route**

`apps/web/src/components/notifications/inbox.tsx`:

```tsx
"use client";
import Link from "next/link";
import { useAccountStatus } from "@/lib/use-account-status";
import { useNotifications, useNotificationSeen } from "@/lib/use-notifications";
import { NotificationList } from "./list";
import { PushToggle } from "./push-toggle";

/** The permanent inbox (spec §3.3). Signed out renders a CTA, not a redirect — the URL must
 *  keep working as a push landing target through a session lapse. The page reports every row
 *  it renders (each Load older page included) and nothing deeper. */
export function NotificationsInbox() {
  const status = useAccountStatus();
  const n = useNotifications();
  const seen = useNotificationSeen(n.items, true, n.markRead);
  const now = new Date();

  let body: React.ReactNode;
  if (status.kind === "loading" || n.loading) {
    body = (
      <div aria-busy="true" className="flex flex-col gap-2">
        <div aria-hidden className="h-16 animate-pulse bg-bone" />
        <div aria-hidden className="h-16 animate-pulse bg-bone" />
        <div aria-hidden className="h-16 animate-pulse bg-bone" />
      </div>
    );
  } else if (status.kind === "signedOut") {
    body = (
      <p className="font-mono text-[12px] uppercase tracking-[.05em] text-ink-muted">
        Sign in to read your wire.{" "}
        <Link href="/login" className="font-bold text-red underline">
          Sign in →
        </Link>
      </p>
    );
  } else if (n.error) {
    body = (
      <div className="flex flex-col items-start gap-2">
        <p className="font-mono text-[12px] uppercase tracking-[.05em] text-ink-muted">
          Couldn&apos;t reach the wire. Retrying.
        </p>
        <button
          type="button"
          onClick={n.refetch}
          className="min-h-[44px] font-mono text-[11px] uppercase tracking-[.06em] text-ink-muted underline hover:text-ink"
        >
          Try now
        </button>
      </div>
    );
  } else {
    body = (
      <NotificationList
        items={n.items}
        unreadIds={seen}
        now={now}
        hasMore={n.hasMore}
        onLoadMore={n.loadMore}
        loadingMore={n.loadingMore}
      />
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-10 md:px-10">
      <div className="border-b-[3px] border-ink pb-4">
        <h1 className="font-display text-4xl font-bold uppercase tracking-[.02em] text-ink">The Wire</h1>
        <p className="mt-1 font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
          Everything that happened to you, on the record.
        </p>
      </div>
      <div className="mt-5">{body}</div>
      {status.kind !== "signedOut" && status.kind !== "loading" && (
        <div className="mt-8 border border-ink p-3.5">
          <h2 className="font-display text-[13px] font-bold uppercase tracking-[.14em] text-ink">Push alerts</h2>
          <PushToggle />
        </div>
      )}
    </main>
  );
}
```

`apps/web/src/app/notifications/page.tsx`:

```tsx
import type { Metadata } from "next";
import { NotificationsInbox } from "@/components/notifications/inbox";

export const metadata: Metadata = {
  title: "Notifications",
  robots: { index: false }, // a private inbox has no business in a search index
};

export default function NotificationsPage() {
  return <NotificationsInbox />;
}
```

`apps/web/src/app/notifications/loading.tsx`:

```tsx
export default function Loading() {
  return (
    <main aria-busy="true" className="mx-auto w-full max-w-2xl px-6 py-10 md:px-10">
      <div className="border-b-[3px] border-ink pb-4">
        <div aria-hidden className="h-10 w-52 animate-pulse bg-bone" />
        <div aria-hidden className="mt-3 h-3 w-72 animate-pulse bg-bone" />
      </div>
      <div className="mt-5 flex flex-col gap-2">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} aria-hidden className="h-16 animate-pulse bg-bone" />
        ))}
      </div>
    </main>
  );
}
```

- [ ] **Step 6: Run the notifications tests (full typecheck is deferred to Task 6)**

Run: `pnpm --filter @onelife/web run test -- src/components/notifications src/app`
Expected: PASS. Do **not** run the full typecheck yet: moving `push-toggle.tsx` out of `controls/` breaks the imports in `rail.tsx`/`mobile-controls.tsx` by design — Task 6 deletes those imports minutes later, and its Step 5 is where the whole suite + typecheck must go green.

- [ ] **Step 7: Commit**

```bash
git add -A apps/web/src/components/notifications apps/web/src/app/notifications apps/web/src/components/controls
git commit -m "feat(web): /notifications inbox page; push toggle moves in with iOS explainer"
```

---

### Task 6: Remove the panel from rail, sheet, and `use-controls`

**Files:**
- Modify: `apps/web/src/components/controls/use-controls.ts`
- Modify: `apps/web/src/components/controls/rail.tsx`
- Modify: `apps/web/src/components/controls/mobile-controls.tsx`
- Modify: `apps/web/src/components/controls/rail.test.tsx`, `apps/web/src/components/controls/mobile-controls.test.tsx`
- Delete: `apps/web/src/components/controls/notifications-panel.tsx`, `apps/web/src/components/controls/notifications-panel.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: slimmed `Controls` type — `{ status, name, provider, balance, servers, standing }`; `useControlsActions()` without `markRead`. Rail/sheet render no notifications UI.

- [ ] **Step 1: Slim `use-controls.ts`**

Remove from `use-controls.ts`: the `useInfiniteQuery` import usage and the whole `notifications` query; `getNotifications`/`markNotificationsRead` from the api import; `AppNotification` from the types import; the `notifications`/`unreadCount`/`hasMore`/`loadMore`/`loadingMore` fields from the `Controls` type and return; the `markRead` mutation and its entry in the actions return. The file keeps `me`/`tokens`/`servers`/`player` queries and `claim`/`cancel`/`send`/`refer`/`redeem` untouched.

- [ ] **Step 2: Slim `rail.tsx` and `mobile-controls.tsx`**

- `rail.tsx`: delete the `NotificationsPanel`/`PushToggle` imports and the `<NotificationsPanel …><PushToggle /></NotificationsPanel>` block in the verified branch (lines 105–114 of the current file). The verified body becomes `IdentityRow` → `TokensPanel` → "Your servers".
- `mobile-controls.tsx`: delete the `NotificationsPanel`/`PushToggle` imports and the `<NotificationsPanel onDark …><PushToggle onDark /></NotificationsPanel>` block (lines 97–107). The verified sheet becomes `TokensPanel` → server rows.

- [ ] **Step 3: Delete the panel**

```bash
git rm apps/web/src/components/controls/notifications-panel.tsx apps/web/src/components/controls/notifications-panel.test.tsx
```

- [ ] **Step 4: Update the surface tests**

- `rail.test.tsx`: remove `notifications: [], unreadCount: 0` (and any `hasMore`/`loadMore`/`loadingMore`) from the `base` mock; remove `markRead: mut()` from every actions mock; delete the test `"verified: opening notifications reveals the list and marks them read"` (and any other assertion referencing the unread badge or notifications button).
- `mobile-controls.test.tsx`: same mock slimming; delete the test `"mounts the notifications panel in its dark variant"`.

- [ ] **Step 5: Full suite + typecheck**

Run: `pnpm --filter @onelife/web run test && pnpm --filter @onelife/web run typecheck`
Expected: PASS, no dangling references to the panel or the old toggle path anywhere (`grep -rn "notifications-panel\|controls/push-toggle" apps/web/src` returns nothing).

- [ ] **Step 6: Commit**

```bash
git add -A apps/web/src/components/controls
git commit -m "refactor(web): rail and sheet drop the notifications panel"
```

---

### Task 7: Changelog, CLAUDE.md, full verification

**Files:**
- Modify: `CHANGELOG.md` (new Unreleased entry)
- Modify: `CLAUDE.md` (player-notifications + R3 sections reflect the new home)

**Interfaces:** none — documentation and verification only.

- [ ] **Step 1: CHANGELOG entry**

Add under the Unreleased/next heading (matching the file's existing format):

```markdown
- Notifications moved to the platform convention: a masthead bell with unread badge on every
  page (anchored popover on desktop, link on mobile), a permanent `/notifications` inbox
  ("The Wire") with the push-alerts toggle, and a frozen-tint read model so rows no longer
  flatten mid-glance. The rail and mobile sheet drop their notifications panel; iOS Safari
  now explains Add to Home Screen instead of hiding the push toggle.
```

- [ ] **Step 2: CLAUDE.md update**

In the **Player notifications** sub-project entry, replace the delivery description "(bell icon + unread badge in the R3 controls rail, …)" with the new surface: masthead `MastheadBell` (all widths, signed-in, popover at `md+`, link below), `/notifications` inbox page carrying the `PushToggle` (no `onDark` — single light surface), frozen-tint read model in `useNotifications`/`useNotificationSeen` (`@/lib/use-notifications`; mark-read stamps the cache via `setQueryData`, never invalidates), and note that invariant #6 still holds (popover reports page 1; the page reports each loaded page; no mark-all). In the **R3 controls rail** section, note the notifications panel was removed from rail + sheet in this change and that the ⚠️ two-surface token rule now applies to `NotificationRow`/`NotificationList` (popover dark / page light) instead of the panel.

- [ ] **Step 3: Full verification**

Run: `pnpm turbo run typecheck && pnpm --filter @onelife/web run test`
Expected: PASS across the repo.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md CLAUDE.md
git commit -m "docs: changelog + CLAUDE.md for notifications restructure"
```

Then hand off to the `finishing-a-feature` skill for the PR into `develop`.
