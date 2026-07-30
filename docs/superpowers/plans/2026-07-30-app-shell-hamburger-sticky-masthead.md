# App Shell: Hamburger Menu, Sticky Masthead, One Page Width — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mobile bottom tab bar with a single hamburger menu that works at every
width, make the masthead sticky, and settle every non-map page at one 1024px content width.

**Architecture:** One new client component, `components/shell/nav-menu.tsx`, owns all navigation
and all account items in one dropdown. `components/shell/account-affordance.tsx` shrinks to a
plain avatar link (to `/`) plus the signed-out `SIGN IN` link. `components/shell/tab-bar.tsx` is
deleted along with the two bottom gutters that reserved space for it. `components/header.tsx`
goes `relative` → `sticky top-0` and loses its inline nav row. `app/(site)/(boxed)/layout.tsx`
becomes the only declaration of content width.

**Tech Stack:** Next.js App Router (client components), React 18, Tailwind, Vitest + React
Testing Library (jsdom), TanStack Query.

**Spec:** `docs/superpowers/specs/2026-07-30-app-shell-hamburger-sticky-masthead-design.md`

## Global Constraints

- **All paths below are relative to `apps/web/`.** `@/` resolves to `apps/web/src/`.
- **Test command:** `pnpm --filter @onelife/web test` (append `-- <path>` to scope to one file).
  Typecheck: `pnpm --filter @onelife/web run typecheck`. Do **not** source `.env` for the web
  suite.
- **LAYER LEGEND (`components/header.tsx`) is unchanged by this work.** Three altitudes only:
  `z-auto` page content, `z-40` chrome (the masthead), `z-50` full-screen overlays. The menu
  panel is `z-50` *inside* the `z-40` masthead — that ranks it within the header's stacking
  context and adds no fourth altitude. The masthead must stay strictly below `z-50`.
- **RTL asserts the DOM, not paint order, contrast or viewport width.** Anything about overlap,
  stickiness or narrow widths is pinned as a class string with a ⚠️ comment saying why, and goes
  on the outstanding-device-check list.
- **Loading, failed, empty and zero are four different renders.** In this plan that means: while
  `useAccountStatus()` returns `kind: "loading"`, the menu renders its nav section only — never a
  signed-out affordance that would be swapped a frame later.
- **A ⚠️ comment in the code is load-bearing.** Where a task deletes or rewrites one, it says so
  explicitly. Never drop one silently.
- **Copy is fixed.** Menu item labels are exactly: `Home`, `Maps`, `Survivors`, `Obituaries`,
  `About`, `Friends`, `Your profile →`, `Finish verification →`, `Claim your gamertag →`,
  `Sign out`, `Sign in`. The arrow is `→` (U+2192), preceded by one space.
- **Commit after every task**, with the trailer:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- **Branch:** `feature/hamburger-nav-sticky-masthead` (already created off `origin/main`).

---

### Task 1: The NavMenu component

The one menu. Nav items on top, account items below a divider, one panel at every width.

**Files:**
- Create: `src/components/shell/nav-menu.tsx`
- Create: `src/components/shell/nav-menu.test.tsx`

**Interfaces:**
- Consumes:
  - `NAV_ITEMS` and `activeNavKey(pathname: string): NavKey | null` from `@/lib/nav` — already
    exist, unchanged. `NAV_ITEMS` is `readonly { key, href, label }[]` covering Home, Maps,
    Survivors, Obituaries, About.
  - `useAccountStatus(): AccountStatus` from `@/lib/use-account-status`. Its `kind` is one of
    `"loading" | "signedOut" | "unlinked" | "pending" | "verified"`; `pending` and `verified`
    additionally carry `link: { gamertag: string }`.
  - `useModalBehavior(open: boolean, onClose: () => void): RefObject<HTMLDivElement | null>`
    from `@/lib/use-modal-behavior` — handles Escape, focus restore and a ref-counted body
    scroll lock. **The panel it is attached to MUST carry `tabIndex={-1}`**, or its
    `panelRef.current?.focus()` is a silent no-op.
  - `signOutAndTeardownPush(): Promise<void>` from `@/lib/push`.
  - `playerSlug(gamertag: string): string` from `@/lib/slug`.
  - `cn(...)` from `@/lib/utils`.
- Produces: `export function NavMenu(): JSX.Element` — takes **no props**. Task 3 mounts it in
  the masthead's right cluster.

- [ ] **Step 1: Write the failing test**

Create `src/components/shell/nav-menu.test.tsx`:

```tsx
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @onelife/web test -- src/components/shell/nav-menu.test.tsx
```

Expected: FAIL — `Failed to resolve import "./nav-menu"`.

- [ ] **Step 3: Write the implementation**

Create `src/components/shell/nav-menu.tsx`:

