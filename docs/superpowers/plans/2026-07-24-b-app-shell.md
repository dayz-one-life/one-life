# Sub-project B — App Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three-surface controls machinery (rail + sheet + mobile trigger) with a mobile tab bar, a Home-only sidebar, a `/you` account page and one shared page-header strip, and change the nav to Home · Maps · Leaderboard · About.

**Architecture:** Additive first, subtractive last. Tasks 1–3 build new components nobody consumes yet. Tasks 4–7 rewire the shell to use them and move the account surface out of the layout into Home and `/you`. Task 8 deletes the old surfaces once nothing imports them. Tasks 9–10 apply the page header and update docs. The tree compiles and the suite passes at every commit.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript ESM, Tailwind, vitest + React Testing Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-07-24-b-app-shell-design.md`
**Branch:** `feature/b-app-shell` (exists; spec committed at `3e6c8dc`)

## Global Constraints

- **Three z-altitudes only.** Content (`z-auto`) → `z-40` chrome → `z-50` overlays. The LAYER LEGEND comment in `components/header.tsx` is the source of truth. The tab bar joins the **`z-40`** layer; it must not create a fourth.
- **Mobile control floor is min 52px at 15px**, not the 44px/13px accessibility minimum — 44/13 shipped in v0.40.0 and still read as fiddly on a real phone.
- **Safe-area insets go in the height calc, never in padding.** Use `h-[calc(4rem+env(safe-area-inset-bottom))]`. Under `border-box`, padding is subtracted from the box and collapses the row on a notched phone in PWA mode.
- **Loading, genuinely-empty and failed are three distinct renders.** Never `?? 0`, never `[]`-means-idle. `useControls` exposes `standingLoading` / `balanceLoading` for exactly this.
- **Never hardcode a server count** in copy or in a fixed grid/flex column count — three servers today, four when Badlands ships. Derive from the `servers` list or phrase count-free.
- **Every route outside `app/(site)/` must supply its own `#main-content`** (`not-found.tsx`, `error.tsx`, `/maps/[map]`). Inside `(site)` the layout supplies exactly one.
- **jsdom cannot see paint.** Contrast, stacking, layout collapse and safe-area are invisible to RTL. Task 10 carries the real-device pass; do not claim those checks from a green suite.
- **Commit per task**, with the `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` and `Claude-Session:` trailers.
- **Stage explicit paths.** `git add -A` at the repo root is blocked by a hook; name the files.
- **Test DB:** `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test` (local Postgres is on 5434, see `docker-compose.override.yml`). The web suite is jsdom-only and needs no DB, but `turbo run test` at the root does.

---

## File Structure

**Created:**
- `apps/web/src/components/shell/tab-bar.tsx` + test — the mobile bottom bar
- `apps/web/src/components/shell/account-affordance.tsx` + test — masthead avatar / Sign in chip
- `apps/web/src/components/shared/page-header.tsx` + test — title · count · control
- `apps/web/src/components/account/account-panels.tsx` — the status switch lifted out of the rail
- `apps/web/src/components/account/home-sidebar.tsx` — the `xl` sidebar slot
- `apps/web/src/app/(site)/you/page.tsx` + test — the account page

**Moved (file moves with its test, imports updated, contents otherwise unchanged):**
- `controls/identity-row.tsx` → `account/identity-row.tsx`
- `controls/link-panel.tsx` → `account/link-panel.tsx`
- `controls/verify-panel.tsx` → `account/verify-panel.tsx`
- `controls/tokens-panel.tsx` → `account/tokens-panel.tsx`
- `controls/verification-announcer.tsx` → `account/verification-announcer.tsx`
- `controls/use-controls.ts` → `account/use-controls.ts`
- `controls/format.ts` → `account/format.ts`
- `controls/server-cards.tsx` → `servers/server-cards.tsx`
- `controls/friends-panel.tsx` → `friends/friends-panel.tsx`
- `controls/gamertag-autocomplete.tsx` → `shared/gamertag-autocomplete.tsx`

**Deleted:** `controls/rail.tsx`, `controls/sheet.tsx`, `controls/mobile-account.tsx`, `controls/signin-panel.tsx`, `lib/use-sheet-drag.ts`, and all four of their tests. The `controls/` directory ends up empty and goes with them.

**Modified:** `lib/nav.ts`, `components/header.tsx`, `components/footer.tsx`, `app/(site)/layout.tsx`, `app/(site)/page.tsx`, `app/(site)/survivors/*`, `app/(site)/friends/page.tsx`, `app/(site)/notifications/page.tsx`, `CLAUDE.md`, `CHANGELOG.md`.

---

### Task 1: Nav becomes Home · Maps · Leaderboard · About

**Files:**
- Modify: `apps/web/src/lib/nav.ts`
- Modify: `apps/web/src/lib/nav.test.ts`

**Interfaces:**
- Produces: `NAV_ITEMS` with keys `["home","maps","leaderboard","about"]`; `NavKey` union gains `home` and `leaderboard`, loses `survivors`. `activeNavKey(pathname: string): NavKey | null` unchanged in signature.

- [ ] **Step 1: Write the failing tests**

Replace the existing nav shape test in `apps/web/src/lib/nav.test.ts` and add the prefix-trap cases:

```ts
it("lists exactly the four sections in order", () => {
  expect(NAV_ITEMS.map((i) => i.key)).toEqual(["home", "maps", "leaderboard", "about"]);
});

it("Leaderboard still points at /survivors — D owns the route change", () => {
  expect(NAV_ITEMS.find((i) => i.key === "leaderboard")?.href).toBe("/survivors");
});

it("lights up Home ONLY on the exact root path", () => {
  expect(activeNavKey("/")).toBe("home");
  // The trap: a prefix match on "/" makes every path light up Home.
  expect(activeNavKey("/about")).toBe("about");
  expect(activeNavKey("/survivors")).toBe("leaderboard");
  expect(activeNavKey("/maps/livonia")).toBe("maps");
});

it("keeps player pages in the leaderboard section", () => {
  expect(activeNavKey("/players/xsgt-hartman")).toBe("leaderboard");
  expect(activeNavKey("/players/xsgt-hartman/livonia/lives/2")).toBe("leaderboard");
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @onelife/web run test -- nav.test`
Expected: **FAIL** — `NAV_ITEMS` still has three keys starting `survivors`.

