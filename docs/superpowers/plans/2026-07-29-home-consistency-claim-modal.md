# Home Consistency + Claim Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One shared home beat rhythm (Hero → Rules → Join → Claim-it slab → Fallen) for cold/unlinked/pending, the claim ladder replaced by a hash-driven modal, the stray sign-out bar deleted, pending emote tickets restyled to match the Join tickets, and the browser-replica rows scaled down on mobile.

**Architecture:** All web-only presentation changes in `apps/web`. The claim modal is a new client component gated on `location.hash === "#claim"` AND `accountStatus.kind === "unlinked"`, built on the existing `useModalBehavior`. `AccountPanels` keeps its mount (verified control panel + always-on `VerificationAnnouncer`) but renders nothing visible for unlinked/pending and owns its own padding so no empty padded wrapper can reappear.

**Tech Stack:** Next.js App Router, React 19, Tailwind, TanStack Query, Vitest + RTL (jsdom).

**Spec:** `docs/superpowers/specs/2026-07-29-home-consistency-claim-modal-design.md`

## Global Constraints

- Beat order everywhere: Hero → Rules → JoinServers → CtaSlab → Fallen. Pending skips CtaSlab.
- JoinServers closing line is ALWAYS, verbatim: `Play first, claim later — your life is tracked from your first spawn.` (em dash). No `closing` prop.
- Modal opens ONLY for `unlinked` + `#claim`. Pending keeps `#claim` as a scroll anchor on `PendingHero`.
- Overlays live at z-50 (LAYER LEGEND); a `useModalBehavior` panel MUST carry `tabIndex={-1}`.
- `red-deep` is a light-surface token: legal inside paper tickets, never on the dark hero surface itself.
- Loading/error must never render as an authoritative empty (live-data honesty).
- Run web tests from repo root: `pnpm --filter @onelife/web run test -- <file>` (vitest). Typecheck: `pnpm turbo run typecheck`.
- Working branch: `feature/home-consistency-claim-modal` (already created; spec committed).

---

### Task 1: JoinServers — delete `closing`, scale replica rows

