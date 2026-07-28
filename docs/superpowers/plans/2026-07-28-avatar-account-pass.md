# Avatar & Account Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Contain the masthead width, turn the masthead avatar into a dropdown (profile + sign out), delete `/you`, put the player's avatar on their dossier with an owner-only update flow, and tier avatars across every survivors-board row.

**Architecture:** Web-heavy with one read-model field: `getPlayerPage` gains `avatarHash` (verified-link + non-tombstoned join, the board's exact clause pair) through `GET /players/:gamertag` to the dossier hero; everything else is `apps/web` presentation. Spec: `docs/superpowers/specs/2026-07-28-avatar-account-pass-design.md`.

**Tech Stack:** Next.js App Router, TanStack Query, Drizzle + Postgres read-models, Fastify, vitest + RTL.

## Global Constraints

- **Dark-surface tokens only** in the masthead/dropdown (`bg-dark`, `dark-well`, `dark-line`, `dark-edge-bright`, `text-paper`, `text-cream-dim`, plain `red`/`red-soft` — never `red-deep` as dark text). Light tokens on dossier/board. No raw hexes, no invented tokens.
- **LAYER LEGEND unchanged:** masthead stays `relative z-40`; the dropdown popover is `z-50` INSIDE it (the bell's pattern), no new altitude.
- **`useModalBehavior(open, onClose)` panels need `tabIndex={-1}`** or the focus move silently no-ops.
- **Avatar joins are verified-link + `image IS NOT NULL`** (tombstone rule), on `lower(gamertag)`. A tombstone or unverified link → `null`.
- **Ownership gate** = signed-in session + `link.status === "verified"` + `link.gamertag === page.gamertag` (the `self-unban-button.tsx:98` gate). The gate must skip the render, and any owner-only fetch, for non-owners.
- **Sign-out always goes through `signOutAndTeardownPush`** (`@/lib/push`) — never bare `signOut()`.
- **Board avatars are decorative** (`alt=""`); tier sizes: rank 1 = 96px, ranks 2–5 = 60px, ranks 6+ and all of pages 2+ = 28px; hash-less rows show an initial disc (first character of gamertag), never an empty slot.
- **Live-data honesty & repo law** as ever: loading is never an authoritative empty; web tests `pnpm --filter @onelife/web test -- <pattern>`; DB suites need `TEST_DATABASE_URL` (Postgres on port 5434, db `onelife_test`); CHANGELOG entry before PR. Branch: `feature/avatar-account-pass` (spec committed).

---

### Task 1: Masthead width containment

**Files:**
- Modify: `apps/web/src/components/header.tsx:72` (the inner flex row)
- Test: `apps/web/src/components/header.test.tsx` (extend the right-cluster/altitude assertions)

**Interfaces:** none new — a class-only change.

- [ ] **Step 1: Write the failing test** — add to the `describe("Masthead")` in `header.test.tsx` (its harness already wraps in a QueryClientProvider and stubs the bell + account affordance):

```tsx
it("contains the row to the boxed content width on ultrawide screens", () => {
  const { container } = render(<Masthead />);
  const row = container.querySelector("header > div");
  expect(row).not.toBeNull();
  // Must match the (boxed) layout's box: centered, capped at 1440px, xl gutter.
  expect(row!.className).toMatch(/\bmx-auto\b/);
  expect(row!.className).toMatch(/\bmax-w-\[1440px\]\b/);
  expect(row!.className).toMatch(/\bxl:px-10\b/);
  expect(row!.className).toMatch(/\bw-full\b/);
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @onelife/web test -- header` → the new test FAILS.

- [ ] **Step 3: Implement** — in `header.tsx`, change the inner row's className from
  `"flex h-14 items-center gap-7 px-4 md:px-6"` to
  `"mx-auto flex h-14 w-full max-w-[1440px] items-center gap-7 px-4 md:px-6 xl:px-10"`,
  and add one comment line above it: `{/* Same box as (boxed)/layout.tsx — on an ultrawide the wordmark must align with the content edge, not the viewport edge. The dark bar itself stays full-bleed. */}`

- [ ] **Step 4: Run to verify it passes** — `pnpm --filter @onelife/web test -- header` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/header.tsx apps/web/src/components/header.test.tsx
git commit -m "fix(web): contain the masthead row to the boxed content width"
```

---

### Task 2: Masthead avatar dropdown

**Files:**
- Modify: `apps/web/src/components/shell/account-affordance.tsx` (full rewrite below)
- Test: `apps/web/src/components/shell/account-affordance.test.tsx` (rewrite)

**Interfaces:**
- Consumes: `useModalBehavior(open, onClose)` from `@/lib/use-modal-behavior`; `signOutAndTeardownPush` from `@/lib/push`; `playerSlug` from `@/lib/slug`; `avatarSrc` from `@/components/shared/avatar`; `useAccountStatus`, `getAvatar` (as today). Pattern source: `notifications/bell.tsx` (outside-click `mousedown` on a `rootRef`, route-change close via `usePathname` + prev ref).
- Produces: `AccountAffordance()` — same export, now a dropdown trigger. Task 3 relies on it no longer linking `/you`.

- [ ] **Step 1: Rewrite the test file (failing first)**

```tsx
// apps/web/src/components/shell/account-affordance.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AccountAffordance } from "./account-affordance";

const mockStatus = vi.fn();
vi.mock("@/lib/use-account-status", () => ({ useAccountStatus: () => mockStatus() }));
const mockPathname = vi.fn(() => "/");
vi.mock("next/navigation", () => ({ usePathname: () => mockPathname() }));
const teardown = vi.fn();
vi.mock("@/lib/push", () => ({ signOutAndTeardownPush: () => teardown() }));
vi.mock("@/lib/api", () => ({ getAvatar: vi.fn().mockResolvedValue({ hash: null }) }));

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><AccountAffordance /></QueryClientProvider>);
}