- [ ] **Step 3: Rewrite `nav.ts`**

```ts
export const NAV_ITEMS = [
  { key: "home", href: "/", label: "Home" },
  // `/maps` is a redirect that resolves the viewer's last-opened map — see lib/last-map.ts.
  { key: "maps", href: "/maps", label: "Maps" },
  // Label-only rename. The route stays /survivors; sub-project D owns route changes.
  { key: "leaderboard", href: "/survivors", label: "Leaderboard" },
  { key: "about", href: "/about", label: "About" },
] as const;

export type NavKey = (typeof NAV_ITEMS)[number]["key"];

const inSection = (pathname: string, base: string) => pathname === base || pathname.startsWith(base + "/");

/**
 * Which nav item a pathname lights up. Player pages belong to the Leaderboard section — they are
 * reached from the board.
 *
 * ⚠️ Home is an EXACT match, never `inSection`. Every path starts with "/", so a prefix rule here
 * lights up Home on every page in the site.
 */
export function activeNavKey(pathname: string): NavKey | null {
  if (pathname === "/") return "home";
  if (inSection(pathname, "/maps")) return "maps";
  if (inSection(pathname, "/survivors") || inSection(pathname, "/players")) return "leaderboard";
  if (inSection(pathname, "/about")) return "about";
  return null;
}
```

- [ ] **Step 4: Run the web suite**

Run: `pnpm --filter @onelife/web run test`
Expected: PASS. `header.test.tsx` may assert nav labels — update it to the four new labels if so.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/nav.ts apps/web/src/lib/nav.test.ts apps/web/src/components/header.test.tsx
git commit -m "$(cat <<'EOF'
feat: nav becomes Home / Maps / Leaderboard / About

Leaderboard is a label-only rename — the route stays /survivors until
sub-project D. Home is matched exactly, never by prefix, or every path in
the site lights it up.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015RgTMzCNtbCj8M1kFAk8FK
EOF
)"
```

---

### Task 2: The shared page-header strip

**Files:**
- Create: `apps/web/src/components/shared/page-header.tsx`
- Create: `apps/web/src/components/shared/page-header.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export type HeaderCount =
    | { kind: "loading" }
    | { kind: "ready"; value: number; noun: string }
    | { kind: "failed" };
  export function PageHeader(props: {
    title: string;
    count?: HeaderCount;
    control?: ReactNode;
  }): JSX.Element;
  ```
  Consumed by Tasks 7 and 9.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/shared/page-header.test.tsx`:

```tsx
import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageHeader } from "./page-header";

describe("PageHeader", () => {
  test("renders the title as the page h1", () => {
    render(<PageHeader title="The Roster" />);
    expect(screen.getByRole("heading", { level: 1, name: "The Roster" })).toBeInTheDocument();
  });

  test("a resolved count renders the number and its noun", () => {
    render(<PageHeader title="Leaderboard" count={{ kind: "ready", value: 104, noun: "alive" }} />);
    expect(screen.getByText(/104 alive/)).toBeInTheDocument();
  });

  // The repo's most-repeated bug: a resolved zero and an unresolved count rendering the same.
  test("a resolved ZERO is a real zero, not the loading render", () => {
    const { container } = render(
      <PageHeader title="Leaderboard" count={{ kind: "ready", value: 0, noun: "alive" }} />,
    );
    expect(screen.getByText(/0 alive/)).toBeInTheDocument();
    expect(container.querySelector("[aria-busy='true']")).toBeNull();
  });

  test("loading renders a busy placeholder and NO number", () => {
    const { container } = render(<PageHeader title="Leaderboard" count={{ kind: "loading" }} />);
    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
    expect(screen.queryByText(/\d/)).toBeNull();
  });

  test("failed says so out loud and is not silently empty", () => {
    render(<PageHeader title="Leaderboard" count={{ kind: "failed" }} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(/couldn't load/i);
  });

  test("renders a control when given one", () => {
    render(<PageHeader title="Maps" control={<button type="button">Switch</button>} />);
    expect(screen.getByRole("button", { name: "Switch" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @onelife/web run test -- page-header`
Expected: **FAIL** — cannot resolve `./page-header`.

- [ ] **Step 3: Implement**

Create `apps/web/src/components/shared/page-header.tsx`:

```tsx
import type { ReactNode } from "react";

/**
 * The count is the ONLY live part of any page header, and it is exactly where "loading rendered
 * as zero" keeps recurring. It is therefore a discriminated union rather than a number, so the
 * honest-rendering matrix is solved once here instead of four times at the call sites.
 */
export type HeaderCount =
  | { kind: "loading" }
  | { kind: "ready"; value: number; noun: string }
  | { kind: "failed" };

function Count({ count }: { count: HeaderCount }) {
  if (count.kind === "loading") {
    return <span aria-busy="true" aria-hidden className="inline-block h-3 w-16 motion-safe:animate-pulse bg-bone" />;
  }
  if (count.kind === "failed") {
    // Explicit, not silent: "we don't know" and "there are none" are different claims.
    return <span role="status">Couldn&apos;t load the count</span>;
  }
  return (
    <span>
      {count.value} {count.noun}
    </span>
  );
}

/**
 * Shared page header: title · count · control. Ordinary flow content — NO z-index and NO sticky,
 * so it cannot become a fourth z-altitude (LAYER LEGEND in components/header.tsx).
 */
export function PageHeader({ title, count, control }: { title: string; count?: HeaderCount; control?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b-[3px] border-ink pb-2.5">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h1 className="font-display text-3xl font-bold uppercase tracking-[.02em] text-ink">{title}</h1>
        {count && (
          <p className="font-mono text-[11.5px] uppercase tracking-[.05em] text-ink-muted">
            <Count count={count} />
          </p>
        )}
      </div>
      {control}
    </div>
  );
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @onelife/web run test -- page-header`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/shared/page-header.tsx apps/web/src/components/shared/page-header.test.tsx
git commit -m "$(cat <<'EOF'
feat: add the shared page-header strip

