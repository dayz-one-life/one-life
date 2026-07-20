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