**Files:**
- Modify: `apps/web/src/components/front-page/join-servers.tsx`
- Modify: `apps/web/src/components/front-page/join-servers.test.tsx`
- Modify: `apps/web/src/components/front-page/pending-support.tsx` (drop the `closing` pass-through — it won't compile otherwise)
- Modify: `apps/web/src/components/front-page/pending-support.test.tsx` (the closing-variant test inverts)

**Interfaces:**
- Produces: `JoinServers` takes NO props: `export function JoinServers()`.

- [ ] **Step 1: Update the tests to pin the single closing line**

In `join-servers.test.tsx`, replace the test at ~line 52 (`"closing line defaults to the play-first promise and accepts an override"`) with:

```tsx
it("closing line is always the play-first promise — no per-surface variant exists", () => {
  render(<JoinServers />);
  expect(
    screen.getByText("Play first, claim later — your life is tracked from your first spawn."),
  ).toBeInTheDocument();
});

it("host rows scale down below md so long host names fit a phone", () => {
  render(<JoinServers />);
  const rows = screen.getAllByRole("listitem").filter((li) => li.textContent?.includes("dayzonelife.com"));
  expect(rows.length).toBe(3);
  for (const row of rows) {
    expect(row.className).toContain("text-[11px]");
    expect(row.className).toContain("md:text-[13px]");
  }
});
```

Note: `getAllByRole("listitem")` also matches the three STEP tickets, hence the `dayzonelife.com` filter.

In `pending-support.test.tsx`, replace the test `"pending: the closing line is the emote variant, not the cold promise"` with:

```tsx
it("pending: the closing line is the universal play-first promise", () => {
  mockStatus.mockReturnValue({ kind: "pending", link: { gamertag: "X" } });
  render(<PendingSupport obits={[obit]} />);
  expect(
    screen.getByText("Play first, claim later — your life is tracked from your first spawn."),
  ).toBeInTheDocument();
  expect(screen.queryByText("Any server counts for your emotes.")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @onelife/web run test -- src/components/front-page/join-servers.test.tsx src/components/front-page/pending-support.test.tsx`
Expected: FAIL — the row-scale test (no `text-[11px]`) and the pending closing test ("Any server counts" still renders).

- [ ] **Step 3: Implement**

In `join-servers.tsx`:
- Change the component signature to `export function JoinServers() {` and inline the string: the closing `<p>` renders `Play first, claim later — your life is tracked from your first spawn.` directly. Delete the props type and the `closing` doc comment; update the header comment's "`closing` is the ONLY per-surface variation" line to say the slab is identical on every surface.
- In `BrowserReplica`, the host `<li>` className changes `font-mono text-[13px]` → `font-mono text-[11px] md:text-[13px]`. Touch nothing else in the replica.

In `pending-support.tsx`: `<JoinServers closing="Any server counts for your emotes." />` → `<JoinServers />`, and update the header comment (no more emote-variant closing).

- [ ] **Step 4: Run the same tests to verify they pass**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/front-page/join-servers.tsx apps/web/src/components/front-page/join-servers.test.tsx apps/web/src/components/front-page/pending-support.tsx apps/web/src/components/front-page/pending-support.test.tsx
git commit -m "feat(web): universal JoinServers closing line + mobile replica rows"
```

---

### Task 2: Reorder the beats — cold, unlinked, pending

**Files:**
- Modify: `apps/web/src/app/(site)/(boxed)/page.tsx` (cold branch order only)
- Modify: `apps/web/src/components/front-page/unverified-pitch.tsx`
- Modify: `apps/web/src/components/front-page/unverified-pitch.test.tsx`
- Modify: `apps/web/src/components/front-page/pending-support.test.tsx` (order assertion extended)

**Interfaces:**
- Consumes: `JoinServers` prop-less (Task 1).
- Produces: beat order Hero → Rules → JoinServers → CtaSlab → Fallen (pending: Rules → JoinServers → Fallen).

- [ ] **Step 1: Update the order tests**

In `unverified-pitch.test.tsx`, replace the test `"unlinked: Join the servers renders AFTER the CTA slab, and no 'How to connect' landmark ships from here"` with:

```tsx
it("unlinked: Rules → Join → CTA slab → Fallen, in that order; no 'How to connect' landmark", () => {
  mockStatus.mockReturnValue({ kind: "unlinked" });
  render(<UnverifiedPitch {...props} obits={[obit]} />);
  const rules = screen.getByText("Death is real");
  const join = screen.getByRole("heading", { level: 2, name: "Join the servers" });
  const cta = screen.getByRole("heading", { name: /Claim it/i });
  const fallen = screen.getByRole("region", { name: "Recent obituaries" });
  expect(rules.compareDocumentPosition(join) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(join.compareDocumentPosition(cta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(cta.compareDocumentPosition(fallen) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.queryByRole("region", { name: "How to connect" })).not.toBeInTheDocument();
});
```

Add an `obit` fixture to this file (copy the one from `pending-support.test.tsx`):

```tsx
import type { ObituaryCard } from "@/lib/types";
const obit: ObituaryCard = {
  slug: "x-dies", headline: "X Dies", lede: "He did.", gamertag: "X",
  map: "chernarusplus", timeAliveSeconds: 3600,
} as ObituaryCard;
```

`pending-support.test.tsx`'s existing order test (`rules → join → fallen`) already matches the new pending order — leave it.

- [ ] **Step 2: Run to verify the new test fails**

Run: `pnpm --filter @onelife/web run test -- src/components/front-page/unverified-pitch.test.tsx`
Expected: FAIL — today Fallen renders before CtaSlab and JoinServers renders after it.

- [ ] **Step 3: Reorder the components**

`unverified-pitch.tsx` return becomes:

```tsx
return (
  <>
    <Hero stats={stats} audience="unverified" />
    <Rules />
    <JoinServers />
    <CtaSlab audience="unverified" />
    <Fallen rows={obits} />
  </>
);
```

`page.tsx` cold branch becomes (comment on Fallen stays):

```tsx
{!signedIn && (
  <>
    <Hero stats={stats.data} />
    <Rules />
    <JoinServers />
    <CtaSlab />
    {/* Failed OR empty → [] → Fallen renders nothing (absent proof is silence). */}
    <Fallen rows={obits.data?.rows ?? []} />
  </>
)}
```

`pending-support.tsx` order is already Rules → JoinServers → Fallen — unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @onelife/web run test -- src/components/front-page/unverified-pitch.test.tsx src/components/front-page/pending-support.test.tsx src/components/front-page/front-page.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/\(site\)/\(boxed\)/page.tsx apps/web/src/components/front-page/unverified-pitch.tsx apps/web/src/components/front-page/unverified-pitch.test.tsx apps/web/src/components/front-page/pending-support.test.tsx
git commit -m "feat(web): one beat rhythm for cold/unlinked/pending home"
```

---

### Task 3: The ClaimModal component

**Files:**
- Create: `apps/web/src/components/account/claim-modal.tsx`
- Create: `apps/web/src/components/account/claim-modal.test.tsx`

**Interfaces:**
- Consumes: `useAccountStatus()` (`@/lib/use-account-status`), `useControlsActions()` (`@/components/account/use-controls` — `a.claim.mutate({ gamertag })`, `a.claim.isPending`, `a.claim.isError`, `a.claim.error`), `LinkTagPanel` (`@/components/account/link-panel` — props `{ onClaim, pending, error }`), `useModalBehavior(open, onClose)` (`@/lib/use-modal-behavior`), `claimErrorMessage` (`@/lib/claim-error`).
- Produces: `export function ClaimModal(): ReactNode` — self-contained, no props. Task 4 mounts it.

- [ ] **Step 1: Write the failing tests**

`claim-modal.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ClaimModal } from "./claim-modal";

const mockStatus = vi.fn();
vi.mock("@/lib/use-account-status", () => ({ useAccountStatus: () => mockStatus() }));

const claimMutate = vi.fn();
vi.mock("@/components/account/use-controls", () => ({
  useControlsActions: () => ({
    claim: { mutate: claimMutate, isPending: false, isError: false, error: null },
  }),
}));

// LinkTagPanel's autocomplete pulls in the api client; the panel's own suite covers it.
vi.mock("@/lib/api", () => ({ searchClaimableGamertags: vi.fn().mockResolvedValue([]) }));

function setHash(hash: string) {
  window.history.replaceState(null, "", `/${hash}`);
}

describe("ClaimModal", () => {
  beforeEach(() => {
    claimMutate.mockClear();
    setHash("");
  });

  it("renders nothing without the #claim hash, even when unlinked", () => {
    mockStatus.mockReturnValue({ kind: "unlinked" });
    const { container } = render(<ClaimModal />);
    expect(container).toBeEmptyDOMElement();
  });

  it("opens as a dialog for unlinked + #claim, focus moving into the panel", () => {
    setHash("#claim");
    mockStatus.mockReturnValue({ kind: "unlinked" });
    render(<ClaimModal />);
    const dialog = screen.getByRole("dialog", { name: "Link your gamertag" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    // useModalBehavior focuses the panel — a silent no-op without tabIndex={-1}.
    expect(dialog).toHaveFocus();
    expect(screen.getByRole("heading", { name: "Link your gamertag." })).toBeInTheDocument();
  });

  it.each(["pending", "verified", "signedOut", "loading"] as const)(
    "never opens for %s — the hash is inert for a claimed or absent identity",
    (kind) => {
      setHash("#claim");
      mockStatus.mockReturnValue(
        kind === "pending" || kind === "verified" ? { kind, link: { id: 1, gamertag: "X" } } : { kind },
      );
      const { container } = render(<ClaimModal />);
      expect(container).toBeEmptyDOMElement();
    },
  );

  it("submitting the form claims the typed gamertag", () => {
    setHash("#claim");
    mockStatus.mockReturnValue({ kind: "unlinked" });
    render(<ClaimModal />);
    fireEvent.change(screen.getByLabelText("Gamertag"), { target: { value: "Boots" } });
    fireEvent.click(screen.getByRole("button", { name: "Claim it" }));
    expect(claimMutate).toHaveBeenCalledWith({ gamertag: "Boots" });
  });

  it("Escape closes the dialog AND clears the hash (so re-clicking the CTA re-opens)", () => {
    setHash("#claim");
    mockStatus.mockReturnValue({ kind: "unlinked" });
    render(<ClaimModal />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(window.location.hash).toBe("");
  });

  it("the ✕ button and the backdrop both close it", () => {
    setHash("#claim");
    mockStatus.mockReturnValue({ kind: "unlinked" });
    render(<ClaimModal />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @onelife/web run test -- src/components/account/claim-modal.test.tsx`
Expected: FAIL — module `./claim-modal` does not exist.

- [ ] **Step 3: Implement `claim-modal.tsx`**

```tsx
"use client";
import { useEffect, useState } from "react";
import { useAccountStatus } from "@/lib/use-account-status";
import { useControlsActions } from "@/components/account/use-controls";
import { useModalBehavior } from "@/lib/use-modal-behavior";
import { claimErrorMessage } from "@/lib/claim-error";
import { LinkTagPanel } from "@/components/account/link-panel";

/**
 * The claim ladder as a dialog (home-consistency spec §3). Hash-driven: every trigger (hero CTA,
 * CTA slab, masthead "Claim your gamertag →") is a plain link to /#claim, so the modal works
 * from any page by navigation and needs no shared open state. Opens ONLY for `unlinked` — the
 * hash is inert for pending (where #claim is the PendingHero scroll anchor) and everyone else.
 *
 * Dismissing CLEARS the hash: a hash left behind would swallow the next CTA click (same-hash
 * clicks fire no hashchange) and reopen the modal on refresh.
 *
 * On a successful claim the status flips unlinked → pending and the gate below closes the modal
 * for free; the pending home renders with its hero where the user already is.
 */
export function ClaimModal() {
  const status = useAccountStatus();
  const a = useControlsActions();

  const [hashOpen, setHashOpen] = useState(false);
  useEffect(() => {
    const check = () => setHashOpen(window.location.hash === "#claim");
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, []);

  const open = hashOpen && status.kind === "unlinked";
  const close = () => {
    // replaceState, not `location.hash = ""`: no extra history entry, no scroll jump.
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    setHashOpen(false);
  };
  const panelRef = useModalBehavior(open, close);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Gesture target, not content (map online-sheet precedent): the dialog is aria-modal. */}
      <div aria-hidden="true" onClick={close} className="absolute inset-0 bg-ink/60" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Link your gamertag"
        tabIndex={-1}
        className="relative w-full max-w-md border-2 border-dark-line bg-dark shadow-[0_10px_40px_rgba(0,0,0,.5)]"
      >
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center font-mono text-lg text-cream-muted hover:text-paper"
        >
          ✕
        </button>
        <LinkTagPanel
          pending={a.claim.isPending}
          error={a.claim.isError ? claimErrorMessage(a.claim.error) : null}
          onClaim={(gt) => a.claim.mutate({ gamertag: gt })}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @onelife/web run test -- src/components/account/claim-modal.test.tsx`
Expected: PASS. If the focus assertion fails because `useModalBehavior` focuses before the dialog content settles, assert `expect(document.activeElement).toBe(dialog)` after a `waitFor` — but try the direct assertion first.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/account/claim-modal.tsx apps/web/src/components/account/claim-modal.test.tsx
git commit -m "feat(web): hash-driven claim modal"
```

---

### Task 4: Wire the modal — home mount, PendingHero anchor, masthead href

**Files:**
- Modify: `apps/web/src/app/(site)/(boxed)/page.tsx` (signed-in branch)
- Modify: `apps/web/src/components/front-page/pending-hero.tsx` (`id="claim"` on the section)
- Modify: `apps/web/src/components/front-page/pending-hero.test.tsx`
- Modify: `apps/web/src/components/shell/account-affordance.tsx` (unlinked item → `/#claim`)
- Modify: `apps/web/src/components/shell/account-affordance.test.tsx`
- Modify: `apps/web/src/components/front-page/hero.tsx` + `unverified-pitch.tsx` (comment-only: "#claim" now opens the modal, not a ladder)

**Interfaces:**
- Consumes: `ClaimModal` (Task 3).
- Produces: the signed-in home tree Task 5 relies on (no padded `#claim` wrapper).

- [ ] **Step 1: Update the tests**

`account-affordance.test.tsx` line ~48: change the expectation to

```tsx
expect(screen.getByRole("menuitem", { name: "Claim your gamertag →" })).toHaveAttribute("href", "/#claim");
```

`pending-hero.test.tsx`: inside the live-challenge test at ~line 41 (or a new small test in the same describe), add:

```tsx
test("the hero section carries the #claim anchor — the masthead's Finish verification lands here", () => {
  const { container } = render(
    <PendingHeroView gamertag="Boots" challenge={challenge} now={NOW} onCancel={vi.fn()} onReclaim={vi.fn()} />,
  );
  expect(container.querySelector("section")).toHaveAttribute("id", "claim");
});
```

(Reuse the file's existing `challenge`/`NOW` fixtures — read the top of the file for their names.)

- [ ] **Step 2: Run to verify failures**

Run: `pnpm --filter @onelife/web run test -- src/components/shell/account-affordance.test.tsx src/components/front-page/pending-hero.test.tsx`
Expected: both new assertions FAIL.

- [ ] **Step 3: Implement**

`pending-hero.tsx`: the `<section>` in `PendingHeroView` gains `id="claim"`:

```tsx
<section id="claim" className="border-b-[6px] border-red bg-dark px-6 py-12 text-paper md:px-10 md:py-16">
```

`account-affordance.tsx` unlinked branch: `href="/"` → `href="/#claim"` (the menu item copy is unchanged).

`page.tsx` signed-in branch — the `#claim` wrapper div and its padding go; `ClaimModal` mounts; `AccountPanels` mounts bare (it owns its own padding after Task 5):

```tsx
{signedIn && <UnverifiedPitch stats={stats.data} obits={obits.data?.rows ?? []} />}
{signedIn && (
  <>
    {/* #claim lives on PendingHero's section (pending scroll anchor) and, for unlinked, on the
     * hash-driven ClaimModal — there is no inline claim section anymore. */}
    <PendingHero />
    <ClaimModal />
    <AccountPanels signInFallback={signedIn} />
  </>
)}
{signedIn && <PendingSupport obits={obits.data?.rows ?? []} />}
```

Add `import { ClaimModal } from "@/components/account/claim-modal";` and update the file's header comment (the padded-anchor paragraph is obsolete).

Comment-only edits: `hero.tsx` `PitchAudience` doc ("CTAs point at the claim modal via `#claim`") and `unverified-pitch.tsx` header (CTAs open the modal; pending paragraph now says the challenge hero carries the anchor).

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @onelife/web run test -- src/components/shell/account-affordance.test.tsx src/components/front-page/pending-hero.test.tsx src/components/front-page/front-page.test.tsx`
Expected: PASS. (`AccountPanels` still renders its unlinked ladder until Task 5 — the page compiles and both claim paths coexist for one commit, which is fine.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/\(site\)/\(boxed\)/page.tsx apps/web/src/components/front-page/pending-hero.tsx apps/web/src/components/front-page/pending-hero.test.tsx apps/web/src/components/shell/account-affordance.tsx apps/web/src/components/shell/account-affordance.test.tsx apps/web/src/components/front-page/hero.tsx apps/web/src/components/front-page/unverified-pitch.tsx
git commit -m "feat(web): mount claim modal; #claim anchors the pending hero"
```

---

### Task 5: AccountPanels cleanup — no inline ladder, no sign-out bar

**Files:**
- Modify: `apps/web/src/components/account/account-panels.tsx`
- Modify: `apps/web/src/components/account/account-panels-pending.test.tsx`
- Modify: `apps/web/src/components/account/three-modes.test.tsx` (delete the `LadderFrame` describe + import)
- Delete: `apps/web/src/components/account/ladder-frame.tsx`, `apps/web/src/components/account/ladder.ts`, `apps/web/src/components/account/ladder.test.ts`

**Interfaces:**
- Consumes: nothing new. The masthead `AccountAffordance` (unchanged) satisfies "an unlinked/pending user can always log out."
- Produces: `AccountPanels` renders NOTHING VISIBLE and NO PADDING for unlinked/pending — only the sr-only `VerificationAnnouncer`. Verified/loading/fallback render padded (`px-6 py-8 md:px-10`).

- [ ] **Step 1: Update the pending test**

In `account-panels-pending.test.tsx`, replace the body of the main test with:

```tsx
test("stays mounted for the announcer, but renders no visible body, no sign-out, no padding", () => {
  getAvatar.mockResolvedValue({ hash: null });
  wrap(<AccountPanels />);

  const section = screen.getByLabelText("Your account");
  // VerificationAnnouncer must survive the pending -> verified swap.
  expect(screen.getByRole("status")).toBeInTheDocument();

  // The white-bar bug: an inline Sign out (masthead owns it now) or padding on an otherwise
  // sr-only section renders as a blank paper strip between the hero and the Rules.
  expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  expect(section.className).not.toContain("py-8");
  expect(screen.queryByRole("heading")).toBeNull();
  expect(screen.queryByRole("list")).toBeNull();
  expect(screen.queryByText(/Prove it's you/i)).toBeNull();
});
```

Add a sibling test in the same file for unlinked (reuse the mock shape, `status: { kind: "unlinked" }`, `name: null`):

```tsx
test("unlinked also renders no visible body — the claim modal owns the form now", () => {
  getAvatar.mockResolvedValue({ hash: null });
  mockKind("unlinked");
  wrap(<AccountPanels />);
  expect(screen.queryByRole("heading", { name: /Link your gamertag/i })).toBeNull();
  expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
});
```

The file's `useControls` mock is static — refactor it to read from a `mockKind`-style `vi.fn()` (same pattern as `mockStatus` in `unverified-pitch.test.tsx`) so both tests can set the kind.

- [ ] **Step 2: Run to verify failures**

Run: `pnpm --filter @onelife/web run test -- src/components/account/account-panels-pending.test.tsx`
Expected: FAIL — Sign out still renders; unlinked still renders the ladder heading.

- [ ] **Step 3: Implement**

In `account-panels.tsx`:
- Delete `SignedInFooter` and the `showFooter` line + render.
- Delete the entire `unlinked` branch body — `unlinked`, like `pending`, sets `body = null`. Update the pending branch comment to cover both (claim modal owns unlinked; PendingHero owns pending).
- Remove now-unused imports: `signOutAndTeardownPush`, `claimErrorMessage`, `IdentityRow`, `LinkTagPanel`, `LadderFrame`, `HowToConnect` (keep `serversView` — the verified branch uses it). Remove the `avatar` query + `getAvatar` import if `IdentityRow` was its only consumer (it is — verify with grep before deleting).
- Padding moves in: the section becomes

```tsx
return (
  <section
    aria-label="Your account"
    className={cn("flex flex-col gap-4", body != null && "px-6 py-8 md:px-10")}
  >
    <VerificationAnnouncer kind={c.status.kind} />
    {body}
  </section>
);
```

(`import { cn } from "@/lib/utils";`.) The signedOut `signInFallback` early return gets its own padding wrapper: wrap its outer div in `className="px-6 py-8 md:px-10"` (merge into the existing div's classes).

- Delete `ladder-frame.tsx`, `ladder.ts`, `ladder.test.ts` (`git rm`). In `three-modes.test.tsx` delete the `LadderFrame` describe block and its import.
- Grep check before finishing: `grep -rn "LadderFrame\|ladderSteps\|SignedInFooter" apps/web/src` → only `pending-hero.tsx` comment mentions may remain (update its "LadderFrame no longer renders" phrasing to "the ladder chrome is retired").

- [ ] **Step 4: Run the web account suites**

Run: `pnpm --filter @onelife/web run test -- src/components/account`
Expected: PASS (three-modes, pending, use-controls, link-verify-panels, claim-modal all green).

- [ ] **Step 5: Commit**

```bash
git add -A apps/web/src/components/account
git commit -m "feat(web): retire inline ladder + sign-out bar; AccountPanels owns its padding"
```

---

### Task 6: Pending tickets match the Join tickets

**Files:**
- Modify: `apps/web/src/components/front-page/pending-hero.tsx` (`TicketSequence` styling only)
- Modify: `apps/web/src/components/front-page/pending-hero.test.tsx`

**Interfaces:** none — purely visual; sr-only text and the no-pointer rule unchanged.

- [ ] **Step 1: Update the ticket test**

In `pending-hero.test.tsx`, extend the test at ~line 41 (`"three tickets with ordinals; confirmed ticket is stamped, unconfirmed are dashed"`) so every ticket is a paper ticket and only the border style differs:

```tsx
// All tickets are paper — the Join-the-servers ticket language (spec §3b).
for (const item of items) {
  expect(item.className).toContain("bg-paper");
  expect(item.className).toContain("border-ink");
}
expect(items[0]!.textContent).toMatch(/Confirmed/);
expect(items[0]!.className).not.toContain("border-dashed"); // stamped ticket is solid
expect(items[1]!.className).toContain("border-dashed");
expect(items[2]!.className).toContain("border-dashed");
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @onelife/web run test -- src/components/front-page/pending-hero.test.tsx`
Expected: FAIL — unconfirmed tickets today are dark (`border-dark-line`, no `bg-paper`).

- [ ] **Step 3: Restyle `TicketSequence`**

The `<li>` becomes (both states paper, dashed→solid on confirm):

```tsx
className={cn(
  "relative flex min-h-[130px] flex-col items-center justify-center gap-1 border-2 border-ink bg-paper px-4 py-8 text-center text-ink md:min-h-[170px]",
  !confirmed && "border-dashed",
)}
```

Ordinal span: `confirmed ? "text-ink-muted/60" : "text-red-deep"` (keep the rest of its classes). Emote-name span unchanged (`confirmed && "opacity-30"` still dims it under the stamp). The CONFIRMED stamp markup is untouched.

Update the component's RED POLICY comment: `red-deep` never sits on the dark hero surface itself, but the ticket interiors are paper (light) surfaces — same as the Join slab's tickets — so the ordinal's `red-deep` is correct there, not a violation.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @onelife/web run test -- src/components/front-page/pending-hero.test.tsx`
Expected: PASS (including the existing no-`←` pointer test).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/front-page/pending-hero.tsx apps/web/src/components/front-page/pending-hero.test.tsx
git commit -m "feat(web): pending emote tickets adopt the join-ticket language"
```

---

### Task 7: Changelog, full suite, typecheck

**Files:**
- Modify: `CHANGELOG.md` (Unreleased entry)

- [ ] **Step 1: Add the changelog entry**

Under `## [Unreleased]` (create the section if absent, matching the file's existing style):

```markdown
- Home: one beat rhythm for signed-out, unlinked and pending visitors (Hero → Rules → Join the
  servers → claim slab → The Fallen); the gamertag claim is a modal opened from any Link-your-
  gamertag CTA; the stray inline sign-out bar is gone (the masthead avatar menu owns sign-out);
  pending emote tickets match the Join-the-servers tickets; server-browser replica rows scale
  down on phones.
```

- [ ] **Step 2: Full web suite + typecheck**

Run: `pnpm --filter @onelife/web run test` then `pnpm turbo run typecheck`
Expected: all green. Fix any straggler (likely: an orphaned import, or a test elsewhere pinning the old beat order — search `compareDocumentPosition` under `apps/web/src` if one appears).

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog for home consistency + claim modal"
```

---

### Task 8: Browser verification (real Chrome)

jsdom cannot see layout/paint — this repo has shipped green-but-broken twice for that reason. With the dev stack running (`docker compose up -d postgres`, api + web dev servers):

- [ ] Cold home: beat order Hero → Rules → Join → Claim-it → Fallen; replica rows readable at a ~390px viewport (devtools device emulation — real-window resize bottoms out ~500px).
- [ ] Unlinked: same order; hero CTA, slab CTA and masthead menu item each open the modal; ✕ / Escape / backdrop close it and clear the hash; re-clicking the CTA re-opens it; claiming flips the page to the pending home.
- [ ] Pending: no white bar anywhere; PendingHero → Rules → Join → Fallen; masthead "Finish verification" scrolls to the hero; tickets read as paper order-slips, CONFIRMED stamp intact.
- [ ] Modal overlays the masthead correctly (z-50 over z-40) and body scroll locks while open.

No commit — record findings; fix anything broken before the PR.