title / count / control, used by Home, Leaderboard, Friends and
Notifications. The count is a discriminated union rather than a number so
loading, resolved-zero and failed are three distinct renders in one place.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015RgTMzCNtbCj8M1kFAk8FK
EOF
)"
```

---

### Task 3: The mobile tab bar

**Files:**
- Create: `apps/web/src/components/shell/tab-bar.tsx`
- Create: `apps/web/src/components/shell/tab-bar.test.tsx`

**Interfaces:**
- Consumes: `useAccountStatus()` from `@/lib/use-account-status` (returns the `AccountStatus` union: `loading | signedOut | unlinked | pending | verified`).
- Produces: `export function TabBar(): JSX.Element | null`. Mounted by Task 5's layout.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/shell/tab-bar.test.tsx`:

```tsx
import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/use-account-status", () => ({ useAccountStatus: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

import { useAccountStatus } from "@/lib/use-account-status";
import { TabBar } from "./tab-bar";

const status = (kind: string) => vi.mocked(useAccountStatus).mockReturnValue({ kind } as never);

describe("TabBar", () => {
  beforeEach(() => vi.clearAllMocks());

  test("signed in: five destinations", () => {
    status("verified");
    render(<TabBar />);
    for (const name of ["Home", "Map", "Board", "Friends", "You"]) {
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    }
  });

  test("signed out: four, with Sign in replacing Friends and You", () => {
    status("signedOut");
    render(<TabBar />);
    for (const name of ["Home", "Map", "Board", "Sign in"]) {
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole("link", { name: "Friends" })).toBeNull();
    expect(screen.queryByRole("link", { name: "You" })).toBeNull();
  });

  test("renders nothing while identity is still resolving", () => {
    status("loading");
    const { container } = render(<TabBar />);
    expect(container).toBeEmptyDOMElement();
  });

  test("marks the active destination", () => {
    status("verified");
    render(<TabBar />);
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  });

  // jsdom cannot see paint, so pin the altitude numerically the way header.test.tsx does.
  test("sits on the z-40 chrome layer — above content, below the z-50 overlays", () => {
    status("verified");
    render(<TabBar />);
    const nav = screen.getByRole("navigation", { name: /quick/i });
    const z = Number(/z-(\d+)/.exec(nav.className)?.[1]);
    expect(z).toBeGreaterThan(0);
    expect(z).toBeLessThan(50);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @onelife/web run test -- tab-bar`
Expected: **FAIL** — cannot resolve `./tab-bar`.

- [ ] **Step 3: Implement**

Create `apps/web/src/components/shell/tab-bar.tsx`:

```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccountStatus } from "@/lib/use-account-status";
import { cn } from "@/lib/utils";

type Tab = { href: string; label: string };

const COMMON: Tab[] = [
  { href: "/", label: "Home" },
  // Resolves through the existing /maps redirect, so this needs no knowledge of map resolution —
  // sub-project D changes that redirect's internals without touching the tab bar.
  { href: "/maps", label: "Map" },
  { href: "/survivors", label: "Board" },
];

const SIGNED_IN: Tab[] = [...COMMON, { href: "/friends", label: "Friends" }, { href: "/you", label: "You" }];
const SIGNED_OUT: Tab[] = [...COMMON, { href: "/login", label: "Sign in" }];

/**
 * Mobile quick-access bar. NOT the nav — the nav is four sections; this is the five things a
 * player does often, which is why Friends and You appear here and About does not.
 *
 * ⚠️ Height is a calc, never `h-16` plus bottom padding: under `border-box` the safe-area padding
 * is subtracted from the box and collapses the row to a sliver on a notched phone in PWA mode.
 *
 * ⚠️ This is NOT a reintroduction of the retired ControlsPill. That was a floating account
 * surface; this is app-wide navigation and renders for signed-out visitors too.
 */
export function TabBar() {
  const status = useAccountStatus();
  const pathname = usePathname() ?? "/";
  if (status.kind === "loading") return null;
  const tabs = status.kind === "signedOut" ? SIGNED_OUT : SIGNED_IN;

  return (
    <nav
      aria-label="Quick access"
      className="fixed inset-x-0 bottom-0 z-40 flex h-[calc(4rem+env(safe-area-inset-bottom))] items-start border-t border-dark-line bg-dark pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {tabs.map((t) => {
        const active = t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-[52px] flex-1 items-center justify-center px-1 font-display text-[15px] font-semibold uppercase tracking-[.06em]",
              active ? "text-red" : "text-paper",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @onelife/web run test -- tab-bar`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/shell/tab-bar.tsx apps/web/src/components/shell/tab-bar.test.tsx
git commit -m "$(cat <<'EOF'
feat: add the mobile tab bar

Home / Map / Board / Friends / You, dropping to four with Sign in when
signed out, nothing while identity resolves. Joins the existing z-40 chrome
layer rather than adding a fourth altitude, and puts the safe-area inset in
the height calc so the row cannot collapse on a notched phone.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015RgTMzCNtbCj8M1kFAk8FK
EOF
)"
```

---

### Task 4: Masthead account affordance, and retire the hamburger

**Files:**
- Create: `apps/web/src/components/shell/account-affordance.tsx`
- Create: `apps/web/src/components/shell/account-affordance.test.tsx`
- Modify: `apps/web/src/components/header.tsx`
- Modify: `apps/web/src/components/header.test.tsx`
- Modify: `apps/web/src/components/footer.tsx`
- Modify: `apps/web/src/components/footer.test.tsx`

**Interfaces:**
- Consumes: `useAccountStatus()`.
- Produces: `export function AccountAffordance(): JSX.Element | null` — replaces `MobileAccount` in the masthead right cluster. Renders at **every** width (the old trigger was `xl:hidden`).

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/shell/account-affordance.test.tsx`:

