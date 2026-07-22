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
    expect(screen.queryByText("0")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(/loading/i);
  });

  it("swaps tokens for the dark sheet surface while loading", () => {
    render(<FriendsPanel loading />);
    const lightStatus = screen.getByRole("status");
    expect(lightStatus.className).toMatch(/\btext-ink-muted\b/);
    expect(lightStatus.className).not.toMatch(/\btext-cream-muted\b/);
    const lightContainer = lightStatus.parentElement as HTMLElement;
    expect(lightContainer.className).toMatch(/\bborder-hairline\b/);

    const { container: darkContainer } = render(<FriendsPanel loading boxed />);
    const darkStatus = darkContainer.querySelector('[role="status"]') as HTMLElement;
    expect(darkStatus.className).toMatch(/\btext-cream-muted\b/);
    expect(darkStatus.className).not.toMatch(/\btext-ink-muted\b/);
    const darkRoot = darkContainer.firstElementChild as HTMLElement;
    expect(darkRoot.className).toMatch(/\bborder-dark-line\b/);
  });

  // ⚠️ The rail is light paper; the mobile sheet is bg-dark. A panel written only in
  // text-ink/border-ink is present, functional and INVISIBLE on a phone — exactly how the
  // notifications panel shipped in v0.26.0. RTL asserts the DOM, not contrast, so the
  // token swap itself needs pinning or the whole suite stays green while it is broken.
  it("swaps its tokens for the dark sheet surface", () => {
    const { container: light } = render(<FriendsPanel friendCount={1} requestCount={2} />);
    const lightRoot = light.firstElementChild as HTMLElement;
    expect(lightRoot.className).toMatch(/\btext-ink\b/);
    expect(lightRoot.className).not.toMatch(/\btext-paper\b/);
    // Badge must render on light surface with bg-red-deep
    expect(lightRoot.innerHTML).toMatch(/\bbg-red-deep\b/);

    const { container: dark } = render(<FriendsPanel friendCount={1} requestCount={2} boxed />);
    const darkRoot = dark.firstElementChild as HTMLElement;
    expect(darkRoot.className).toMatch(/\btext-paper\b/);
    expect(darkRoot.className).not.toMatch(/\btext-ink\b/);
    // Badge must render on dark surface with bg-red, not bg-red-deep
    expect(darkRoot.innerHTML).toMatch(/\bbg-red\b/);
    // red-deep is a LIGHT-surface token only: on dark it drops to ~3.2:1 and fails AA.
    expect(darkRoot.innerHTML).not.toMatch(/red-deep/);
  });

  it("renders 'Friends 0' when loaded with zero friends", () => {
    render(<FriendsPanel friendCount={0} requestCount={0} />);
    const link = screen.getByRole("link", { name: /friends/i });
    expect(link).toHaveTextContent("Friends 0");
  });

  it("hides the count when the fetch has failed (error state)", () => {
    render(<FriendsPanel error={true} />);
    const link = screen.getByRole("link", { name: /friends/i });
    expect(link).toHaveTextContent("Friends");
    // The link itself should still be present and working
    expect(link).toHaveAttribute("href", "/friends");
    // Should NOT render any number
    expect(link).not.toHaveTextContent("0");
  });

  it("does not show request badge when count is unknown (error state)", () => {
    render(<FriendsPanel error={true} requestCount={2} />);
    expect(screen.queryByLabelText(/pending friend requests/i)).toBeNull();
  });
});
