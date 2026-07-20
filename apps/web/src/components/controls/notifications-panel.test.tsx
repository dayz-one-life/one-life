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

  describe("reaching a backlog deeper than one page", () => {
    it("offers Load older only while older pages remain", () => {
      const { rerender } = render(
        <NotificationsPanel items={[item()]} unreadCount={25} onOpen={() => {}} hasMore onLoadMore={() => {}} />,
      );
      fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
      expect(screen.getByRole("button", { name: "Load older" })).toBeInTheDocument();

      rerender(
        <NotificationsPanel items={[item()]} unreadCount={0} onOpen={() => {}} hasMore={false} onLoadMore={() => {}} />,
      );
      expect(screen.queryByRole("button", { name: "Load older" })).toBeNull();
    });

    // THE REGRESSION. The panel used to fire onOpen once per mount, so a page fetched after
    // the panel was already expanded was rendered but never reported as read. A user with
    // more than one page of unread could therefore never drain the badge: page 1 got marked,
    // and everything the Load older control revealed stayed unread forever.
    it("marks a page loaded after expansion read, without re-reporting the first page", () => {
      const onOpen = vi.fn();
      const page1 = [item({ id: 1 }), item({ id: 2 })];
      const { rerender } = render(
        <NotificationsPanel items={page1} unreadCount={4} onOpen={onOpen} hasMore onLoadMore={() => {}} />,
      );

      fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
      expect(onOpen).toHaveBeenCalledTimes(1);
      expect(onOpen).toHaveBeenLastCalledWith([1, 2]);

      // Load older resolved: the parent appends page 2 while the panel stays open. Page 1's
      // rows have come back read, exactly as the refetch after markRead returns them.
      rerender(
        <NotificationsPanel
          items={[
            item({ id: 1, readAt: "2026-07-19T11:55:00Z" }),
            item({ id: 2, readAt: "2026-07-19T11:55:00Z" }),
            item({ id: 3 }),
            item({ id: 4 }),
          ]}
          unreadCount={2}
          onOpen={onOpen}
          hasMore={false}
          onLoadMore={() => {}}
        />,
      );

      expect(onOpen).toHaveBeenCalledTimes(2);
      expect(onOpen).toHaveBeenLastCalledWith([3, 4]); // only the newly revealed rows
    });

    it("never reports the same id twice, however often the parent re-renders", () => {
      const onOpen = vi.fn();
      const items = [item({ id: 1 })];
      const { rerender } = render(
        <NotificationsPanel items={items} unreadCount={1} onOpen={onOpen} />,
      );
      fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
      expect(onOpen).toHaveBeenCalledTimes(1);

      // A refetch that returns the row still unread (the mutation is in flight) must not
      // re-send it — the sent-id set, not the response, is the guard.
      rerender(<NotificationsPanel items={[item({ id: 1 })]} unreadCount={1} onOpen={onOpen} />);
      rerender(<NotificationsPanel items={[item({ id: 1 })]} unreadCount={1} onOpen={onOpen} />);
      expect(onOpen).toHaveBeenCalledTimes(1);
    });
  });

  it("shows an in-voice empty state", () => {
    render(<NotificationsPanel items={[]} unreadCount={0} onOpen={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
    expect(screen.getByText(/nothing/i)).toBeInTheDocument();
  });
});

// The mobile sheet is bg-dark; every token in this panel's default styling is for the light
// rail (text-ink / border-ink / bg-bone). Mounted bare in the sheet, the panel rendered
// ink-on-dark — present in the DOM, invisible on the phone. That is exactly how it shipped.
describe("NotificationsPanel on a dark surface", () => {
  // toHaveClass matches whole class tokens. toContain would pass on a mere substring — and this
  // file has a real false-pass waiting: "text-cream-muted hover:text-paper" contains "text-paper"
  // while its base colour is not paper.
  it("swaps the light-surface tokens for sheet-legible ones when onDark", () => {
    render(<NotificationsPanel onDark items={[item()]} unreadCount={1} onOpen={() => {}} />);
    const toggle = screen.getByRole("button", { name: /notifications/i });
    expect(toggle).toHaveClass("text-paper", "border-paper");
    expect(toggle).not.toHaveClass("text-ink");
    fireEvent.click(toggle);
    expect(screen.getByText("You died")).toHaveClass("text-paper");
    expect(screen.getByText("24 hours.")).toHaveClass("text-paper");
    expect(screen.getByText(/ago|just now/)).toHaveClass("text-cream-muted");
  });

  // An unread row must be visibly distinct on the sheet, not merely differently-classed.
  it("tints an unread row with the on-dark separator, not a near-invisible grey", () => {
    render(<NotificationsPanel onDark items={[item()]} unreadCount={1} onOpen={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
    expect(screen.getByRole("link", { name: /You died/ })).toHaveClass("bg-dark-line");
  });

  it("keeps the light rail default when onDark is absent", () => {
    render(<NotificationsPanel items={[item()]} unreadCount={1} onOpen={() => {}} />);
    expect(screen.getByRole("button", { name: /notifications/i })).toHaveClass("text-ink", "border-ink");
  });

  it("gives the ink accent bucket a paper spine on dark", () => {
    expect(accentFor("tokens_granted", true)).toContain("paper");
    expect(accentFor("ban_applied", true)).toContain("red");
    expect(accentFor("tokens_granted")).toContain("ink");
  });
});