```tsx
import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/use-account-status", () => ({ useAccountStatus: vi.fn() }));

import { useAccountStatus } from "@/lib/use-account-status";
import { AccountAffordance } from "./account-affordance";

const status = (kind: string, gamertag?: string) =>
  vi.mocked(useAccountStatus).mockReturnValue(
    (gamertag ? { kind, link: { gamertag } } : { kind }) as never,
  );

describe("AccountAffordance", () => {
  beforeEach(() => vi.clearAllMocks());

  test("signed in: links to the account page", () => {
    status("verified", "xSgt Hartman");
    render(<AccountAffordance />);
    expect(screen.getByRole("link", { name: /account/i })).toHaveAttribute("href", "/you");
  });

  test("signed in but unlinked still reaches the account page", () => {
    status("unlinked");
    render(<AccountAffordance />);
    expect(screen.getByRole("link", { name: /account/i })).toHaveAttribute("href", "/you");
  });

  test("signed out: a sign-in chip", () => {
    status("signedOut");
    render(<AccountAffordance />);
    expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute("href", "/login");
  });

  test("renders nothing while identity is resolving — never a flash of the wrong state", () => {
    status("loading");
    const { container } = render(<AccountAffordance />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @onelife/web run test -- account-affordance`
Expected: **FAIL** — cannot resolve `./account-affordance`.

- [ ] **Step 3: Implement the affordance**

Create `apps/web/src/components/shell/account-affordance.tsx`:

```tsx
"use client";
import Link from "next/link";
import { useAccountStatus } from "@/lib/use-account-status";

/**
 * The masthead's account control. Replaces MobileAccount (which opened the now-deleted
 * ControlsSheet) and renders at EVERY width — with the rail gone there is no other desktop
 * account surface.
 */
export function AccountAffordance() {
  const status = useAccountStatus();
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

  const initial = status.kind === "verified" ? status.link.gamertag.trim().charAt(0).toUpperCase() : "?";
  return (
    <Link
      href="/you"
      aria-label="Your account"
      className="flex h-9 w-9 items-center justify-center rounded-full border border-dark-edge-bright bg-dark-well font-display text-sm font-bold uppercase text-paper hover:border-red hover:text-red"
    >
      <span aria-hidden>{initial}</span>
    </Link>
  );
}
```

- [ ] **Step 4: Rewire the masthead**

In `apps/web/src/components/header.tsx`:

1. Delete the `useState`, `useModalBehavior` import, the `open` state, the hamburger `<button>`, and the entire `{open && (<div role="dialog" …>…</div>)}` block at the end.
2. Replace the `MobileAccount` import and usage with `AccountAffordance` from `@/components/shell/account-affordance`.
3. Delete the `md:hidden` spacer `<div className="mt-4 border-t border-dark-line md:hidden" />` — with no hamburger there is no mobile-only nav row to stand in for.
4. Keep the LAYER LEGEND comment; **update its `z-50` bullet** to drop the `ControlsSheet` reference (that file is deleted in Task 8) and to note that the tab bar shares `z-40`.

- [ ] **Step 5: Move About into the footer**

`components/footer.tsx` becomes:

```tsx
import Link from "next/link";

/** About lives here because the tab bar carries the other three nav items and About is the one
 *  section a player visits once. */
export function Footer() {
  return (
    <footer className="bg-dark px-10 py-[18px] text-center font-mono text-xs uppercase tracking-[.08em] text-paper">
      <Link href="/about" className="underline decoration-dark-line underline-offset-4 hover:text-red">
        About
      </Link>
      <span aria-hidden className="px-2">·</span>
      One Life — hardcore · 1PP · US servers
    </footer>
  );
}
```

Add to `footer.test.tsx`:

```tsx
test("carries the About link, which the tab bar does not", () => {
  render(<Footer />);
  expect(screen.getByRole("link", { name: "About" })).toHaveAttribute("href", "/about");
});
```

- [ ] **Step 6: Fix the masthead test**

`header.test.tsx` asserts the hamburger and the mobile dialog. Delete those cases. **Keep the z-altitude case** (`0 < z < 50`) — it is the numeric pin for the LAYER LEGEND. Add:

```tsx
test("has no hamburger — the tab bar replaced the mobile menu", () => {
  render(<Masthead />);
  expect(screen.queryByRole("button", { name: /open menu/i })).toBeNull();
});
```

- [ ] **Step 7: Run the web suite**

Run: `pnpm --filter @onelife/web run test`
Expected: PASS. `mobile-account.test.tsx` still passes (the component still exists until Task 8).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/shell apps/web/src/components/header.tsx apps/web/src/components/header.test.tsx apps/web/src/components/footer.tsx apps/web/src/components/footer.test.tsx
git commit -m "$(cat <<'EOF'
feat: masthead account affordance, and retire the hamburger menu

The avatar links to /you at every width (the old trigger was xl:hidden and
opened the sheet). The full-screen mobile menu existed to reach four nav
items on a phone; the tab bar reaches three of them plus two the nav never
had, and About moves to the footer.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015RgTMzCNtbCj8M1kFAk8FK
EOF
)"
```

---

### Task 5: Move the account surface into Home; layout becomes a single column

This is the task that must not lose functionality: the rail is removed from the layout in the same commit that Home starts rendering it. Do not split it.

**Files:**
- Create: `apps/web/src/components/account/account-panels.tsx`
- Create: `apps/web/src/components/account/home-sidebar.tsx`
- Modify: `apps/web/src/app/(site)/layout.tsx`
- Create: `apps/web/src/app/(site)/layout.test.tsx`
- Modify: `apps/web/src/app/(site)/page.tsx`

**Interfaces:**
- Produces: `export function AccountPanels(): JSX.Element` — the status switch (loading / signedOut / unlinked / pending / verified) lifted verbatim out of `ControlsRail`'s body, plus the `VerificationAnnouncer` and the signed-in footer. `export function HomeSidebar(): JSX.Element` — the `xl`-only summary column.

- [ ] **Step 1: Lift the rail's body into `AccountPanels`**

Create `apps/web/src/components/account/account-panels.tsx`. Copy `ControlsRail`'s `RailSkeleton`, `ServerCardsSkeleton`, `mutView`, `SignedInFooter` and the whole `body` switch **verbatim** from `controls/rail.tsx`, changing only:

- the import paths (`./use-controls` → `@/components/account/use-controls`, etc. — the moves happen in Task 8; until then import from `@/components/controls/*`),
- the outer element: it is no longer an `<aside>` with `xl:sticky`, it is a plain `<div className="flex flex-col gap-4">`.

Keep `<VerificationAnnouncer kind={c.status.kind} />` as an **unconditional sibling** of `body`, not inside a branch — it must outlive the pending→verified panel swap. That structure is load-bearing.

- [ ] **Step 2: Create the sidebar**

Create `apps/web/src/components/account/home-sidebar.tsx`:

```tsx
"use client";
import { FriendsPanelContainer } from "@/components/controls/friends-panel";

/**
 * Home's xl-only summary column. Sub-project C replaces its contents (friends online, your
 * standing, notifications); B only gives it a home.
 *
 * ⚠️ Nothing ACTIONABLE may live only here — it is xl-only, so anything reachable solely from
 * this column is unreachable on a phone. Actions belong in Home's main column.
 */
