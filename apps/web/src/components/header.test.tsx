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
vi.mock("@/components/shell/nav-menu", () => ({
  NavMenu: () => <div data-testid="nav-menu-stub" />,
}));

describe("Masthead", () => {
  it("renders the wordmark home link, and NO inline nav row", () => {
    render(<Masthead />);
    expect(screen.getByRole("link", { name: "One Life — home" })).toHaveAttribute("href", "/");
    // ⚠️ The nav row is GONE — shell/nav-menu.tsx is the only nav now, at every width. A
    // duplicate row here would give two sources of truth for the active section.
    expect(screen.queryByRole("navigation", { name: "Primary" })).toBeNull();
    for (const label of ["Home", "Maps", "Survivors", "About"]) {
      expect(screen.queryByRole("link", { name: label })).toBeNull();
    }
  });

  // ⚠️ This inverts a previous contract. The masthead used to assert it had NO hamburger,
  // because the TabBar was the mobile nav. The TabBar is deleted; the hamburger is the nav.
  it("mounts the nav menu — the one nav, at every width", () => {
    render(<Masthead />);
    expect(screen.getByTestId("nav-menu-stub")).toBeInTheDocument();
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
    expect(screen.getByTestId("nav-menu-stub").parentElement).toBe(cluster);
    expect(cluster?.className).toContain("ml-auto");
    expect(bell.className).not.toContain("absolute");
    expect(account.className).not.toContain("absolute");
  });

  it("the masthead is a stacking layer above page content but below full-screen overlays", () => {
    // The bell popover's own `z-50` is scoped to the right cluster's transform-created
    // stacking context, so it cannot outrank page content on its own. Anything positioned
    // later in the DOM at z-auto — any `sticky` element, the `relative` image
    // wrappers — paints over the popover unless the header itself is a
    // positioned layer. jsdom cannot observe paint order, so the contract is pinned here.
    // Word-boundary matching on purpose: `toContain("z-50")` would also pass for `focus:z-50`.
    const { container } = render(<Masthead />);
    const className = container.querySelector("header")?.className ?? "";
    // ⚠️ `sticky`, not `relative`: the masthead pins to the top so navigation is reachable from
    // the bottom of a long board or obituary. `sticky` opens a stacking context on its own, but
    // the explicit z-40 was already required (for the bell popover) and is unchanged.
    expect(className).toMatch(/(^|\s)sticky(\s|$)/);
    expect(className).toMatch(/(^|\s)top-0(\s|$)/);

    // The altitude must sit strictly between page content and the z-50 overlays that have to
    // cover the masthead — the skip-to-content link (app/layout.tsx). It renders BEFORE the
    // header, so at an equal z-index the
    // header wins on DOM order and buries the one control keyboard users have. See the LAYER
    // LEGEND in header.tsx.
    const z = Number(/(^|\s)z-(\d+)(\s|$)/.exec(className)?.[2]);
    expect(z).toBeGreaterThan(0);
    expect(z).toBeLessThan(50);
  });

  it("contains the row to the boxed content width on ultrawide screens", () => {
    const { container } = render(<Masthead />);
    const row = container.querySelector("header > div");
    expect(row).not.toBeNull();
    // Must match the (boxed) layout's box: centered, capped at 1024px (max-w-5xl), with the
    // house prose inset so the wordmark lines up with page text.
    expect(row!.className).toMatch(/(^|\s)mx-auto(\s|$)/);
    expect(row!.className).toMatch(/(^|\s)max-w-5xl(\s|$)/);
    expect(row!.className).toMatch(/(^|\s)px-6(\s|$)/);
    expect(row!.className).toMatch(/(^|\s)md:px-10(\s|$)/);
    expect(row!.className).toMatch(/(^|\s)w-full(\s|$)/);
    expect(row!.className).not.toMatch(/max-w-\[1440px\]/);
  });
});
