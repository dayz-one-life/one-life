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
const feed = (items: AppNotification[], unreadCount: number, page = 1, total = items.length, pageSize = 20) => ({
  items, unreadCount, total, page, pageSize,
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
      Promise.resolve(page === 1 ? feed([note(1)], 0, 1, 2, 1) : feed([note(2)], 0, 2, 2, 1)),
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
