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
