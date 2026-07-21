import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { Masthead } from "./header";

const mockPathname = vi.fn(() => "/survivors");
vi.mock("next/navigation", () => ({ usePathname: () => mockPathname() }));
vi.mock("@/components/notifications/bell", () => ({
  MastheadBell: () => <div data-testid="bell-stub" />,
}));
vi.mock("@/components/controls/mobile-account", () => ({
  MobileAccount: () => <div data-testid="account-stub" />,
}));

describe("Masthead", () => {
  it("renders the wordmark home link and all five nav items", () => {
    render(<Masthead />);
    expect(screen.getByRole("link", { name: "One Life — home" })).toHaveAttribute("href", "/");
    for (const label of ["News", "Obituaries", "Fresh Spawns", "Survivors", "About"]) {
      expect(screen.getAllByRole("link", { name: label }).length).toBeGreaterThan(0);
    }
  });

  it("marks the active section with aria-current and red", () => {
    mockPathname.mockReturnValue("/survivors/sakhal");
    render(<Masthead />);
    const link = screen.getAllByRole("link", { name: "Survivors" })[0]!;
    expect(link).toHaveAttribute("aria-current", "page");
    expect(link.className).toContain("text-red");
  });

  it("opens and closes the mobile menu", async () => {
    render(<Masthead />);
    await userEvent.click(screen.getByRole("button", { name: "Open menu" }));
    expect(screen.getByRole("button", { name: "Close menu" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close menu" }));
    expect(screen.queryByRole("button", { name: "Close menu" })).not.toBeInTheDocument();
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
    // Both live inside the same wrapper — so only the wrapper, not each control, positions
    // itself `absolute right-4` (the overlap this refactor exists to fix).
    expect(account.parentElement).toBe(cluster);
    expect(cluster?.className).toContain("right-4");
    expect(bell.className).not.toContain("right-4");
    expect(account.className).not.toContain("right-4");
  });

  it("the masthead is a stacking layer above page content but below full-screen overlays", () => {
    // The bell popover's own `z-50` is scoped to the right cluster's transform-created
    // stacking context, so it cannot outrank page content on its own. Anything positioned
    // later in the DOM at z-auto — the `xl:sticky` ControlsRail, the `relative` next/image
    // wrappers in news heroes — paints over the popover unless the header itself is a
    // positioned layer. jsdom cannot observe paint order, so the contract is pinned here.
    // Word-boundary matching on purpose: `toContain("z-50")` would also pass for `focus:z-50`.
    const { container } = render(<Masthead />);
    const className = container.querySelector("header")?.className ?? "";
    expect(className).toMatch(/(^|\s)relative(\s|$)/);

    // The altitude must sit strictly between page content and the z-50 overlays that have to
    // cover the masthead — the skip-to-content link (app/layout.tsx) and the ControlsSheet
    // (controls/sheet.tsx). The skip link renders BEFORE the header, so at an equal z-index the
    // header wins on DOM order and buries the one control keyboard users have. See the LAYER
    // LEGEND in header.tsx.
    const z = Number(/(^|\s)z-(\d+)(\s|$)/.exec(className)?.[2]);
    expect(z).toBeGreaterThan(0);
    expect(z).toBeLessThan(50);
  });
});