```tsx
"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { NAV_ITEMS, activeNavKey } from "@/lib/nav";
import { useAccountStatus } from "@/lib/use-account-status";
import { useModalBehavior } from "@/lib/use-modal-behavior";
import { signOutAndTeardownPush } from "@/lib/push";
import { playerSlug } from "@/lib/slug";
import { cn } from "@/lib/utils";

/**
 * THE navigation. Not a mobile menu — the one menu, at every width.
 *
 * It replaces two things at once: the desktop inline nav row that used to live in the masthead,
 * and `shell/tab-bar.tsx`, the fixed bottom bar below `md` (both deleted). So a width gate
 * anywhere in here leaves some breakpoint with no way to navigate.
 *
 * It also absorbed the account items from `shell/account-affordance.tsx`, which is now just the
 * avatar link. One panel: nav on top, a divider, then account.
 *
 * ⚠️ Mechanics are the old account popover's, kept verbatim because each line is a shipped bug:
 *  - the panel MUST carry `tabIndex={-1}` — `useModalBehavior` focuses it, and focusing a div
 *    with no tabindex is a silent no-op.
 *  - EVERY item closes the menu explicitly. Route-change close is not enough for `/#claim`,
 *    which from `/` changes no route: the menu would sit open on top of the claim modal it just
 *    opened, holding a second (ref-counted) body scroll-lock.
 *  - the claim items are plain <a>, never <Link>: same-page hash navigation goes through
 *    pushState, which fires no `hashchange`, so a <Link href="/#claim"> clicked while already on
 *    `/` would never open ClaimModal. From any other page this is a normal navigation and the
 *    modal's mount-time hash check catches it.
 *  - `z-50` on the panel ranks it INSIDE the z-40 masthead's stacking context. No fourth
 *    altitude — see the LAYER LEGEND in `components/header.tsx`.
 */
