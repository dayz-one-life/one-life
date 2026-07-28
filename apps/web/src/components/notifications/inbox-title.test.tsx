import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/use-notifications", () => ({
  useNotifications: () => ({
    items: [],
    firstPage: [],
    unreadCount: 0,
    hasMore: false,
    loadMore: vi.fn(),
    loadingMore: false,
    loading: false,
    error: false,
    refetch: vi.fn(),
    markRead: vi.fn(),
  }),
  useNotificationSeen: () => new Set<number>(),
}));
vi.mock("@/lib/use-account-status", () => ({
  useAccountStatus: () => ({ kind: "verified", link: { gamertag: "Steve" } }),
}));

import { NotificationsInbox } from "./inbox";

describe("NotificationsInbox title", () => {
  it("is named by the nav word, not a tabloid alias", () => {
    render(<NotificationsInbox />);
    expect(screen.getByRole("heading", { level: 1, name: "Notifications" })).toBeInTheDocument();
  });
});
