import { render as rtlRender, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { describe, it, expect, vi } from "vitest";
import { Masthead } from "./header";

// The masthead map switcher gates its servers query on being on a map route, but the hook
// itself runs unconditionally (rules of hooks), so every render needs a client.
const render = (ui: ReactElement) =>
  rtlRender(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {ui}
    </QueryClientProvider>,
  );

const mockPathname = vi.fn(() => "/survivors");
vi.mock("next/navigation", () => ({ usePathname: () => mockPathname() }));
vi.mock("@/components/notifications/bell", () => ({
  MastheadBell: () => <div data-testid="bell-stub" />,
}));
vi.mock("@/components/shell/account-affordance", () => ({
  AccountAffordance: () => <div data-testid="account-stub" />,
}));

describe("Masthead", () => {
  it("renders the wordmark home link and all four nav items", () => {
    render(<Masthead />);
    expect(screen.getByRole("link", { name: "One Life — home" })).toHaveAttribute("href", "/");
    for (const label of ["Home", "Maps", "Survivors", "About"]) {
      expect(screen.getAllByRole("link", { name: label }).length).toBeGreaterThan(0);
    }
  });

  it("marks the active section with aria-current and the red underline", () => {
    mockPathname.mockReturnValue("/survivors/sakhal");
    render(<Masthead />);
    const link = screen.getAllByRole("link", { name: "Survivors" })[0]!;
    expect(link).toHaveAttribute("aria-current", "page");
    // Mock app bar: active = paper text over a red underline; inactive = dimmed cream.
    expect(link.className).toContain("border-red");
    expect(link.className).toContain("text-paper");
  });

  it("has no hamburger — the TabBar replaced the mobile menu", () => {
    render(<Masthead />);
    expect(screen.queryByRole("button", { name: /open menu/i })).toBeNull();
  });

  it("wordmark declares intrinsic dimensions so the masthead cannot shift", () => {
    render(<Masthead />);
    const img = screen.getByAltText("One Life");
    expect(img).toHaveAttribute("width", "1641");
    expect(img).toHaveAttribute("height", "499");
  });

  it("the bell and the account trigger sit in one right cluster, not two competing absolute elements", () => {
    render(<Masthead />);
    const bell = screen.getByTestId("bell-stub");
    const account = screen.getByTestId("account-stub");
    const cluster = bell.parentElement;
    // Both live inside the same wrapper, which flexes to the right (`ml-auto`) — neither
    // control positions itself absolutely (the overlap the original refactor existed to fix).
    expect(account.parentElement).toBe(cluster);
    expect(cluster?.className).toContain("ml-auto");
    expect(bell.className).not.toContain("absolute");
    expect(account.className).not.toContain("absolute");
  });

  it("the masthead is a stacking layer above page content but below full-screen overlays", () => {
    // The bell popover's own `z-50` is scoped to the right cluster's transform-created
    // stacking context, so it cannot outrank page content on its own. Anything positioned
    // later in the DOM at z-auto — the `xl:sticky` HomeSidebar, the `relative` image
    // wrappers — paints over the popover unless the header itself is a
    // positioned layer. jsdom cannot observe paint order, so the contract is pinned here.
    // Word-boundary matching on purpose: `toContain("z-50")` would also pass for `focus:z-50`.
    const { container } = render(<Masthead />);
    const className = container.querySelector("header")?.className ?? "";
    expect(className).toMatch(/(^|\s)relative(\s|$)/);

    // The altitude must sit strictly between page content and the z-50 overlays that have to
    // cover the masthead — the skip-to-content link (app/layout.tsx). It renders BEFORE the
    // header, so at an equal z-index the
    // header wins on DOM order and buries the one control keyboard users have. See the LAYER
    // LEGEND in header.tsx.
    const z = Number(/(^|\s)z-(\d+)(\s|$)/.exec(className)?.[2]);
    expect(z).toBeGreaterThan(0);
    expect(z).toBeLessThan(50);
  });
});