export function NavMenu() {
  const status = useAccountStatus();
  const signedIn = status.kind === "unlinked" || status.kind === "pending" || status.kind === "verified";

  const [open, setOpen] = useState(false);
  const panelRef = useModalBehavior(open, () => setOpen(false));
  const rootRef = useRef<HTMLDivElement>(null);

  const pathname = usePathname();
  const active = activeNavKey(pathname ?? "/");
  const prevPath = useRef(pathname);
  useEffect(() => {
    if (prevPath.current !== pathname) setOpen(false);
    prevPath.current = pathname;
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Minimal roving-focus menu contract: focus the first item on open, then Arrow/Home/End move
  // focus between items (wrapping). Escape/outside-click/route-close are handled above already.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const items = Array.from(panel.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    items[0]?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
      e.preventDefault();
      const current = items.indexOf(document.activeElement as HTMLElement);
      let next: number;
      if (e.key === "Home") next = 0;
      else if (e.key === "End") next = items.length - 1;
      else if (e.key === "ArrowDown") next = current < 0 ? 0 : (current + 1) % items.length;
      else next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
      items[next]?.focus();
    };
    panel.addEventListener("keydown", onKeyDown);
    return () => panel.removeEventListener("keydown", onKeyDown);
  }, [open, panelRef]);

  const close = () => setOpen(false);
  const itemClass =
    "block w-full px-3 py-2.5 text-left font-mono text-[11px] uppercase tracking-[.08em] text-cream-dim hover:bg-dark-well hover:text-red-soft";
  const activeClass = "text-paper";
  const gamertag = status.kind === "verified" ? status.link.gamertag : null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="nav-menu"
        // min 44px target: this is the only navigation control on a phone.
        className="flex h-11 w-11 items-center justify-center text-paper hover:text-red"
      >
        <span aria-hidden className="text-[19px] leading-none">
          ☰
        </span>
      </button>
      {open && (
        <div
          ref={panelRef}
          id="nav-menu"
          role="menu"
          aria-label="Menu"
          tabIndex={-1}
          className="absolute right-0 top-full z-50 mt-2 w-[220px] border border-dark-line bg-dark py-1 shadow-[0_10px_30px_rgba(0,0,0,.45)]"
        >
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.key}
              role="menuitem"
              href={item.href}
              aria-current={active === item.key ? "page" : undefined}
              onClick={close}
              className={cn(itemClass, active === item.key && activeClass)}
            >
              {item.label}
            </Link>
          ))}
          {/* Friends is not in NAV_ITEMS — it is behind auth, and NAV_ITEMS is the public nav
           *  that also feeds the sitemap and the footer's reasoning. */}
          {signedIn && (
            <Link
              role="menuitem"
              href="/friends"
              aria-current={pathname?.startsWith("/friends") ? "page" : undefined}
              onClick={close}
              className={cn(itemClass, pathname?.startsWith("/friends") && activeClass)}
            >
              Friends
            </Link>
          )}

          {/* ⚠️ Nothing account-shaped while the status is loading: an item set that has to be
           *  swapped a frame later is worse than one that arrives a frame late. */}
          {status.kind !== "loading" && (
            <div className="mt-1 border-t border-dark-line pt-1">
              {status.kind === "signedOut" ? (
                <Link role="menuitem" href="/login" onClick={close} className={itemClass}>
                  Sign in
                </Link>
              ) : (
                <>
                  {gamertag ? (
                    <Link
                      role="menuitem"
                      href={`/players/${playerSlug(gamertag)}`}
                      onClick={close}
                      className={itemClass}
                    >
                      Your profile →
                    </Link>
                  ) : status.kind === "pending" ? (
                    // Plain <a>, not <Link> — see the ⚠️ at the top of this file.
                    <a role="menuitem" href="/#claim" onClick={close} className={itemClass}>
                      Finish verification →
                    </a>
                  ) : (
                    <a role="menuitem" href="/#claim" onClick={close} className={itemClass}>
                      Claim your gamertag →
                    </a>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      close();
                      void signOutAndTeardownPush();
                    }}
                    className={itemClass}
                  >
                    Sign out
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @onelife/web test -- src/components/shell/nav-menu.test.tsx
pnpm --filter @onelife/web run typecheck
```

Expected: PASS, and typecheck clean.

If the `aria-current` assertion on Friends fails because `pathname?.startsWith(...)` yields
`undefined` rather than a boolean, wrap it: `Boolean(pathname?.startsWith("/friends"))`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/shell/nav-menu.tsx apps/web/src/components/shell/nav-menu.test.tsx
git commit -m "feat(web): one nav menu for every width

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Shrink AccountAffordance to the avatar link

The avatar stops being a menu trigger and becomes a plain link to `/` — the player's own home.
Its account items now live in `NavMenu` (Task 1). The signed-out `SIGN IN` link stays visible in
the masthead, because it is the primary conversion action and must not be buried a tap deep.

**Files:**
- Modify: `src/components/shell/account-affordance.tsx` (full rewrite — it drops ~100 lines)
- Modify: `src/components/shell/account-affordance.test.tsx` (full rewrite)

**Interfaces:**
- Consumes: `useAccountStatus`, `getAvatar` from `@/lib/api`, `Avatar` from
  `@/components/shared/avatar`, `cn` from `@/lib/utils`.
- Produces: `export function AccountAffordance(): JSX.Element | null` — unchanged name and
  no props, so Task 3's masthead import does not move.

- [ ] **Step 1: Rewrite the test**

Replace the whole contents of `src/components/shell/account-affordance.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AccountAffordance } from "./account-affordance";

const mockStatus = vi.fn();
vi.mock("@/lib/use-account-status", () => ({ useAccountStatus: () => mockStatus() }));
vi.mock("@/lib/api", () => ({ getAvatar: vi.fn().mockResolvedValue({ hash: null }) }));

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><AccountAffordance /></QueryClientProvider>);
}

beforeEach(() => vi.clearAllMocks());

describe("AccountAffordance", () => {
  // ⚠️ Loading, failed, empty and zero are four different renders. Rendering the signed-out
  // chip while the session is still resolving means it gets swapped for an avatar a frame
  // later, which is how a player learns not to trust the chrome.
  it("renders nothing while loading", () => {
    mockStatus.mockReturnValue({ kind: "loading" });
    const { container } = renderIt();
    expect(container).toBeEmptyDOMElement();
  });

  it("signed out: a visible Sign in link, not buried in the menu", () => {
    mockStatus.mockReturnValue({ kind: "signedOut" });
    renderIt();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  });

  // ⚠️ The disc is a LINK to home now, not a menu button. Its old popover moved wholesale into
  // shell/nav-menu.tsx — there is exactly one menu in the masthead.
  it("signed in: the disc is a link to home, and no menu button anywhere", () => {
    mockStatus.mockReturnValue({ kind: "verified", link: { gamertag: "YrJustBad" } });
    renderIt();
    expect(screen.getByRole("link", { name: /your home/i })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("pending: shows the tag initial with the yellow cue on the ring", () => {
    mockStatus.mockReturnValue({ kind: "pending", link: { gamertag: "boots" } });
    const { container } = renderIt();
    expect(screen.getByRole("link", { name: /your home/i })).toHaveTextContent("B");
    // The cue lives on the Avatar's ring, not the anchor — asserting it on the anchor would
    // pass vacuously against a cue that had silently vanished.
    expect(container.querySelector('[aria-hidden="true"]')!.className).toContain("border-yellow");
  });

  it.each(["verified", "unlinked"] as const)("%s disc carries no yellow pending cue", (kind) => {
    mockStatus.mockReturnValue(kind === "verified" ? { kind, link: { gamertag: "X" } } : { kind });
    const { container } = renderIt();
    const disc = container.querySelector('[aria-hidden="true"]')!;
    expect(disc.className).not.toContain("border-yellow");
    expect(disc.className).toContain("border-dark-edge-bright");
  });

  it("unlinked: an anonymous disc that still goes home", () => {
    mockStatus.mockReturnValue({ kind: "unlinked" });
    renderIt();
    expect(screen.getByRole("link", { name: /your home/i })).toHaveTextContent("•");
  });

  // The masthead is DARK. Rendering through Avatar without variant="dark" produces the paper
  // tokens — ink on dark, i.e. present, functional and invisible (the v0.26.0 bug).
  it("renders the avatar through the shared Avatar on the dark variant", () => {
    mockStatus.mockReturnValue({ kind: "verified", link: { gamertag: "YrJustBad" } });
    const { container } = renderIt();
    const disc = container.querySelector('[aria-hidden="true"]')!;
    expect(disc.className).toContain("rounded-full");
    expect(disc.className).toContain("bg-dark-well");
    expect(disc.className).toContain("text-paper");
    expect(disc.className).not.toContain("bg-bone");
    // The hover state reaches Avatar via `group` on the anchor.
    expect(disc.className).toContain("group-hover:border-red");
    expect(container.querySelector("a")!.className).toContain("group");
  });

  it("never links to /you anywhere", () => {
    mockStatus.mockReturnValue({ kind: "verified", link: { gamertag: "X" } });
    const { container } = renderIt();
    expect(container.querySelector('a[href="/you"]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @onelife/web test -- src/components/shell/account-affordance.test.tsx
```

Expected: FAIL — the current component still renders a `button` named "Your account", so
`getByRole("link", { name: /your home/i })` finds nothing.

- [ ] **Step 3: Rewrite the component**

Replace the whole contents of `src/components/shell/account-affordance.tsx`:

```tsx
"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useAccountStatus } from "@/lib/use-account-status";
import { getAvatar } from "@/lib/api";
import { Avatar } from "@/components/shared/avatar";
import { cn } from "@/lib/utils";

/**
 * The masthead's account face: an avatar disc that LINKS TO `/`.
 *
 * `/` is the player's own home — the ledger, the tickets, the controls slab — so the avatar
 * means "you" and goes there. It used to open a popover; those items (profile / claim / sign
 * out) moved into `shell/nav-menu.tsx`, so the masthead has exactly one menu.
 *
 * ⚠️ Signed out this renders a VISIBLE `Sign in` link rather than nothing. It is the primary
 * conversion action on a marketing surface; the menu carries it too, but not only.
 *
 * ⚠️ Renders nothing while the status is loading — a Sign in chip swapped for an avatar a frame
 * later teaches a player not to trust the chrome.
 */
export function AccountAffordance() {
  const status = useAccountStatus();
  const signedIn = status.kind === "unlinked" || status.kind === "pending" || status.kind === "verified";
  const avatar = useQuery({ queryKey: ["avatar"], queryFn: getAvatar, enabled: signedIn });

  if (status.kind === "loading") return null;

  if (status.kind === "signedOut") {
    return (
      <Link
        href="/login"
        className="flex min-h-[44px] items-center px-2 font-display text-[13px] font-semibold uppercase tracking-[.08em] text-paper hover:text-red"
      >
        Sign in
      </Link>
    );
  }

  const gamertag = status.kind === "verified" ? status.link.gamertag : null;
  // A pending player has a claimed tag too — show its initial rather than an anonymous dot,
  // and mark the disc with the verification yellow so the state is visible at every width.
  const pendingTag = status.kind === "pending" ? status.link.gamertag : null;
  const initial = (gamertag ?? pendingTag)?.trim().charAt(0).toUpperCase() || "•";

  return (
    <Link href="/" aria-label="Your home" className="group flex h-9 w-9 items-center justify-center rounded-full">
      {/* The ring, fill and glyph all come from `Avatar` — see the ⚠️ at that component. The
          pending cue and the hover both reach it through `className`, which `cn` merges LAST:
          `border-yellow` replaces the variant's `border-dark-edge-bright` (same Tailwind class
          group), while `group-hover:border-red` is a variant group and survives alongside it.
          That is why the cue and the hover do not cancel each other out. */}
      <Avatar
        hash={avatar.data?.hash ?? null}
        size={36}
        fallbackInitial={initial}
        variant="dark"
        className={cn("group-hover:border-red group-hover:text-red", pendingTag && "border-yellow")}
      />
    </Link>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @onelife/web test -- src/components/shell/account-affordance.test.tsx
pnpm --filter @onelife/web run typecheck
```

Expected: PASS, typecheck clean. Note the `Avatar` renders the initial inside an
`aria-hidden` element, so `toHaveTextContent("B")` on the anchor still reads it — if it does
not, assert on `container.querySelector('[aria-hidden="true"]')` instead.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/shell/account-affordance.tsx apps/web/src/components/shell/account-affordance.test.tsx
git commit -m "refactor(web): avatar links home; account items move to the nav menu

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Sticky masthead, no inline nav row, 1024px bar

**Files:**
- Modify: `src/components/header.tsx` — delete `NavLinks` (lines 27–48), delete the `<nav>` block
  (lines 85–92), change `relative` → `sticky top-0` (line 73), change the row's box (line 75),
  mount `NavMenu` in the right cluster.
- Modify: `src/components/header.test.tsx`
- Modify: `src/app/globals.css` — add the `scroll-padding-top` rule.

**Interfaces:**
- Consumes: `NavMenu` from `@/components/shell/nav-menu` (Task 1),
  `AccountAffordance` from `@/components/shell/account-affordance` (Task 2).
- Produces: nothing new. `Masthead` keeps its name and takes no props.

- [ ] **Step 1: Update the test**

In `src/components/header.test.tsx`:

(a) Add a `NavMenu` stub beside the existing mocks:

```tsx
vi.mock("@/components/shell/nav-menu", () => ({
  NavMenu: () => <div data-testid="nav-menu-stub" />,
}));
```

(b) Replace the first test (`"renders the wordmark home link and all four nav items"`) with:

```tsx
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
```

(c) Delete the second test entirely — `"marks the active section with aria-current and the red
underline"`. That contract moved to `nav-menu.test.tsx`, which already asserts it.

(d) Replace the third test (`"has no hamburger — the TabBar replaced the mobile menu"`) with:

```tsx
  // ⚠️ This inverts a previous contract. The masthead used to assert it had NO hamburger,
  // because the TabBar was the mobile nav. The TabBar is deleted; the hamburger is the nav.
  it("mounts the nav menu — the one nav, at every width", () => {
    render(<Masthead />);
    expect(screen.getByTestId("nav-menu-stub")).toBeInTheDocument();
  });
```

(e) In `"the bell and the account trigger sit in one right cluster…"`, extend the cluster check
to the menu:

```tsx
    expect(screen.getByTestId("nav-menu-stub").parentElement).toBe(cluster);
```

(f) Replace the altitude test's position assertion — change

```tsx
    expect(className).toMatch(/(^|\s)relative(\s|$)/);
```

to

```tsx
    // ⚠️ `sticky`, not `relative`: the masthead pins to the top so navigation is reachable from
    // the bottom of a long board or obituary. `sticky` opens a stacking context on its own, but
    // the explicit z-40 was already required (for the bell popover) and is unchanged.
    expect(className).toMatch(/(^|\s)sticky(\s|$)/);
    expect(className).toMatch(/(^|\s)top-0(\s|$)/);
```

(g) Replace the last test's box assertions:

```tsx
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @onelife/web test -- src/components/header.test.tsx
```

Expected: FAIL — no `nav-menu-stub`, header is still `relative`, row is still `max-w-[1440px]`.

- [ ] **Step 3: Change the component**

In `src/components/header.tsx`:

(a) Add the import beside the existing ones:

```tsx
import { NavMenu } from "@/components/shell/nav-menu";
```

(b) Delete the entire `NavLinks` function (lines 27–48) and the now-unused imports it was the
only consumer of: `NAV_ITEMS`, `activeNavKey` from `@/lib/nav`, and `cn` from `@/lib/utils`.
**Check first** whether `cn` is used elsewhere in the file — at time of writing it is not.
Also delete `const active = activeNavKey(pathname ?? "/");` from `Masthead`.

(c) Change the `<header>` class and the row's box:

```tsx
    <header className="sticky top-0 z-40 bg-dark">
      {/* Same box as (boxed)/layout.tsx, plus the house prose inset (px-6 md:px-10) so the
          wordmark aligns with page text rather than the box edge. The dark bar stays full-bleed. */}
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-7 px-6 md:px-10">
```

Extend the existing LAYER LEGEND comment above `<header>` with one line, do not replace it:

```tsx
    //   ⚠️ The masthead is `sticky top-0`. Sticky opens a stacking context on its own, but the
    //   explicit z-40 above predates that (the bell popover needs it) and still governs.
```

(d) Delete the whole `<nav aria-label="Primary">…</nav>` block including its preceding comment
(lines 85–92) — that comment describes the TabBar, which is deleted in Task 4.

(e) Add `NavMenu` as the last child of the right cluster:

```tsx
        <div className="ml-auto flex min-w-0 flex-none items-center gap-2">
          <MastheadMapSwitcher pathname={pathname ?? "/"} />
          <MastheadBell />
          <AccountAffordance />
          <NavMenu />
        </div>
```

- [ ] **Step 4: Add the scroll offset**

In `src/app/globals.css`, immediately above the existing `body { … }` rule (line 42), add:

```css
/* ⚠️ The masthead is `sticky top-0` and 3.5rem tall, so an in-page anchor target scrolls to a
   position UNDER it. `/#claim` is the live one. */
html { scroll-padding-top: 3.5rem; }
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm --filter @onelife/web test -- src/components/header.test.tsx
pnpm --filter @onelife/web run typecheck
```

Expected: PASS, typecheck clean (no unused-import errors from the deleted `NavLinks`).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/header.tsx apps/web/src/components/header.test.tsx apps/web/src/app/globals.css
git commit -m "feat(web): sticky masthead with the nav menu replacing the inline row

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Delete the TabBar and both gutters that reserved space for it

**Files:**
- Delete: `src/components/shell/tab-bar.tsx`
- Delete: `src/components/shell/tab-bar.test.tsx`
- Modify: `src/app/(site)/layout.tsx` — drop the import, the `<TabBar />`, and rewrite the two
  ⚠️ comments that describe it.
- Modify: `src/app/(site)/layout.test.tsx` — drop the mock, assert its absence.
- Modify: `src/components/footer.tsx` — shrink the bottom gutter; rewrite the doc comment.
- Modify: `src/components/footer.test.tsx` — the gutter test's expected class changes.
- Modify: `src/components/map/shell/friends-panel.tsx` — the mobile sheet and its backdrop drop
  to `bottom-0`.

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing. This task only removes.

- [ ] **Step 1: Update the tests**

(a) `src/app/(site)/layout.test.tsx` — delete the `vi.mock("@/components/shell/tab-bar", …)`
block, and replace the test `"renders the masthead, footer and tab bar that /maps deliberately
opts out of"` with:

```tsx
  test("renders the masthead and footer that /maps deliberately opts out of", () => {
    render(<SiteLayout><div data-testid="child" /></SiteLayout>);
    expect(screen.getByTestId("masthead")).toBeInTheDocument();
    expect(screen.getByTestId("footer")).toBeInTheDocument();
  });

  // ⚠️ The fixed bottom tab bar is DELETED — shell/nav-menu.tsx in the masthead is the nav at
  // every width now. Reintroducing a bar here also reintroduces the two gutters (the footer's
  // and the map friends sheet's) that had to reserve space for it.
  test("renders no bottom bar", () => {
    render(<SiteLayout><div data-testid="child" /></SiteLayout>);
    expect(screen.queryByRole("navigation", { name: /quick access/i })).toBeNull();
  });
```

Keep the two existing tests `"does NOT carry the tab-bar gutter — that belongs to the footer"`
and `"does NOT constrain width — the 1440px box belongs to (boxed)"`, but retitle the first to
`"does NOT carry a bottom gutter — that belongs to the footer"`. (The second is amended in
Task 5, not here.)

(b) `src/components/footer.test.tsx` — replace the gutter test with:

```tsx
// ⚠️ Regression guard, narrowed. The fixed tab bar is gone, so the 4rem it reserved goes with
// it — but the safe-area inset stays: that is the phone's home indicator, not the bar. The
// footer is the last in-flow element in the document, so the inset belongs here and not on the
// content column. jsdom cannot see the overlap, so the contract is pinned as a class.
it("reserves only the safe-area inset at the bottom — the tab bar is gone", () => {
  render(<Footer />);
  const footer = screen.getByRole("contentinfo");
  expect(footer.className).toMatch(/pb-\[calc\(18px\+env\(safe-area-inset-bottom\)\)\]/);
  expect(footer.className).not.toMatch(/4rem/);
  expect(footer.className).not.toMatch(/md:pb-/);
});
```

Also fix the stale comment above `"carries the About link, which the tab bar does not"` — retitle
that test to `"carries the About link"` and replace its comment with:

```tsx
// About, Terms and Privacy are reached from here and from the sign-in consent line. About is
// also in the nav menu; Terms and Privacy are footer-only by design — nobody navigates to them.
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @onelife/web test -- "src/app/(site)/layout.test.tsx" src/components/footer.test.tsx
```

Expected: FAIL — the layout still renders a "Quick access" nav, and the footer still has the
`4rem` gutter.

- [ ] **Step 3: Delete the TabBar and unwire it**

```bash
git rm apps/web/src/components/shell/tab-bar.tsx apps/web/src/components/shell/tab-bar.test.tsx
```

In `src/app/(site)/layout.tsx`: delete `import { TabBar } from "@/components/shell/tab-bar";`
and the `<TabBar />` element, and replace the first ⚠️ comment block (the one starting "The
TabBar gutter is NOT here") with:

```tsx
      {/* ⚠️ The bottom safe-area inset is NOT here — it is on the <Footer/>, which is the last
       *  in-flow element in the document. Padding this column instead leaves the footer itself
       *  under the phone's home indicator. (It used to reserve the fixed TabBar's 4rem as well;
       *  that bar is deleted — shell/nav-menu.tsx in the masthead is the nav now.) */}
```

Leave the second ⚠️ comment (about `flex flex-col` and `/maps/[map]`) untouched — it is about
the map's height chain, not the bar. Its "NO max-width here" clause is still true and is amended
in Task 5.

In `src/components/footer.tsx`: change the class

```
pb-[calc(18px+4rem+env(safe-area-inset-bottom))] … md:pb-[18px]
```

to

```
pb-[calc(18px+env(safe-area-inset-bottom))]
```

so the element reads:

```tsx
    <footer className="bg-dark px-10 pt-[18px] pb-[calc(18px+env(safe-area-inset-bottom))] text-center font-mono text-xs uppercase tracking-[.08em] text-paper">
```

and replace the ⚠️ comment above it with:

```tsx
    // ⚠️ The bottom safe-area inset lives HERE, not on the layout's content column. The footer
    // is a sibling AFTER that column, so it is the last in-flow element in the document —
    // padding the column leaves the footer under the phone's home indicator. It used to reserve
    // the fixed TabBar's 4rem too (verified in a browser: with the gutter on the column the bar
    // sat directly over this About link); the bar is deleted, the reasoning is not.
```

Also replace the module doc comment at the top of `footer.tsx` — it claims About is here
"because the mobile TabBar carries the other four nav items", which is no longer true:

```tsx
/** About, Obituaries, Terms and Privacy. About and Obituaries are also in the nav menu; these
 *  are the reading routes at the bottom of a page. Terms and Privacy are footer-only by design:
 *  nobody navigates to them, they are reached from here and from the sign-in consent line. */
```

In `src/components/map/shell/friends-panel.tsx`, both the backdrop and the sheet drop their
tab-bar offset:

- backdrop: `className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] top-0 z-50 md:hidden"`
  → `className="fixed inset-0 z-50 md:hidden"`
- sheet: `bottom-[calc(4rem+env(safe-area-inset-bottom))]` → `bottom-0 pb-[env(safe-area-inset-bottom)]`
  (keep every other class on that element exactly as it is, including the whole `md:` run)

and rewrite the two comments that explain the offset:

```tsx
          {/* ⚠️ THE WAY OUT ON A TOUCH DEVICE. Below `md` the sheet is fixed and there is no
              Escape key. This backdrop and the Close button below are exits and both must stay.
              (They used to stop above the fixed TabBar so its tabs stayed tappable; that bar is
              deleted, so the backdrop covers the map fully.) `aria-hidden` + no role: it is a
              gesture target, not content — the dialog is `aria-modal` so AT already ignores what
              is behind it. Same z-50 overlay altitude as the sheet, painted under it by DOM
              order, so this adds no fourth altitude to the LAYER LEGEND. */}
```

```tsx
          {/* z-50 is the overlay altitude (LAYER LEGEND, components/header.tsx). A bottom sheet
              on a phone, sitting on the viewport floor with the home-indicator inset as padding;
              from `md` up an anchored panel that opens UPWARD — `bottom-full`, because the
              trigger sits at the bottom edge of the map, where a `top-full` panel renders off
              the bottom of the page (shipped that way once). */}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @onelife/web test
pnpm --filter @onelife/web run typecheck
```

Expected: PASS. If any other file still imports `@/components/shell/tab-bar`, typecheck names
it — at time of writing `app/(site)/layout.tsx` and its test are the only two.

- [ ] **Step 5: Commit**

```bash
git add -A apps/web/src
git commit -m "feat(web): delete the mobile tab bar and the gutters that reserved space for it

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: One content width — 1024px everywhere except the map

**Files:**
- Modify: `src/app/(site)/(boxed)/layout.tsx` and `src/app/(site)/(boxed)/layout.test.tsx`
- Modify: `src/app/(site)/layout.test.tsx` — one test name/expectation mentions 1440
- Move: `src/app/(site)/obituaries/` → `src/app/(site)/(boxed)/obituaries/` (both `page.tsx`
  files and anything else in that directory)
- Modify (drop `mx-auto max-w-*`, keep padding):
  - `src/app/(site)/(boxed)/obituaries/page.tsx:32`
  - `src/app/(site)/(boxed)/page.tsx:53`
  - `src/app/(site)/(boxed)/about/page.tsx:76`
  - `src/app/(site)/(boxed)/survivors/page.tsx:31`
  - `src/app/(site)/(boxed)/friends/page.tsx:12`
  - `src/app/(site)/(boxed)/players/[slug]/[map]/lives/[n]/page.tsx:42`

**Interfaces:**
- Consumes: nothing new.
- Produces: `(boxed)/layout.tsx` is the sole declaration of content width. No page under it may
  declare `mx-auto max-w-*` on its top-level element again.

**Do NOT touch** (deliberate exceptions, all three are prose measures or a form):
- `src/app/(site)/(boxed)/login/page.tsx` — keeps `max-w-md`
- `src/components/legal/legal-doc.tsx` — keeps `mx-auto max-w-3xl` (Terms, Privacy)
- `src/components/obituaries/obituary-article.tsx` — keeps `mx-auto max-w-3xl`
- the inner `max-w-3xl` on About's standfirst paragraph
- `src/app/(site)/maps/` — untouched, stays outside `(boxed)`, stays full-bleed

- [ ] **Step 1: Update the layout tests**

Replace the body of `src/app/(site)/(boxed)/layout.test.tsx`:

```tsx
import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import BoxedLayout from "./layout";

describe("BoxedLayout", () => {
  // ⚠️ THE ONLY declaration of content width in the app. Every page in this group used to set
  // its own — 1024 here, 68ch there, nothing at all on four of them — so the app was three
  // different widths on a wide monitor. A page-level `mx-auto max-w-*` is a regression.
  test("centers content in the 1024px box", () => {
    const { container } = render(<BoxedLayout><div /></BoxedLayout>);
    const box = container.firstElementChild!;
    expect(box.className).toMatch(/(^|\s)max-w-5xl(\s|$)/);
    expect(box.className).toMatch(/(^|\s)mx-auto(\s|$)/);
    expect(box.className).not.toMatch(/1440px/);
  });

  // ⚠️ The box owns the WIDTH, never the horizontal padding. Pages set their own inset because
  // it is not uniform on purpose: prose uses px-6 md:px-10, while /survivors/[map] and the
  // dossier declare none and run their tables edge to edge below xl. Padding here puts gutters
  // on those tables.
  test("declares no horizontal padding", () => {
    const { container } = render(<BoxedLayout><div /></BoxedLayout>);
    expect(container.firstElementChild!.className).not.toMatch(/(^|\s)(xl:)?px-/);
  });

  // Continues the height chain from #main-content so a page that fills the viewport still can.
  test("keeps the flex column", () => {
    const { container } = render(<BoxedLayout><div /></BoxedLayout>);
    const box = container.firstElementChild!;
    expect(box.className).toMatch(/(^|\s)flex(\s|$)/);
    expect(box.className).toMatch(/(^|\s)flex-1(\s|$)/);
    expect(box.className).toMatch(/(^|\s)flex-col(\s|$)/);
  });
});
```

In `src/app/(site)/layout.test.tsx`, rename the width test and its comment (the assertion itself
does not change — it is `not.toMatch(/max-w/)`):

```tsx
  // The content box lives in (boxed)/layout.tsx so /maps/[map] — the one page outside that
  // group — can run terrain edge to edge on a wide desktop. A max-w restored here would quietly
  // re-box the map.
  test("does NOT constrain width — the content box belongs to (boxed)", () => {
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @onelife/web test -- "src/app/(site)/(boxed)/layout.test.tsx"
```

Expected: FAIL — the layout is still `max-w-[1440px]` with `xl:px-10`.

- [ ] **Step 3: Change the layout**

Replace `src/app/(site)/(boxed)/layout.tsx` entirely:

```tsx
import type { ReactNode } from "react";

/**
 * The centered content box — every page in the site shell EXCEPT `/maps/[map]`, which sits
 * directly under `(site)` so the terrain can run edge to edge on a wide desktop. Route groups
 * are not path segments, so nothing in here has a different URL than before the split.
 *
 * ⚠️ THIS IS THE ONLY PLACE A CONTENT WIDTH IS DECLARED. Pages used to each set their own and
 * disagreed — 1024 on home/About/Obituaries, 68ch on Survivors/Friends, nothing at all on
 * Terms/Privacy/Welcome/Notifications/the dossier, which therefore filled the old 1440 box. A
 * page-level `mx-auto max-w-*` on a top-level element is a regression, not a local choice.
 * The exceptions are narrow-by-design ELEMENTS inside the box, not pages: `/login`'s `max-w-md`
 * form, and the `max-w-3xl` prose measure in `legal-doc.tsx` and `obituary-article.tsx`.
 *
 * ⚠️ The box owns the width, NEVER the horizontal padding. Pages keep their own inset because
 * it is deliberately not uniform: prose surfaces use `px-6 md:px-10`, while `/survivors/[map]`
 * and the dossier declare none and run their tables edge to edge below `xl`. Padding here would
 * put gutters on those tables.
 *
 * `flex flex-1 flex-col` continues the height chain from `#main-content` so pages that fill
 * the leftover viewport (none in this group today) still could; block children keep their
 * automatic height either way.
 */
export default function BoxedLayout({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col">{children}</div>;
}
```

- [ ] **Step 4: Move obituaries into the box**

```bash
git mv "apps/web/src/app/(site)/obituaries" "apps/web/src/app/(site)/(boxed)/obituaries"
```

Route groups are not path segments, so `/obituaries` and `/obituaries/<slug>` keep their URLs.
Verify nothing else referenced the old directory path (imports use `@/`, so this should be
clean):

```bash
grep -rn '(site)/obituaries' apps/web/src || echo "no stale references"
```

- [ ] **Step 5: Strip the per-page containers**

Six one-line edits. In each, remove only `mx-auto` and the `max-w-*` token; keep every other
class exactly as it is.

| File:line | From | To |
| --- | --- | --- |
| `(boxed)/obituaries/page.tsx:32` | `className="mx-auto w-full max-w-5xl px-6 py-10 md:px-10"` | `className="w-full px-6 py-10 md:px-10"` |
| `(boxed)/page.tsx:53` | `className="mx-auto w-full min-w-0 max-w-5xl"` | `className="w-full min-w-0"` |
| `(boxed)/about/page.tsx:76` | `className="mx-auto w-full max-w-5xl px-6 py-10 md:px-10 md:py-14"` | `className="w-full px-6 py-10 md:px-10 md:py-14"` |
| `(boxed)/survivors/page.tsx:31` | `className="mx-auto w-full max-w-[68ch] px-4 py-8"` | `className="w-full px-4 py-8"` |
| `(boxed)/friends/page.tsx:12` | `className="mx-auto w-full max-w-[68ch] px-4 py-8"` | `className="w-full px-4 py-8"` |
| `(boxed)/players/[slug]/[map]/lives/[n]/page.tsx:42` | `className="mx-auto w-full max-w-5xl px-6 py-10 md:px-10"` | `className="w-full px-6 py-10 md:px-10"` |

Then confirm no page under `(boxed)` still declares its own box, ignoring the two allowed ones:

```bash
grep -rn "mx-auto w-full max-w-" "apps/web/src/app/(site)/(boxed)" || echo "clean"
```

Expected output: only `login/page.tsx` (`max-w-md`), or `clean`.

- [ ] **Step 6: Run the full suite**

```bash
pnpm --filter @onelife/web test
pnpm --filter @onelife/web run typecheck
```

Expected: PASS. Watch for page-level tests that asserted a `max-w-5xl` or `68ch` on a page root
— if one fails, it is asserting the contract this task deliberately moves, so update it to
assert the padding it keeps rather than deleting the test.

- [ ] **Step 7: Commit**

```bash
git add -A apps/web/src
git commit -m "feat(web): one 1024px content width for every page but the map

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Docs, changelog, and the full monorepo gate

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/architecture/web-surfaces.md` — the app shell section describes the TabBar and
  the 1440px box
- Modify: `CLAUDE.md` — the "Outstanding, un-verified work" list

**Interfaces:**
- Consumes: nothing.
- Produces: the PR's changelog entry, which keel's CI gate requires.

- [ ] **Step 1: Read what the docs currently claim**

```bash
grep -n "TabBar\|tab bar\|1440\|Quick access" docs/architecture/web-surfaces.md
```

Update every hit: the bottom bar is deleted and replaced by `components/shell/nav-menu.tsx` (one
menu, every width, nav + account items); the content box is `max-w-5xl` (1024px) in
`app/(site)/(boxed)/layout.tsx` and is the only width declaration; the masthead is
`sticky top-0`; the avatar is a link to `/`; `/obituaries` now lives inside `(boxed)`.

If `docs/architecture/web-surfaces.md` documents the LAYER LEGEND, confirm it still says three
altitudes — this work adds none.

- [ ] **Step 2: Add the outstanding browser checks to CLAUDE.md**

Append to the "Outstanding, un-verified work" list in `CLAUDE.md`:

```markdown
- The app-shell change (hamburger nav, sticky masthead, one width), none of which RTL can prove:
  the masthead actually pinning while scrolling a long board or obituary, and not jumping when
  iOS Safari collapses its URL bar; the menu panel painting above page content on a real device
  and fitting at 320px; PWA/standalone on a notched phone now that the bottom bar is gone (the
  footer's remaining safe-area gutter, and the map's friends sheet reaching `bottom-0` without
  the home indicator eating its last row); the right cluster (bell + avatar + ☰, or SIGN IN + ☰)
  at 320px; and every page at 1024 on a wide monitor — particularly Survivors and Friends, which
  each gain ~400px. Use CDP `Emulation.setDeviceMetricsOverride`.
```

- [ ] **Step 3: Write the changelog entry**

Add under `## [Unreleased]` in `CHANGELOG.md` (create the heading and any missing subheadings if
absent, matching the file's existing style):

```markdown
### Changed

- The mobile bottom tab bar is replaced by a single hamburger menu in the masthead that works at
  every width. It carries the whole nav (Home, Maps, Survivors, Obituaries, About), Friends when
  signed in, and the account items — profile, claim, sign out — that used to live behind the
  avatar. The desktop inline nav row is gone with it; there is one nav now.
- The avatar in the masthead is a link to your home page rather than a menu trigger. Signed out,
  a visible SIGN IN link stays in the masthead.
- The masthead is sticky, so navigation is reachable from the bottom of a long board or obituary.
- Every page except the map is now the same 1024px width on a wide monitor. Survivors and Friends
  were much narrower than the rest; Terms, Privacy, Welcome, Notifications and the dossier were
  much wider. Obituaries moves inside the shared content box (its URLs are unchanged).
```

- [ ] **Step 4: Run the full monorepo gate**

```bash
pnpm turbo run typecheck
pnpm turbo run test --concurrency=1
```

Expected: PASS. DB suites need `TEST_DATABASE_URL`; this change touches only `apps/web`, but the
gate is the whole repo. **Do not source `.env` for the web suite.**

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md CLAUDE.md docs/architecture/web-surfaces.md
git commit -m "docs: changelog and architecture notes for the app-shell change

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## After the plan

The branch is `feature/hamburger-nav-sticky-masthead`. Once every task is committed and the full
gate is green, use `keel:finish-work` to open the PR into `main` (squash), then `keel:review`.

**Nothing in this plan is verified in a real browser.** The outstanding-work list added in Task 6
is the honest statement of what still needs a device, and it must not be trimmed at PR time.
