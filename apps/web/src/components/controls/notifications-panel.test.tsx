import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NotificationsPanel, relativeTime, accentFor } from "./notifications-panel";
import type { AppNotification } from "@/lib/types";

const NOW = new Date("2026-07-19T12:00:00Z");

const item = (over: Partial<AppNotification> = {}): AppNotification => ({
  id: 1, kind: "ban_applied", title: "You died", body: "24 hours.",
  href: "/players/x", createdAt: "2026-07-19T11:30:00Z", readAt: null, ...over,
});

describe("relativeTime", () => {
  it("formats minutes, hours, and days", () => {
    expect(relativeTime("2026-07-19T11:30:00Z", NOW)).toBe("30m ago");
    expect(relativeTime("2026-07-19T09:00:00Z", NOW)).toBe("3h ago");
    expect(relativeTime("2026-07-16T12:00:00Z", NOW)).toBe("3d ago");
  });
  it("calls anything under a minute 'just now'", () => {
    expect(relativeTime("2026-07-19T11:59:30Z", NOW)).toBe("just now");
  });
});

describe("accentFor", () => {
  it("maps ban and obituary kinds to red, births to blue, rest to ink", () => {
    expect(accentFor("ban_applied")).toContain("red");
    expect(accentFor("obituary_published")).toContain("red");
    expect(accentFor("birth_notice_published")).toContain("blue");
    expect(accentFor("life_qualified")).toContain("blue");
    expect(accentFor("tokens_granted")).toContain("ink");
    expect(accentFor("something_new")).toContain("ink");
  });
});

describe("NotificationsPanel", () => {
  it("shows the unread count badge when there are unread items", () => {
    render(<NotificationsPanel items={[item()]} unreadCount={3} onOpen={() => {}} />);
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("hides the badge at zero unread", () => {
    render(<NotificationsPanel items={[item({ readAt: "2026-07-19T11:45:00Z" })]} unreadCount={0} onOpen={() => {}} />);
    expect(screen.queryByTestId("unread-badge")).toBeNull();
  });

  // The third click is load-bearing: with only open+close, deleting the once-per-mount ref
  // guard still passes, because a collapse never fires onOpen anyway.
  it("calls onOpen the first time it is expanded, and never again", () => {
    const onOpen = vi.fn();
    render(<NotificationsPanel items={[item()]} unreadCount={1} onOpen={onOpen} />);
    const toggle = screen.getByRole("button", { name: /notifications/i });
    fireEvent.click(toggle);
    expect(onOpen).toHaveBeenCalledOnce();
    fireEvent.click(toggle);
    expect(onOpen).toHaveBeenCalledOnce();
    fireEvent.click(toggle);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("reports only the unread ids it actually rendered", () => {
    const onOpen = vi.fn();
    render(
      <NotificationsPanel
        items={[
          item({ id: 7 }),
          item({ id: 8, readAt: "2026-07-19T11:45:00Z" }),
          item({ id: 9 }),
        ]}
        // Deeper than the rendered page: the rest of the backlog must stay untouched.
        unreadCount={40}
        onOpen={onOpen}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
    expect(onOpen).toHaveBeenCalledWith([7, 9]);
  });

  it("does not fire onOpen when there is nothing unread to mark", () => {
    const onOpen = vi.fn();
    render(
      <NotificationsPanel
        items={[item({ readAt: "2026-07-19T11:45:00Z" })]}
        unreadCount={0}
        onOpen={onOpen}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("renders each item as a link to its href once expanded", () => {
    render(<NotificationsPanel items={[item()]} unreadCount={1} onOpen={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
    expect(screen.getByRole("link", { name: /You died/ })).toHaveAttribute("href", "/players/x");
  });

  it("shows an in-voice empty state", () => {
    render(<NotificationsPanel items={[]} unreadCount={0} onOpen={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
    expect(screen.getByText(/nothing/i)).toBeInTheDocument();
  });
});