export function HomeSidebar() {
  return (
    <aside aria-label="At a glance" className="hidden py-8 pl-7 xl:sticky xl:top-0 xl:block xl:max-h-screen xl:self-start xl:overflow-y-auto">
      <FriendsPanelContainer />
    </aside>
  );
}
```

- [ ] **Step 3: Simplify the layout**

`app/(site)/layout.tsx` becomes:

```tsx
import type { ReactNode } from "react";
import { Masthead } from "@/components/header";
import { Footer } from "@/components/footer";
import { TabBar } from "@/components/shell/tab-bar";

/** Every surface EXCEPT the map application. `/maps/[map]` sits outside this group so it can
 *  render its own full-viewport shell. Route groups are not path segments, so nothing changed URL.
 *
 *  The two-column grid used to live here with the controls rail in the right column. It moved to
 *  Home (app/(site)/page.tsx), which is the only page that has a sidebar now — every other page
 *  in the group gets its full width back. */
export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Masthead />
      {/* The bottom gutter reserves space for the fixed TabBar below md. */}
      <div
        id="main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-[1440px] flex-1 pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0 xl:px-10"
      >
        {children}
      </div>
      <Footer />
      <TabBar />
    </>
  );
}
```

- [ ] **Step 4: Give Home the grid and the panels**

In `app/(site)/page.tsx`, wrap the existing `<main>` in the two-column grid and add the account column. The existing hero / banner / top-5 / sign-in-CTA content is **unchanged** — C rewrites it:

```tsx
return (
  <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_380px]">
    <main className="mx-auto w-full max-w-5xl min-w-0 xl:border-r xl:border-ink xl:pr-8">
      <Hero />
      {survivors.failed && (
        <FeedFailedBanner>The survivors board is temporarily unreachable.</FeedFailedBanner>
      )}
      <TopSurvivors rows={survivors.data?.rows.slice(0, 5) ?? []} />
      <div className="px-6 md:px-10">
        <AccountPanels />
      </div>
      <SignInCta />
    </main>
    <HomeSidebar />
  </div>
);
```

`AccountPanels` is a client component; `page.tsx` is an async server component. That composes fine — a server component may render a client component.

- [ ] **Step 5: Write the layout test**

Create `apps/web/src/app/(site)/layout.test.tsx`:

```tsx
import { describe, expect, test, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("@/components/header", () => ({ Masthead: () => <header /> }));
vi.mock("@/components/footer", () => ({ Footer: () => <footer /> }));
vi.mock("@/components/shell/tab-bar", () => ({ TabBar: () => <nav aria-label="Quick access" /> }));

import SiteLayout from "./layout";

describe("SiteLayout", () => {
  test("supplies exactly one #main-content for the skip link", () => {
    const { container } = render(<SiteLayout>{<p>page</p>}</SiteLayout>);
    expect(container.querySelectorAll("#main-content")).toHaveLength(1);
  });

  test("mounts the tab bar", () => {
    const { getByRole } = render(<SiteLayout>{<p>page</p>}</SiteLayout>);
    expect(getByRole("navigation", { name: "Quick access" })).toBeInTheDocument();
  });

  // The gutter is the only thing stopping the fixed tab bar covering the end of every page.
  test("reserves bottom space for the tab bar below md", () => {
    const { container } = render(<SiteLayout>{<p>page</p>}</SiteLayout>);
    expect(container.querySelector("#main-content")?.className).toMatch(/pb-\[calc\(4rem\+env\(safe-area-inset-bottom\)\)\]/);
  });
});
```

- [ ] **Step 6: Run the web suite**

Run: `pnpm --filter @onelife/web run test`
Expected: PASS. `page.test.tsx` asserts the hero and the failed-feed banner — both still render. If a test asserted the rail was in the layout, move that assertion to Home.

- [ ] **Step 7: Commit**

```bash
git add "apps/web/src/app/(site)/layout.tsx" "apps/web/src/app/(site)/layout.test.tsx" "apps/web/src/app/(site)/page.tsx" apps/web/src/components/account
git commit -m "$(cat <<'EOF'
feat: sidebar becomes Home-only; the account panels move into Home

The two-column grid moves out of the site layout and into Home, so every
other page in the group gets its full width back. The rail's status switch
is lifted verbatim into AccountPanels, keeping VerificationAnnouncer as an
unconditional sibling so it survives the pending->verified swap.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015RgTMzCNtbCj8M1kFAk8FK
EOF
)"
```

---

### Task 6: The `/you` account page

**Files:**
- Create: `apps/web/src/app/(site)/you/page.tsx`
- Create: `apps/web/src/components/account/you-panel.tsx`
- Create: `apps/web/src/components/account/you-panel.test.tsx`

**Interfaces:**
- Consumes: `useControls`, `useControlsActions`, `IdentityRow`, `TokensPanel`, `PageHeader`, `signOutAndTeardownPush`.
- Produces: `export function YouPanel(): JSX.Element`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/account/you-panel.test.tsx`:

```tsx
import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/controls/use-controls", () => ({
  useControls: vi.fn(),
  useControlsActions: () => ({
    claim: { mutate: vi.fn(), isPending: false, isError: false, error: null },
    cancel: { mutate: vi.fn(), isPending: false },
    send: { isPending: false, isSuccess: false, isError: false, error: null, mutate: vi.fn() },
    refer: { isPending: false, isSuccess: false, isError: false, error: null, mutate: vi.fn() },
    redeem: { mutate: vi.fn(), isPending: false },
  }),
}));

import { useControls } from "@/components/controls/use-controls";
import { YouPanel } from "./you-panel";

const controls = (over: Record<string, unknown>) =>
  vi.mocked(useControls).mockReturnValue({
    status: { kind: "signedOut" }, name: null, provider: null, balance: null,
    servers: [], standing: [], standingLoading: false, balanceLoading: false, ...over,
  } as never);

describe("YouPanel", () => {
  beforeEach(() => vi.clearAllMocks());

  test("signed out: points at sign-in, never a blank page", () => {
    controls({ status: { kind: "signedOut" } });
    render(<YouPanel />);
    expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute("href", "/login");
  });

  test("signed in: always offers sign-out, even before a gamertag is linked", () => {
    controls({ status: { kind: "unlinked" }, name: "Steve" });
    render(<YouPanel />);
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
  });

  test("verified: shows the profile link", () => {
    controls({ status: { kind: "verified", link: { gamertag: "xSgt Hartman" } }, balance: 2 });
    render(<YouPanel />);
    expect(screen.getByRole("link", { name: /your profile/i })).toHaveAttribute("href", "/players/xsgt-hartman");
  });

  // Live-data honesty: an unresolved balance must not render as a confident zero.
  test("does not fabricate a zero balance while it is loading", () => {
    controls({ status: { kind: "verified", link: { gamertag: "Ghost" } }, balance: null, balanceLoading: true });
    render(<YouPanel />);
    expect(screen.queryByText(/^0$/)).toBeNull();
  });

  test("unlinked: does NOT carry the claim flow — that lives on Home", () => {
    controls({ status: { kind: "unlinked" }, name: "Steve" });
    render(<YouPanel />);
    expect(screen.queryByRole("button", { name: /claim/i })).toBeNull();
    expect(screen.getByRole("link", { name: /home/i })).toHaveAttribute("href", "/");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @onelife/web run test -- you-panel`
Expected: **FAIL** — cannot resolve `./you-panel`.

- [ ] **Step 3: Implement**

Create `apps/web/src/components/account/you-panel.tsx`:

```tsx
"use client";
import Link from "next/link";
import { signOutAndTeardownPush } from "@/lib/push";
import { playerSlug } from "@/lib/slug";
import { ApiError } from "@/lib/api";
import { useControls, useControlsActions } from "@/components/controls/use-controls";
import { transferErrorLabel } from "@/components/controls/format";
import { IdentityRow } from "@/components/controls/identity-row";
import { TokensPanel, type MutationView } from "@/components/controls/tokens-panel";

function mutView(m: { isPending: boolean; isSuccess: boolean; isError: boolean; error: unknown }): MutationView {
  return {
    pending: m.isPending,
    ok: m.isSuccess,
    error: m.isError ? transferErrorLabel(m.error instanceof ApiError ? m.error.code : "") : null,
  };
}

/**
 * The account page body. Identity, tokens and sign-out — the things a player changes rarely.
 *
 * ⚠️ The claim/verify ladder is deliberately NOT here. `unlinked` and `pending` are onboarding
 * states that belong on Home (sub-project C owns the three-mode home), and /you must never be the
 * only place to claim a gamertag.
 */
export function YouPanel() {
  const c = useControls();
  const a = useControlsActions();

  if (c.status.kind === "loading") {
    return <div aria-busy="true" aria-hidden className="h-40 motion-safe:animate-pulse bg-bone" />;
  }

  if (c.status.kind === "signedOut") {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="font-sans text-base text-ink-soft">You are not signed in.</p>
        <Link href="/login" className="border-b-2 border-red font-display text-sm font-semibold uppercase tracking-[.06em] text-ink hover:text-red">
          Sign in →
        </Link>
      </div>
    );
  }

  const verified = c.status.kind === "verified";
  const gamertag = verified ? c.status.link.gamertag : null;

  return (
    <div className="flex flex-col gap-5">
      <IdentityRow
        name={gamertag ?? c.name ?? "You"}
        provider={c.provider}
        verified={verified}
        tagLine={c.status.kind === "unlinked" ? "No gamertag" : undefined}
      />

      {c.status.kind !== "verified" && (
        <p className="font-sans text-base text-ink-soft">
          Claim and verify your gamertag on the{" "}
          <Link href="/" className="underline decoration-red decoration-2 underline-offset-2">
            home page
          </Link>
          .
        </p>
      )}

      {verified && (
        <TokensPanel
          balance={c.balance ?? 0}
          balanceLoading={c.balanceLoading}
          send={mutView(a.send)}
          referrer={mutView(a.refer)}
          onSend={(gt) => a.send.mutate(gt)}
          onSetReferrer={(gt) => a.refer.mutate(gt)}
          myGamertag={gamertag!}
        />
      )}

      <div className="flex justify-between border-t border-hairline pt-3 font-mono text-[11px] uppercase tracking-[.05em]">
        {gamertag ? (
          <Link href={`/players/${playerSlug(gamertag)}`} className="font-bold text-ink hover:text-red">
            Your profile →
          </Link>
        ) : (
          <span />
        )}
        <button type="button" onClick={() => void signOutAndTeardownPush()} className="text-ink-muted hover:text-red">
          Sign out
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create the route**

Create `apps/web/src/app/(site)/you/page.tsx`:

```tsx
import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { YouPanel } from "@/components/account/you-panel";

export const metadata: Metadata = {
  title: "You",
  robots: { index: false }, // a per-viewer account page has no business in a search index
};