beforeEach(() => vi.clearAllMocks());

describe("AccountAffordance", () => {
  it("renders nothing while loading and a Sign in chip when signed out", () => {
    mockStatus.mockReturnValue({ kind: "loading" });
    const { container } = renderIt();
    expect(container).toBeEmptyDOMElement();
    mockStatus.mockReturnValue({ kind: "signedOut" });
    renderIt();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  });

  it("verified: the disc is a menu button opening profile + sign out", () => {
    mockStatus.mockReturnValue({ kind: "verified", link: { gamertag: "YrJustBad" } });
    renderIt();
    const trigger = screen.getByRole("button", { name: "Your account" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menuitem", { name: "Your profile →" })).toHaveAttribute("href", "/players/yrjustbad");
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(teardown).toHaveBeenCalled();
  });

  it("unlinked: claim link instead of profile, sign out still present", () => {
    mockStatus.mockReturnValue({ kind: "unlinked" });
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: "Your account" }));
    expect(screen.getByRole("menuitem", { name: "Claim your gamertag →" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Your profile →" })).not.toBeInTheDocument();
  });

  it("Escape closes and the panel is focusable (tabIndex -1)", () => {
    mockStatus.mockReturnValue({ kind: "verified", link: { gamertag: "X" } });
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: "Your account" }));
    const menu = screen.getByRole("menu");
    expect(menu).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("never links to /you anywhere", () => {
    mockStatus.mockReturnValue({ kind: "verified", link: { gamertag: "X" } });
    const { container } = renderIt();
    fireEvent.click(screen.getByRole("button", { name: "Your account" }));
    expect(container.querySelector('a[href="/you"]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @onelife/web test -- account-affordance` → FAIL (current component is a `/you` link).

- [ ] **Step 3: Rewrite the component**

```tsx
// apps/web/src/components/shell/account-affordance.tsx
"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useAccountStatus } from "@/lib/use-account-status";
import { getAvatar } from "@/lib/api";
import { avatarSrc } from "@/components/shared/avatar";
import { useModalBehavior } from "@/lib/use-modal-behavior";
import { signOutAndTeardownPush } from "@/lib/push";
import { playerSlug } from "@/lib/slug";

/**
 * The masthead's account control — an avatar disc that opens a small menu (profile / claim +
 * sign out). Replaces the old plain link to /you, which is deleted (avatar-account-pass spec §4).
 *
 * ⚠️ Renders at EVERY width — this is the only route to sign-out now.
 * Pattern is MastheadBell's: owned open state, outside-click via a rootRef mousedown listener,
 * route-change close, useModalBehavior for Escape/focus (panel MUST carry tabIndex={-1}).
 * The popover's z-50 ranks it inside the z-40 masthead — no new altitude (LAYER LEGEND).
 */
export function AccountAffordance() {
  const status = useAccountStatus();
  const signedIn = status.kind === "unlinked" || status.kind === "pending" || status.kind === "verified";
  const avatar = useQuery({ queryKey: ["avatar"], queryFn: getAvatar, enabled: signedIn });

  const [open, setOpen] = useState(false);
  const panelRef = useModalBehavior(open, () => setOpen(false));
  const rootRef = useRef<HTMLDivElement>(null);

  const pathname = usePathname();
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
  const initial = gamertag ? gamertag.trim().charAt(0).toUpperCase() : "•";
  const hash = avatar.data?.hash ?? null;
  const itemClass =
    "block w-full px-3 py-2 text-left font-mono text-[11px] uppercase tracking-[.08em] text-paper hover:bg-dark-well hover:text-red-soft";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Your account"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="account-menu"
        className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-dark-edge-bright bg-dark-well font-display text-sm font-bold uppercase text-paper hover:border-red hover:text-red"
      >
        {hash ? (
          <img src={avatarSrc(hash)} alt="" width={36} height={36} className="h-full w-full object-cover" />
        ) : (
          <span aria-hidden>{initial}</span>
        )}
      </button>
      {open && (
        <div
          ref={panelRef}
          id="account-menu"
          role="menu"
          aria-label="Your account"
          tabIndex={-1}
          className="absolute right-0 top-full z-50 mt-2 w-[200px] border border-dark-line bg-dark py-1 shadow-[0_10px_30px_rgba(0,0,0,.45)]"
        >
          {gamertag ? (
            <Link role="menuitem" href={`/players/${playerSlug(gamertag)}`} className={itemClass}>
              Your profile →
            </Link>
          ) : (
            <Link role="menuitem" href="/" className={itemClass}>
              Claim your gamertag →
            </Link>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => void signOutAndTeardownPush()}
            className={itemClass}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes** — `pnpm --filter @onelife/web test -- account-affordance` → PASS (5 tests). Also `pnpm --filter @onelife/web test -- header` (the stubbed masthead tests must stay green).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/shell/account-affordance.tsx apps/web/src/components/shell/account-affordance.test.tsx
git commit -m "feat(web): masthead avatar becomes a dropdown menu (profile / claim + sign out)"
```

---

### Task 3: Delete `/you`

**Files:**
- Delete: `apps/web/src/app/(site)/(boxed)/you/page.tsx` (the whole `you/` directory), `apps/web/src/components/account/you-panel.tsx`, `apps/web/src/components/account/you-panel.test.tsx`
- Modify: `apps/web/src/components/login-panel.tsx:23` (the `/you` link), `apps/web/src/components/login-panel.test.tsx:22`, `apps/web/src/lib/nav.test.ts:35` (drop the `/you` mapping row), comment-only mentions in `apps/web/src/components/account/account-panels.tsx` and `apps/web/src/components/account/tokens-summary.tsx`
- Test: extend `apps/web/src/lib/nav.test.ts` replacement row

**Interfaces:** none — deletions plus link retargets. AccountAffordance (Task 2) already stopped linking `/you`.

- [ ] **Step 1: Delete and retarget (failing tests are the suite itself here — deletion-first TDD is impractical; the gate is the full web suite)**

```bash
git rm -r "apps/web/src/app/(site)/(boxed)/you" apps/web/src/components/account/you-panel.tsx apps/web/src/components/account/you-panel.test.tsx
```

In `login-panel.tsx`, the already-signed-in affordance pointing at `/you` now points at `/` (Home owns the signed-in surface); keep its visible label if it says something generic, or change to `Go to your dashboard →` — match the existing copy style and update `login-panel.test.tsx`'s href assertion to `/`.

In `nav.test.ts`, the `["/you", null]` row: change to `["/players/anything", null]` (still asserting an unmapped path returns null — keeps the case without referencing a dead route).

In `account-panels.tsx` / `tokens-summary.tsx` / `three-modes.test.tsx`, update comment text that references `/you` to name the masthead avatar menu instead (comments only — no behavior).

- [ ] **Step 2: Prove the route is gone** — add to `apps/web/src/lib/nav.test.ts` is NOT the place; instead add a filesystem assertion to the existing `apps/web/src/app/not-found.test.tsx`-adjacent level is overkill. The honest check: run a grep gate and the full suite:

```bash
grep -rn '"/you"\|/you\b' apps/web/src --include='*.tsx' --include='*.ts' | grep -v node_modules
```

Expected: ZERO hits that are links/routes (comment mentions you rewrote should no longer say `/you` either). Record the grep output in the task report.

- [ ] **Step 3: Run the full web suite + typecheck** — `pnpm --filter @onelife/web test && pnpm --filter @onelife/web typecheck` → all green (this catches any missed import of `YouPanel`).

- [ ] **Step 4: Commit**

```bash
git add -A apps/web/src
git commit -m "feat(web): delete /you — its jobs live in the avatar menu, Home, and the dossier"
```

---

### Task 4: `avatarHash` on the player page (read-model + API + web type)

**Files:**
- Modify: `packages/read-models/src/player-page.ts` (interface `:44-54`, imports `:2`, return `:210-212`)
- Modify: `apps/web/src/lib/types.ts:146` (`PlayerPage` gains `avatarHash: string | null`)
- Test: `packages/read-models/test/player-page.test.ts` (extend), `apps/api/test/player-aggregate-routes.test.ts` (field presence)

**Interfaces:**
- Consumes: existing `gamertagLinks` import; add `avatars` to the `@onelife/db` import. Clause-pair reference: `packages/read-models/src/survivors.ts:145-163`.
- Produces: `PlayerPage.avatarHash: string | null` — Task 5 renders it.

- [ ] **Step 1: Write the failing tests** — in `packages/read-models/test/player-page.test.ts`, following the file's existing seed helpers (users + `gamertagLinks` + `avatars` seeding exists in `survivors.test.ts` — mirror its `insertAvatarLink` shape; suffix ids/gamertags with the file's random service id):

```ts
it("carries the verified owner's live avatar hash", async () => {
  // seed: user U, verified link for gamertag G (this page's), avatars row image!=null hash "abc123"
  const page = await getPlayerPage(db, gamertagWithAvatar, now);
  expect(page?.avatarHash).toBe("abc123");
});

it("a PENDING link contributes no hash", async () => {
  // seed: pending link + live avatar for gamertag G2
  const page = await getPlayerPage(db, gamertagPendingLink, now);
  // MUTATION CHECK: drop eq(gamertagLinks.status, "verified") and this fails.
  expect(page?.avatarHash).toBeNull();
});

it("a TOMBSTONED avatar (image NULL) contributes no hash", async () => {
  // seed: verified link + avatars row with image: null, hash "dead99"
  const page = await getPlayerPage(db, gamertagTombstone, now);
  // MUTATION CHECK: drop isNotNull(avatars.image) and this fails.
  expect(page?.avatarHash).toBeNull();
});
```

- [ ] **Step 2: Run to verify they fail** — `pnpm --filter @onelife/read-models test -- player-page` (with `TEST_DATABASE_URL` exported) → the three FAIL (`avatarHash` undefined).

- [ ] **Step 3: Implement** — in `player-page.ts`:
  - add `avatars` to the `@onelife/db` import and `isNotNull` to the drizzle-orm import if absent;
  - add `avatarHash: string | null;` to `PlayerPage` beside `verified`;
  - after the existing `vf` verified-link lookup (`:89`), add:

```ts
// The dossier's avatar — the board's exact clause pair (avatar-account-pass spec §5): only a
// VERIFIED link with a LIVE (non-tombstoned) avatar contributes; pending links and removals
// resolve to null exactly like no row at all.
const [avatarRow] = await db
  .select({ hash: avatars.hash })
  .from(gamertagLinks)
  .innerJoin(avatars, and(eq(avatars.userId, gamertagLinks.userId), isNotNull(avatars.image)))
  .where(and(
    eq(gamertagLinks.status, "verified"),
    inArray(sql`lower(${gamertagLinks.gamertag})`, identityNames.map((n) => n.toLowerCase())),
  ))
  .limit(1);
```

  (`identityNames` is the alias-name list the `vf` lookup already uses — reuse the same variable; if it is named differently at `:84-88`, match it.) Add `avatarHash: avatarRow?.hash ?? null,` to the return object.
  - In `apps/web/src/lib/types.ts`, add `avatarHash: string | null;` to `PlayerPage`.

- [ ] **Step 4: Run tests** — read-models suite passes; then run the two mutation checks (temporarily drop each clause, watch the named test fail, restore, re-run green; record in the report). Then extend `apps/api/test/player-aggregate-routes.test.ts` with a field-presence assertion on an existing 200 response test: `expect(body).toHaveProperty("avatarHash");` and run `pnpm --filter @onelife/api test -- player-aggregate`.

- [ ] **Step 5: Commit**

```bash
git add packages/read-models/src/player-page.ts packages/read-models/test/player-page.test.ts apps/api/test/player-aggregate-routes.test.ts apps/web/src/lib/types.ts
git commit -m "feat(read-models): avatarHash on the player page — verified, non-tombstoned only"
```

---

### Task 5: Dossier hero avatar + owner update

**Files:**
- Modify: `apps/web/src/components/player/player-hero.tsx` (portrait disc), `apps/web/src/components/player/player-profile.tsx` (mount the owner control under the hero)
- Create: `apps/web/src/components/player/owner-avatar.tsx`
- Modify: `apps/web/src/components/account/avatar-panel.tsx:49` (invalidate `["player-page"]` too)
- Test: `apps/web/src/components/player/player-hero.test.tsx` (extend), `apps/web/src/components/player/owner-avatar.test.tsx` (new)

**Interfaces:**
- Consumes: `PlayerPage.avatarHash` (Task 4); `Avatar` from `@/components/shared/avatar`; `AvatarPanel` (no props); the ownership gate pattern from `self-unban-button.tsx:95-103` (`useSession`, `useGamertagLinks(!!session?.user)`, `activeLink`).
- Produces: `OwnerAvatar({ pageGamertag }: { pageGamertag: string })` — renders the `Update photo` toggle + `AvatarPanel` for the owner, null otherwise.

- [ ] **Step 1: Write the failing tests**

Extend `player-hero.test.tsx` (follow its existing fixture; add `avatarHash` to it):

```tsx
it("renders the portrait disc when a hash is present", () => {
  render(<PlayerHero page={{ ...fixture, avatarHash: "abc123" }} />);
  const img = document.querySelector('img[src="/api/avatars/abc123.webp"]');
  expect(img).not.toBeNull();
  expect(img).toHaveAttribute("alt", "");
});

it("renders NO disc and no placeholder without a hash", () => {
  render(<PlayerHero page={{ ...fixture, avatarHash: null }} />);
  expect(document.querySelector("img")).toBeNull(); // hero has no other imgs
});
```

New `owner-avatar.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { OwnerAvatar } from "./owner-avatar";

const mockSession = vi.fn();
const mockLinks = vi.fn();
vi.mock("@/lib/auth-client", () => ({ useSession: () => mockSession() }));
vi.mock("@/lib/use-gamertag-links", () => ({
  useGamertagLinks: () => mockLinks(),
  activeLink: (links: unknown[] | undefined) => links?.[0] ?? null,
}));
vi.mock("@/components/account/avatar-panel", () => ({ AvatarPanel: () => <div data-testid="avatar-panel" /> }));

describe("OwnerAvatar", () => {
  it("owner (verified, matching): shows the toggle; panel appears on click", () => {
    mockSession.mockReturnValue({ data: { user: { id: "u1" } } });
    mockLinks.mockReturnValue({ data: [{ status: "verified", gamertag: "YrJustBad" }] });
    render(<OwnerAvatar pageGamertag="YrJustBad" />);
    expect(screen.queryByTestId("avatar-panel")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Update photo/i }));
    expect(screen.getByTestId("avatar-panel")).toBeInTheDocument();
  });

  it("pending link: renders nothing", () => {
    mockSession.mockReturnValue({ data: { user: { id: "u1" } } });
    mockLinks.mockReturnValue({ data: [{ status: "pending", gamertag: "YrJustBad" }] });
    const { container } = render(<OwnerAvatar pageGamertag="YrJustBad" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("stranger (different gamertag): renders nothing", () => {
    mockSession.mockReturnValue({ data: { user: { id: "u1" } } });
    mockLinks.mockReturnValue({ data: [{ status: "verified", gamertag: "SomeoneElse" }] });
    const { container } = render(<OwnerAvatar pageGamertag="YrJustBad" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("signed out: renders nothing and never fetches links", () => {
    mockSession.mockReturnValue({ data: null });
    mockLinks.mockReturnValue({ data: undefined });
    const { container } = render(<OwnerAvatar pageGamertag="YrJustBad" />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

⚠️ Before writing the mocks, check the REAL import paths used by `self-unban-button.tsx` for `useSession`/`useGamertagLinks`/`activeLink` and mirror them exactly (the paths above are the expected ones — verify, don't trust).

- [ ] **Step 2: Run to verify they fail** — `pnpm --filter @onelife/web test -- player-hero && pnpm --filter @onelife/web test -- owner-avatar` → FAIL.

- [ ] **Step 3: Implement**

`player-hero.tsx`: import `Avatar` from `@/components/shared/avatar`; inside the `mt-1 flex flex-wrap items-center` row, render before the `<h1>`:

```tsx
{page.avatarHash && <Avatar hash={page.avatarHash} size={72} />}
```

(The shared `Avatar` renders `alt=""` for a present hash; passing it only when non-null means no silhouette placeholder — spec: no image → no disc.)

`owner-avatar.tsx`:

```tsx
"use client";
import { useState } from "react";
// ⚠️ mirror self-unban-button.tsx's exact imports for these three:
import { useSession } from "@/lib/auth-client";
import { useGamertagLinks, activeLink } from "@/lib/use-gamertag-links";
import { AvatarPanel } from "@/components/account/avatar-panel";

/**
 * Owner-only avatar management on the dossier (avatar-account-pass spec §5) — the home of the
 * deleted /you page's AvatarPanel. The gate is self-unban's: signed-in + VERIFIED link matching
 * this page. It gates the FETCH too (useGamertagLinks enabled on session), so strangers cost
 * nothing and see nothing — no flash while identity resolves.
 */
export function OwnerAvatar({ pageGamertag }: { pageGamertag: string }) {
  const { data: session } = useSession();
  const links = useGamertagLinks(!!session?.user);
  const link = activeLink(links.data);
  const [openPanel, setOpenPanel] = useState(false);

  const isOwner = !!session?.user && link?.status === "verified" && link.gamertag === pageGamertag;
  if (!isOwner) return null;

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setOpenPanel((v) => !v)}
        aria-expanded={openPanel}
        className="border-b-2 border-red font-display text-sm font-semibold uppercase tracking-[.06em] text-ink hover:text-red"
      >
        Update photo {openPanel ? "↑" : "↓"}
      </button>
      {openPanel && (
        <div className="mt-3 max-w-md">
          <AvatarPanel />
        </div>
      )}
    </div>
  );
}
```

(Check `useGamertagLinks`' real signature — if it returns the query object with `.data`, the above works; adjust to reality, and note `useSession` may need the exact narrowing self-unban uses.)

`player-profile.tsx`: mount `<OwnerAvatar pageGamertag={page.gamertag} />` immediately after the `<PlayerHero …/>`.

`avatar-panel.tsx:49`: extend the invalidation so every avatar surface agrees:

```ts
const invalidate = () => {
  void qc.invalidateQueries({ queryKey: ["avatar"] });
  // The dossier hero + board read the hash through the player page; a change must reach them.
  void qc.invalidateQueries({ queryKey: ["player-page"] });
};
```

- [ ] **Step 4: Run tests** — the two new files plus `pnpm --filter @onelife/web test -- avatar-panel` (its existing tests must stay green) → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/player/player-hero.tsx apps/web/src/components/player/player-hero.test.tsx apps/web/src/components/player/player-profile.tsx apps/web/src/components/player/owner-avatar.tsx apps/web/src/components/player/owner-avatar.test.tsx apps/web/src/components/account/avatar-panel.tsx
git commit -m "feat(web): dossier avatar + owner-only update flow"
```

---

### Task 6: Survivors board avatar tiers

**Files:**
- Modify: `apps/web/src/components/survivors/format.ts:8-15` (`tierFor`), `apps/web/src/components/survivors/survivor-row.tsx` (all three branches), `apps/web/src/components/shared/avatar.tsx` (optional `fallbackInitial`)
- Test: the survivors component test file(s) covering `tierFor`/`SurvivorRow` (extend), `apps/web/src/components/shared/avatar.test.tsx` (extend)

**Interfaces:**
- Consumes: `Avatar({ hash, size, dim? })` — gains optional `fallbackInitial?: string`.
- Produces: `tierFor(rank)` new cut: 1 → `"hero"`, 2–5 → `"podium"`, 6+ → `"compact"` (type `RowTier` unchanged).

- [ ] **Step 1: Write the failing tests**

In the survivors test file that covers `tierFor` (find it: `grep -rln "tierFor" apps/web/src`):

```ts
it("tiers: 1 hero, 2–5 podium, 6+ compact", () => {
  expect(tierFor(1)).toBe("hero");
  expect(tierFor(2)).toBe("podium");
  expect(tierFor(5)).toBe("podium");
  expect(tierFor(6)).toBe("compact");
});
```

Row-level (same file or `survivor-row` tests; use the file's existing row fixture):

```tsx
it("hero portrait is 96px", () => {
  render(<ol><SurvivorRow row={row({ avatarHash: "h1" })} rank={1} /></ol>);
  expect(document.querySelector('img[width="96"]')).not.toBeNull();
});

it("compact rows carry a 28px avatar disc", () => {
  render(<ol><SurvivorRow row={row({ avatarHash: "h2" })} rank={7} /></ol>);
  expect(document.querySelector('img[width="28"]')).not.toBeNull();
});

it("a hash-less compact row shows the initial disc, never an empty slot", () => {
  render(<ol><SurvivorRow row={row({ gamertag: "Khushie", avatarHash: null })} rank={9} /></ol>);
  expect(screen.getByText("K")).toBeInTheDocument();
});
```

In `avatar.test.tsx`:

```tsx
it("renders the fallback initial instead of the silhouette when provided", () => {
  render(<Avatar hash={null} size={28} fallbackInitial="K" />);
  expect(screen.getByText("K")).toBeInTheDocument();
  expect(document.querySelector("svg")).toBeNull();
});
```

- [ ] **Step 2: Run to verify they fail** — `pnpm --filter @onelife/web test -- survivors && pnpm --filter @onelife/web test -- avatar` (scope to the failing files) → new tests FAIL.

- [ ] **Step 3: Implement**

`format.ts`:

```ts
export function tierFor(rank: number): RowTier {
  if (rank === 1) return "hero";
  if (rank <= 5) return "podium"; // widened from 3 (avatar-account-pass spec §6)
  return "compact";
}
```

`avatar.tsx` — add the prop; when `hash` is null and `fallbackInitial` is provided, render the initial in the same bordered disc (`bg-bone text-ink-muted`, `font-display font-bold uppercase`, font-size ≈ `size * 0.45`) instead of the SVG silhouette; the silhouette remains the default fallback for existing call sites.

`survivor-row.tsx`:
- hero branch: `size={76}` → `size={96}` and grid columns `76px` → `96px` (both `grid-cols` variants);
- podium branch: unchanged sizes (60px) — membership widened by `tierFor` alone;
- compact branch: add an avatar column — grid `grid-cols-[40px_1fr_auto]` → `grid-cols-[40px_28px_1fr_auto]` (and the `sm:` variant `56px_28px_1fr_auto`), with `<Avatar hash={row.avatarHash} size={28} fallbackInitial={row.gamertag.trim().charAt(0).toUpperCase()} />`;
- pass `fallbackInitial` in the hero and podium branches too (spec: every row shows an initial disc when hash-less — the silhouette is replaced on this board; keep silhouette elsewhere).

- [ ] **Step 4: Run tests** — the survivors + avatar + full web suite: `pnpm --filter @onelife/web test && pnpm --filter @onelife/web typecheck` → green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/survivors/format.ts apps/web/src/components/survivors/survivor-row.tsx apps/web/src/components/shared/avatar.tsx apps/web/src/components/shared/avatar.test.tsx apps/web/src/components/survivors
git commit -m "feat(web): avatar tiers across the survivors board — 96/60/28 with initial-disc fallback"
```

---

### Task 7: Docs + full verification

**Files:**
- Modify: `CHANGELOG.md` (Unreleased), `CLAUDE.md`

- [ ] **Step 1: Changelog** (match existing style; new `### Changed` under `## [Unreleased]` if none exists):

```markdown
### Changed

- The masthead avatar is a menu now (profile / claim + sign out), and the masthead row no longer
  stretches to the edges of an ultrawide monitor. The `/you` page is gone — your avatar is
  managed on your own player page (verified players only), where your photo now appears; the
  survivors board shows every player's avatar in three sizes (leader largest, top five medium,
  the rest small).
```

- [ ] **Step 2: CLAUDE.md** — two amendments: (1) in the Login avatars entry, replace "The player
  dossier stays deliberately avatar-free (unchanged since the v0.11.0 redesign)" with a note that
  the dossier now carries the verified owner's avatar (same verified + non-tombstoned join) with
  an owner-only update flow, and that `/you` is DELETED — avatar management is verified-only on
  the dossier, sign-out lives in the masthead avatar menu; (2) in the Survivors leaderboard
  entry, update the tier description (hero 96px; podium is ranks 2–5 at 60px; compact rows carry
  28px initial-disc avatars).

- [ ] **Step 3: Full suite + typecheck** — repo root, `TEST_DATABASE_URL` exported:
  `pnpm turbo run test --concurrency=1 && pnpm turbo run typecheck` → 22/22 green both.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md CLAUDE.md
git commit -m "docs: changelog + CLAUDE.md for the avatar & account pass"
```

---

## Post-plan notes (not tasks)

- **Deploy:** plain `./deploy/deploy.sh`, no `--rebuild`, no migration, no env vars.
- **Browser checklist (pre-release):** masthead alignment on an ultrawide; the dropdown at phone + desktop widths (and that the popover paints over page content); board tiers at real widths; the dossier round trip — upload on your own page → hero, masthead disc and board all show it (the login-avatars feature's long-outstanding browser check).
- **PR** via keel:finish-work.
