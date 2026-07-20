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
    const { rerender } = render(
      <NotificationList items={[n(1)]} unreadIds={new Set()} now={NOW} compact hasMore onLoadMore={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "Load older" }).className).not.toContain("min-h-[44px]");
    rerender(<NotificationList items={[n(1)]} unreadIds={new Set()} now={NOW} />);
    expect(screen.queryByRole("button", { name: "Load older" })).toBeNull();
  });

  test("onDark empty state swaps to the on-dark muted token", () => {
    render(<NotificationList items={[]} unreadIds={new Set()} now={NOW} onDark />);
    expect(screen.getByText("Nothing on the wire.").className).toContain("text-cream-muted");
  });
});
