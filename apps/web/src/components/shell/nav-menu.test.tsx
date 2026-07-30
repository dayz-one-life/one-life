import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NavMenu } from "./nav-menu";

const mockStatus = vi.fn();
vi.mock("@/lib/use-account-status", () => ({ useAccountStatus: () => mockStatus() }));
const mockPathname = vi.fn(() => "/");
vi.mock("next/navigation", () => ({ usePathname: () => mockPathname() }));
const teardown = vi.fn();
vi.mock("@/lib/push", () => ({ signOutAndTeardownPush: () => teardown() }));

const open = () => fireEvent.click(screen.getByRole("button", { name: "Menu" }));

beforeEach(() => {
  vi.clearAllMocks();
  mockPathname.mockReturnValue("/");
});

describe("NavMenu", () => {
  it("is a menu button that toggles the panel", () => {
    mockStatus.mockReturnValue({ kind: "signedOut" });
    render(<NavMenu />);
    const trigger = screen.getByRole("button", { name: "Menu" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("carries the whole nav — this is the ONLY nav at every width now", () => {
    mockStatus.mockReturnValue({ kind: "signedOut" });
    render(<NavMenu />);
    open();
    for (const [label, href] of [
      ["Home", "/"],
      ["Maps", "/maps"],
      ["Survivors", "/survivors"],
      ["Obituaries", "/obituaries"],
      ["About", "/about"],
    ] as const) {
      expect(screen.getByRole("menuitem", { name: label })).toHaveAttribute("href", href);
    }
  });

  it("marks the active section with aria-current", () => {
    mockStatus.mockReturnValue({ kind: "signedOut" });
    mockPathname.mockReturnValue("/survivors/sakhal");
    render(<NavMenu />);
    open();
    expect(screen.getByRole("menuitem", { name: "Survivors" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("menuitem", { name: "Home" })).not.toHaveAttribute("aria-current");
  });

  // ⚠️ Loading, failed, empty and zero are four different renders. A signed-out item set
  // flashing before the signed-in one is how a player learns not to trust the chrome — so
  // while the status is loading the menu offers navigation and NOTHING account-shaped.
  it("loading: nav only — no Sign in, no Sign out, no account items", () => {
    mockStatus.mockReturnValue({ kind: "loading" });
    render(<NavMenu />);
    open();
    expect(screen.getByRole("menuitem", { name: "Home" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Sign in" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Sign out" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Friends" })).toBeNull();
  });

  it("signedOut: Sign in, and no Friends", () => {
    mockStatus.mockReturnValue({ kind: "signedOut" });
    render(<NavMenu />);
    open();
    expect(screen.getByRole("menuitem", { name: "Sign in" })).toHaveAttribute("href", "/login");
    expect(screen.queryByRole("menuitem", { name: "Friends" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Sign out" })).toBeNull();
  });

  it("verified: Friends, profile link on the real slug, and Sign out", () => {
    mockStatus.mockReturnValue({ kind: "verified", link: { gamertag: "YrJustBad" } });
    render(<NavMenu />);
    open();
    expect(screen.getByRole("menuitem", { name: "Friends" })).toHaveAttribute("href", "/friends");
    expect(screen.getByRole("menuitem", { name: "Your profile →" })).toHaveAttribute("href", "/players/yrjustbad");
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(teardown).toHaveBeenCalled();
  });

  it("pending: Finish verification, not Claim and not a profile", () => {
    mockStatus.mockReturnValue({ kind: "pending", link: { gamertag: "boots" } });
    render(<NavMenu />);
    open();
    expect(screen.getByRole("menuitem", { name: "Finish verification →" })).toHaveAttribute("href", "/#claim");
    expect(screen.queryByRole("menuitem", { name: "Claim your gamertag →" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Your profile →" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Friends" })).toBeInTheDocument();
  });

  // ⚠️ Same-page hash navigation goes through pushState, which fires NO hashchange event. A
  // Next <Link href="/#claim"> clicked while already on `/` would never open ClaimModal. The
  // claim items must be plain <a> elements. (`Link` renders an <a> too, so the subject here is
  // the module, not the tag — asserted by the absence of Link's data attribute is not reliable;
  // instead this is pinned by the click-closes test below plus a code comment.)
  it("unlinked: Claim link to /#claim, Sign out present, no profile", () => {
    mockStatus.mockReturnValue({ kind: "unlinked" });
    render(<NavMenu />);
    open();
    expect(screen.getByRole("menuitem", { name: "Claim your gamertag →" })).toHaveAttribute("href", "/#claim");
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Your profile →" })).toBeNull();
  });

  // ⚠️ Route-change close is NOT enough for a hash-only item: `/#claim` clicked from `/` changes
  // no route, so without an explicit close the menu stays open ON TOP of the claim modal it just
  // opened, holding a second body scroll-lock (seen in a browser, on the old account popover).
  it("closes when any item is clicked, including a hash-only one", () => {
    mockStatus.mockReturnValue({ kind: "unlinked" });
    render(<NavMenu />);
    open();
    fireEvent.click(screen.getByRole("menuitem", { name: "Claim your gamertag →" }));
    expect(screen.queryByRole("menu")).toBeNull();
    open();
    fireEvent.click(screen.getByRole("menuitem", { name: "Maps" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on Escape, on an outside click, and on a route change", () => {
    mockStatus.mockReturnValue({ kind: "signedOut" });
    const { rerender } = render(<NavMenu />);

    open();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();

    open();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();

    open();
    mockPathname.mockReturnValue("/about");
    rerender(<NavMenu />);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  // ⚠️ useModalBehavior focuses the panel, which is a silent no-op on a div with no tabindex.
  it("the panel is focusable and labelled", () => {
    mockStatus.mockReturnValue({ kind: "signedOut" });
    render(<NavMenu />);
    open();
    const menu = screen.getByRole("menu");
    expect(menu).toHaveAttribute("tabindex", "-1");
    expect(menu).toHaveAccessibleName("Menu");
  });

  it("opens with focus on the first item; arrows move and wrap", () => {
    mockStatus.mockReturnValue({ kind: "signedOut" });
    render(<NavMenu />);
    open();
    const menu = screen.getByRole("menu");
    expect(screen.getByRole("menuitem", { name: "Home" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Maps" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "End" });
    expect(screen.getByRole("menuitem", { name: "Sign in" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Home" })).toHaveFocus();
  });

  // ⚠️ LAYER LEGEND (components/header.tsx). z-50 ranks the panel INSIDE the z-40 masthead's
  // stacking context — it is not a fourth altitude. jsdom cannot see paint order, so this is
  // pinned as a class.
  it("the panel sits at the overlay rank inside the masthead", () => {
    mockStatus.mockReturnValue({ kind: "signedOut" });
    render(<NavMenu />);
    open();
    expect(screen.getByRole("menu").className).toMatch(/(^|\s)z-50(\s|$)/);
  });

  it("renders at every width — no md: hiding on the trigger", () => {
    mockStatus.mockReturnValue({ kind: "signedOut" });
    render(<NavMenu />);
    // The TabBar was `md:hidden` and the nav row was `hidden md:flex`; this replaces BOTH, so a
    // width gate anywhere here would leave one breakpoint with no navigation at all.
    expect(screen.getByRole("button", { name: "Menu" }).className).not.toMatch(/hidden|md:/);
  });
});
