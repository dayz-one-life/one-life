import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FriendsPanel } from "./friends-panel";

describe("FriendsPanel", () => {
  it("links to the roster with the friend count", () => {
    render(<FriendsPanel friendCount={3} requestCount={0} />);
    const link = screen.getByRole("link", { name: /friends/i });
    expect(link).toHaveAttribute("href", "/friends");
    expect(link).toHaveTextContent("3");
  });

  it("badges pending requests with the real count in the accessible name", () => {
    render(<FriendsPanel friendCount={1} requestCount={2} />);
    expect(screen.getByLabelText(/2 pending friend requests/i)).toBeInTheDocument();
  });

  it("shows a placeholder rather than a fabricated zero while loading", () => {
    render(<FriendsPanel loading />);
    const status = screen.getByRole("status");
    expect(status.className).toMatch(/\btext-ink-muted\b/);
    // cream-muted is a DARK-surface token. It used to appear here via `boxed`; the sheet that
    // needed it is gone, so its presence now would mean invisible text on paper.
    expect(status.className).not.toMatch(/\btext-cream-muted\b/);
    expect((status.parentElement as HTMLElement).className).toMatch(/\bborder-hairline\b/);
  });

  // This panel used to mount on BOTH the light rail and the dark ControlsSheet, and a token swap
  // was the only thing standing between it and rendering invisible on a phone (exactly how the
  // notifications panel shipped in v0.26.0). Sub-project B deleted the sheet, so the panel is
  // light-surface only — and this test now guards the opposite direction: no dark token may creep
  // back in, because there is no dark surface left to justify one.
  it("renders light-surface tokens only", () => {
    const { container } = render(<FriendsPanel friendCount={1} requestCount={2} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toMatch(/\btext-ink\b/);
    expect(root.className).not.toMatch(/\btext-paper\b/);
    // red-deep is the LIGHT-surface red (5.8:1). Plain `red` is display-only on paper at this
    // size, so the badge must use red-deep here.
    expect(root.innerHTML).toMatch(/\bbg-red-deep\b/);
  });

  it("renders 'Friends 0' when loaded with zero friends", () => {
    render(<FriendsPanel friendCount={0} requestCount={0} />);
    const link = screen.getByRole("link", { name: /friends/i });
    expect(link).toHaveTextContent("Friends 0");
  });

  // friendCount is undefined whenever the count is unknown — a failed fetch is the only
  // real-world cause (FriendsPanelContainer never passes `data?.total` through on error), but
  // the presentational component itself only ever looks at whether friendCount is a number.
  it("hides the count when friendCount is unknown", () => {
    render(<FriendsPanel />);
    const link = screen.getByRole("link", { name: /friends/i });
    expect(link).toHaveTextContent("Friends");
    // The link itself should still be present and working
    expect(link).toHaveAttribute("href", "/friends");
    // Should NOT render any number
    expect(link).not.toHaveTextContent("0");
  });

  it("does not show request badge when friendCount is unknown", () => {
    render(<FriendsPanel requestCount={2} />);
    expect(screen.queryByLabelText(/pending friend requests/i)).toBeNull();
  });

  // The map moved to the primary nav, which reaches every page rather than only the signed-in
  // controls surfaces. A second entry point here would be a duplicate the nav already covers.
  it("no longer carries a map link — the masthead owns that route", () => {
    const { container } = render(<FriendsPanel friendCount={1} requestCount={0} />);
    expect(container.querySelector('a[href^="/maps"]')).toBeNull();
    expect(screen.queryByRole("link", { name: /map/i })).toBeNull();
  });
});