export default function YouPage() {
  return (
    <div className="mx-auto max-w-[68ch] px-4 py-8">
      <PageHeader title="You" />
      <div className="mt-6">
        <YouPanel />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @onelife/web run test -- you-panel`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/(site)/you" apps/web/src/components/account/you-panel.tsx apps/web/src/components/account/you-panel.test.tsx
git commit -m "$(cat <<'EOF'
feat: add the /you account page

Identity, tokens and sign-out — the things a player changes rarely. The
claim/verify ladder deliberately stays on Home, so /you is never the only
route to a gamertag, and sign-out is reachable in every signed-in state.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015RgTMzCNtbCj8M1kFAk8FK
EOF
)"
```

---

### Task 7: Delete the three-surface machinery and relocate the panels

Nothing imports the rail, sheet or mobile trigger after Tasks 4–6. This task removes them and moves the surviving panels out of `controls/`.

**Files:**
- Delete: `controls/rail.tsx`, `rail.test.tsx`, `controls/sheet.tsx`, `sheet.test.tsx`, `controls/mobile-account.tsx`, `mobile-account.test.tsx`, `controls/signin-panel.tsx`, `lib/use-sheet-drag.ts` (+ its test if present)
- Move: the ten files listed in **File Structure** above
- Modify: every importer of the moved files

- [ ] **Step 1: Confirm nothing imports the doomed files**

```bash
grep -rn "controls/rail\|controls/sheet\|controls/mobile-account\|controls/signin-panel\|use-sheet-drag" apps/web/src | grep -v node_modules
```

Expected: only the files being deleted, and their own tests. **If anything else appears, stop** — Tasks 4–6 left a consumer behind.

- [ ] **Step 2: Delete them**

```bash
git rm -q apps/web/src/components/controls/rail.tsx apps/web/src/components/controls/rail.test.tsx \
  apps/web/src/components/controls/sheet.tsx apps/web/src/components/controls/sheet.test.tsx \
  apps/web/src/components/controls/mobile-account.tsx apps/web/src/components/controls/mobile-account.test.tsx \
  apps/web/src/components/controls/signin-panel.tsx apps/web/src/lib/use-sheet-drag.ts
```

- [ ] **Step 3: Move the survivors with `git mv`**

```bash
git mv apps/web/src/components/controls/identity-row.tsx apps/web/src/components/account/identity-row.tsx
git mv apps/web/src/components/controls/identity-row.test.tsx apps/web/src/components/account/identity-row.test.tsx
git mv apps/web/src/components/controls/link-panel.tsx apps/web/src/components/account/link-panel.tsx
git mv apps/web/src/components/controls/verify-panel.tsx apps/web/src/components/account/verify-panel.tsx
git mv apps/web/src/components/controls/link-verify-panels.test.tsx apps/web/src/components/account/link-verify-panels.test.tsx
git mv apps/web/src/components/controls/tokens-panel.tsx apps/web/src/components/account/tokens-panel.tsx
git mv apps/web/src/components/controls/tokens-panel.test.tsx apps/web/src/components/account/tokens-panel.test.tsx
git mv apps/web/src/components/controls/verification-announcer.tsx apps/web/src/components/account/verification-announcer.tsx
git mv apps/web/src/components/controls/verification-announcer.test.tsx apps/web/src/components/account/verification-announcer.test.tsx
git mv apps/web/src/components/controls/use-controls.ts apps/web/src/components/account/use-controls.ts
git mv apps/web/src/components/controls/use-controls.test.tsx apps/web/src/components/account/use-controls.test.tsx
git mv apps/web/src/components/controls/format.ts apps/web/src/components/account/format.ts
git mv apps/web/src/components/controls/format.test.ts apps/web/src/components/account/format.test.ts
git mv apps/web/src/components/controls/server-cards.tsx apps/web/src/components/servers/server-cards.tsx
git mv apps/web/src/components/controls/server-cards.test.tsx apps/web/src/components/servers/server-cards.test.tsx
git mv apps/web/src/components/controls/friends-panel.tsx apps/web/src/components/friends/friends-panel.tsx
git mv apps/web/src/components/controls/friends-panel.test.tsx apps/web/src/components/friends/friends-panel.test.tsx
git mv apps/web/src/components/controls/gamertag-autocomplete.tsx apps/web/src/components/shared/gamertag-autocomplete.tsx
git mv apps/web/src/components/controls/gamertag-autocomplete.test.tsx apps/web/src/components/shared/gamertag-autocomplete.test.tsx
```

- [ ] **Step 4: Fix every import**

```bash
grep -rln "@/components/controls/" apps/web/src | xargs sed -i '' \
  -e 's|@/components/controls/identity-row|@/components/account/identity-row|g' \
  -e 's|@/components/controls/link-panel|@/components/account/link-panel|g' \
  -e 's|@/components/controls/verify-panel|@/components/account/verify-panel|g' \
  -e 's|@/components/controls/tokens-panel|@/components/account/tokens-panel|g' \
  -e 's|@/components/controls/verification-announcer|@/components/account/verification-announcer|g' \
  -e 's|@/components/controls/use-controls|@/components/account/use-controls|g' \
  -e 's|@/components/controls/format|@/components/account/format|g' \
  -e 's|@/components/controls/server-cards|@/components/servers/server-cards|g' \
  -e 's|@/components/controls/friends-panel|@/components/friends/friends-panel|g' \
  -e 's|@/components/controls/gamertag-autocomplete|@/components/shared/gamertag-autocomplete|g'
```

Then fix the **relative** imports inside the moved files themselves (`./use-controls`, `./format`, `./identity-row`, …) — the moved files sit beside each other in `account/`, so most relative imports still resolve; `server-cards.tsx`, `friends-panel.tsx` and `gamertag-autocomplete.tsx` moved to different directories and need theirs rewritten to `@/components/account/…`.

- [ ] **Step 5: Drop the `boxed` variant from `TokensPanel`**

The dark surface it existed for (`ControlsSheet`) is gone. Remove the `boxed` prop, its branches and its test cases. Search for any other `onDark` prop on a moved panel and remove it the same way.

**Do not touch `NotificationRow` / `NotificationList`** — their bell popover is dark and their inbox page is light, so they still need their variants.

- [ ] **Step 6: Typecheck and test**

Run: `pnpm --filter @onelife/web run typecheck && pnpm --filter @onelife/web run test`
Expected: PASS. The `controls/` directory should now be empty:

```bash
ls apps/web/src/components/controls 2>/dev/null || echo "gone"
```

- [ ] **Step 7: Commit**

```bash
git add -u apps/web/src
git add apps/web/src/components/account apps/web/src/components/servers apps/web/src/components/friends apps/web/src/components/shared
git commit -m "$(cat <<'EOF'
refactor!: delete the three-surface controls machinery

The rail, the bottom sheet, its masthead trigger and the signed-out rail
panel are gone; the panels they shared move to components/account,
components/servers, components/friends and components/shared.

This retires the two-surface token rule: every relocated panel now renders
on light paper only, so TokensPanel's `boxed` variant goes with it. The rule
still governs NotificationRow/NotificationList, whose popover is dark.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015RgTMzCNtbCj8M1kFAk8FK
EOF
)"
```

---

### Task 8: Adopt the page header on the list pages

**Files:**
- Modify: `apps/web/src/app/(site)/friends/page.tsx`
- Modify: `apps/web/src/components/notifications/inbox.tsx`
- Modify: `apps/web/src/components/survivors/survivors-board.tsx` (+ its test)

- [ ] **Step 1: Friends**

Replace the hand-rolled `<h1>` with `<PageHeader title="The Roster" />`. The roster's own count is inside `Roster`; leave it there for now — C and D wire real counts in.

- [ ] **Step 2: Notifications**

In `inbox.tsx`, replace the hand-rolled heading with `<PageHeader title="The Wire" />`, keeping the `PushToggle` where it is.

- [ ] **Step 3: Leaderboard**

Read `apps/web/src/components/survivors/survivors-board.tsx` first — it renders an `<h1>` (from
`survivor-metadata.ts`'s visible title), a dek line from `dekLine(total)`, and a `<SurvivorControls>`
row. Replace the heading and dek with:

```tsx
<PageHeader
  title={heading}
  count={{ kind: "ready", value: total, noun: "still drawing breath" }}
/>
```

where `heading` is the existing visible `<h1>` string (`Survivors` or `{Map} survivors`). **Pass no
`control`** — `SurvivorControls` is a two-row block (map tabs + sort pills) that does not fit the
header's single right-aligned slot, and D deletes the sort layer entirely. Leave it rendering
directly below the header, exactly where it is now.

`dekLine` loses its only caller. **Delete it and its tests** — leaving an unused exported formatter
is how the last dead-copy pile accumulated.

> The SEO title in `survivor-metadata.ts` is a different string and is not touched here.

- [ ] **Step 4: Run the suite**

Run: `pnpm --filter @onelife/web run test`
Expected: PASS. `survivors-board.test.tsx` and `format.test.ts` both assert the dek string; the
board test should now assert the header's count line, and `dekLine`'s own test cases are deleted
with the function.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "$(cat <<'EOF'
refactor: adopt the shared page header on Friends, Notifications and the board

Three hand-rolled headings collapse into one component, so the honest count
rendering is defined in a single place.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015RgTMzCNtbCj8M1kFAk8FK
EOF
)"
```

---

### Task 9: Docs

**Files:**
- Modify: `CLAUDE.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Narrow the two-surface rule in `CLAUDE.md`**

Find the **⚠️ THE TWO SURFACES HAVE OPPOSITE BACKGROUNDS** block in the R3 section. It describes the rail (light) vs `ControlsSheet` (dark). Rewrite it to say the sheet is gone and the rule now governs **only** `NotificationRow` / `NotificationList` — do not delete it outright, the failure mode is still live for those two.

- [ ] **Step 2: Update the LAYER LEGEND references**

`CLAUDE.md` names `ControlsSheet` as the `z-50` occupant and `ControlsRail` as the `sticky` offender. Update both: the `z-50` overlays are now the skip link and the mobile menu's successor; the tab bar shares `z-40`; `HomeSidebar` is the `xl:sticky` element.

- [ ] **Step 3: Add the sub-project B entry**

Add a `- **Sub-project B — App shell** ✅` entry to the sub-projects list recording: the nav change, the tab bar, `/you`, the Home-only sidebar, the page header, and that `components/controls/` no longer exists.

- [ ] **Step 4: Changelog**

Under `## [Unreleased]`:

```markdown
### Changed

- **New app shell.** Navigation is now Home · Maps · Leaderboard · About. On phones a bottom tab
  bar (Home · Map · Board · Friends · You) replaces the hamburger menu and the account sheet, and
  the account controls move to a dedicated **/you** page reachable from the masthead at every
  width. The controls rail is now a Home-only sidebar, so every other page gets its full width
  back. "Leaderboard" is a rename of "Survivors"; the URL is unchanged.
```

- [ ] **Step 5: Full verification**

Run: `pnpm turbo run typecheck && pnpm turbo run test --concurrency=1`
Expected: PASS.

- [ ] **Step 6: Commit and open the PR**

```bash
git add CLAUDE.md CHANGELOG.md
git commit -m "$(cat <<'EOF'
docs: record the app-shell change

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015RgTMzCNtbCj8M1kFAk8FK
EOF
)"
```

Then use `keel:finish-work` to open the PR against `main`.

---

### Task 10: The real-device verification pass

**Do not mark B complete without this.** jsdom asserts the DOM, not paint; two releases shipped green-but-broken on 2026-07-22 for exactly this reason.

Run against a dev server (`pnpm --filter @onelife/web run dev`) on a real phone, or Chrome device emulation plus one physical check.

- [ ] **Step 1: B's five checks**

1. Scroll to the bottom of `/survivors` on a phone — the tab bar does not cover the last row.
2. In PWA/standalone mode on a notched phone, the tab bar is ~64px tall, not a sliver.
3. The bell popover paints **over** the tab bar; page content paints **under** it.
4. Every action is reachable below `xl` — nothing is stranded in the Home sidebar.
5. At 320px the masthead avatar and the bell do not collide or wrap.

- [ ] **Step 2: M1's outstanding browser pass**

The six checks in `docs/superpowers/plans/2026-07-22-m1-map-tool-shell.md` Task 9, still outstanding since 2026-07-22. They need real mirrored tiles — a tile-less local run is explicitly not sufficient.

- [ ] **Step 3: Record the result**

Note the outcome in the PR. If a check fails, fix it in this branch — a deferred browser fix is how M1's pass ended up outstanding for two days.
