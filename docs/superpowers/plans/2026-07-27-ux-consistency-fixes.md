# UX Consistency Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the remaining findings from the 2026-07-27 design/consistency/UX review of the website (findings #5-rest, #6, #7, #8, #9), on branch `feature/ux-consistency-review`.

**Architecture:** All web-only presentation fixes inside `apps/web` — no migration, no API change, no worker, no env var. Each finding is one bite-sized task with its own tests and commit. Two fixes (map blank band, Leaflet attribution) are browser-verified because jsdom cannot observe layout.

**Tech Stack:** Next.js App Router, React 19, Tailwind, vitest + React Testing Library (query by ARIA role), Leaflet (sealed inside `map-canvas.tsx`).

## Decisions already made with the user (do not relitigate)

1. **"The Roster" and "The Wire" are renamed to plain "Friends" and "Notifications".** No kicker compromise — the tabloid page names go away.
2. **Deferred to follow-ups, NOT in this branch:** the top-heavy desktop home layout, and unifying the three map-switcher UI patterns (board pills / masthead dropdown / "All →" link). Do not touch them.
3. **Metres format is `375 m`** — number, non-breaking space, lowercase `m` — via one shared `formatMeters()` helper.
4. **Durations are exempted from CSS `uppercase`** — wrap formatted duration/metre values in a `normal-case` span wherever a parent block uppercases, so a duration always reads `26h 52m` site-wide.

## Global Constraints

- Findings #1–#4 and the Survivors rename are ALREADY FIXED (commits `d44d56d`, `77f9aae`, `27f882e`). Do not redo them.
- Repo-wide invariants that apply to these tasks (from CLAUDE.md):
  - Loading/error is never rendered as an authoritative zero/empty/default (live-data honesty).
  - `--red-deep` is a light-surface token only; dark surfaces (the map shell) use `red`/`red-soft`.
  - Type floors: functional content ≥ 11px; decorative overlines may be 10px only when the info exists elsewhere (`src/type-floor-guard.test.ts` tripwire).
  - Web a11y tests query by ARIA role, not DOM structure.
  - Exactly three z-altitudes (LAYER LEGEND in `header.tsx`); on `/maps` the top bar is the z-40 occupant. Do not add altitudes.
  - Leaflet stays sealed in `map-canvas.tsx`; consumers never receive the map instance.
- Run web tests with `pnpm --filter @onelife/web exec vitest run <file>` (fast, targeted) and the full suite via `pnpm --filter @onelife/web run test` before the final commit of each task. Typecheck: `pnpm --filter @onelife/web exec tsc --noEmit`.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- All paths below are relative to `apps/web/src/` unless they start with `docs/` or `CHANGELOG.md`.

---

### Task 1: `formatMeters()` — metres stop reading as minutes (#6)

**Files:**
- Modify: `components/player/format.ts` (add helper)
- Modify: `components/player/format.test.ts` (new cases)
- Modify: `components/life/hero.tsx:64`
- Modify: `components/life/timeline.tsx:11-13` (the `meters()` local helper)
- Modify: `components/player/standing-card.tsx:53`
- Modify: `components/player/past-life-card.tsx:28,34`
- Modify: `components/player/kill-list.tsx:19`

**Interfaces:**
- Produces: `formatMeters(meters: number): string` in `@/components/player/format` — returns `` `${Math.round(meters)} m` `` (NBSP before the unit). Task 5 (normal-case wraps) relies on this exact output.

- [ ] **Step 1: Write the failing test** — append to `components/player/format.test.ts`:

```ts
describe("formatMeters", () => {
  it("rounds and separates the unit with a non-breaking space", () => {
    expect(formatMeters(374.6)).toBe("375 m");
    expect(formatMeters(2)).toBe("2 m");
  });
});
```

(Add `formatMeters` to the existing import from `./format`.)

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @onelife/web exec vitest run src/components/player/format.test.ts` → FAIL, `formatMeters` is not exported.

- [ ] **Step 3: Implement** — in `components/player/format.ts`, below `formatDuration`:

```ts
/** Kill/hit distances. The gap is the point: a bare `25m` beside `26h 52m` reads as minutes.
 *  NBSP so the number never wraps away from its unit. */
export function formatMeters(meters: number): string {
  return `${Math.round(meters)} m`;
}
```

- [ ] **Step 4: Adopt at every metre render site.** Each site currently reads `` `${Math.round(x)}m` ``:
  - `components/life/hero.tsx:64` → `h.longestKillMeters == null ? "—" : formatMeters(h.longestKillMeters)` (import `formatMeters` alongside the existing `formatDuration` import from `@/components/player/format`).
  - `components/life/timeline.tsx` — replace the body of the local `meters()` helper with `return d == null ? null : formatMeters(d);` and import `formatMeters` from `@/components/player/format`.
  - `components/player/standing-card.tsx:53` → `formatMeters(standing.alive.longestKillMeters)` on the non-null branch.
  - `components/player/past-life-card.tsx:28` → `` ` · ${formatMeters(death.distanceMeters)}` `` and `:34` → `formatMeters(life.longestKillMeters)` on the non-null branch.
  - `components/player/kill-list.tsx:19` → `` ` · ${formatMeters(k.distanceMeters)}` `` on the non-null branch.

  ⚠️ Do NOT touch `components/life/track-marker-list.tsx:11` — that `${Math.round(seconds / 60)}m` is *minutes* (staleness), not metres.

- [ ] **Step 5: Fix broken string assertions.** `grep -rn '}m' apps/web/src --include='*.test.tsx' --include='*.test.ts'` and update any test asserting the old `375m` shape (expect failures in `hero.test.tsx`, `timeline.test.tsx`, `standing-card.test.tsx`, `past-life-card.test.tsx`, `kill-list.test.tsx`). Use ` ` in the expected strings.

- [ ] **Step 6: Run the touched test files, then the full web suite** — all green.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/player/ apps/web/src/components/life/
git commit -m "fix(web): metres stop reading as minutes — shared formatMeters with a real gap"
```

---

### Task 2: Plain-word page names — The Roster → Friends, The Wire → Notifications (#5)

**Files:**
- Modify: `app/(site)/(boxed)/friends/page.tsx` (metadata `title` and `<PageHeader title>` both `"The Roster"` → `"Friends"`)
- Modify: `components/notifications/inbox.tsx:66` (`<h1>The Wire</h1>` → `<h1>Notifications</h1>`)
- Test: `components/notifications/inbox` has no test file; the friends page has none either — assert through the existing suites that render them if any break, plus one new H1 assertion (below).

**Interfaces:** none — string-only change; component names (`Roster`, `NotificationsInbox`) deliberately keep their internal names.

- [ ] **Step 1: Grep for stragglers** — `grep -rni "the roster\|the wire" apps/web/src --include='*.tsx' --include='*.ts'`. Expected hits: the two files above only (`page-header.test.tsx` uses "Leaderboard" as an arbitrary prop string — leave it).

- [ ] **Step 2: Make the two renames.** Keep the inbox strapline ("Everything that happened to you, on the record.") — flavor copy under an orienting title is fine; the *title* was the problem.

- [ ] **Step 3: Add an H1 pin** so the rename can't silently revert. Create `components/notifications/inbox-title.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/use-notifications", () => ({
  useNotifications: () => ({ data: { items: [], total: 0, page: 1, pageSize: 25 }, isPending: false, isError: false }),
  useNotificationSeen: () => ({ markRead: vi.fn() }),
}));
vi.mock("@/lib/use-account-status", () => ({
  useAccountStatus: () => ({ kind: "verified", link: { gamertag: "Steve" } }),
}));

import { NotificationsInbox } from "./inbox";

describe("NotificationsInbox title", () => {
  it("is named by the nav word, not a tabloid alias", () => {
    render(<NotificationsInbox />);
    expect(screen.getByRole("heading", { level: 1, name: "Notifications" })).toBeInTheDocument();
  });
});
```

⚠️ Before writing this test, read `components/notifications/inbox.tsx`'s imports and mirror whatever hooks it actually consumes — the mock list above is indicative; the real component may take different hooks (e.g. a `PushToggle` child needing its own mock). Copy the mocking pattern from `components/notifications/list.test.tsx`.

- [ ] **Step 4: Run** the new test + full web suite → green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/\(site\)/\(boxed\)/friends/page.tsx apps/web/src/components/notifications/
git commit -m "fix(web): one name per destination — Friends and Notifications lose their tabloid aliases"
```

---

### Task 3: Timeline time labels stop reading as minutes:seconds (#9)

**Files:**
- Modify: `lib/life-timeline.ts:21-26` (`elapsedLabel`) and `:98` (the hardcoded birth `timeLabel: "00:00"`)
- Test: `lib/life-timeline.test.ts` (update label expectations)

**Interfaces:**
- Produces: `TimelineEvent.timeLabel` now reads `"46h 06m in"` style (birth: `"0h 00m"`). Task 5 does NOT need to wrap these — `timeline.tsx:34` renders `timeLabel` with no `uppercase` class.

- [ ] **Step 1: Update the failing expectations first.** In `lib/life-timeline.test.ts`, find assertions on `timeLabel` (grep `timeLabel` in the file). Change expected values from the `"46:06 IN"` shape to `"46h 06m in"` and birth from `"00:00"` to `"0h 00m"`. Run → FAIL against current code.

- [ ] **Step 2: Implement** in `lib/life-timeline.ts`:

```ts
function elapsedLabel(at: Date, startedAt: Date): string {
  const sec = Math.max(0, Math.floor((at.getTime() - startedAt.getTime()) / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  // `46:06` read as minutes:seconds. The h/m units make the format self-describing —
  // and match formatDuration's vocabulary everywhere else on the site.
  return `${h}h ${String(m).padStart(2, "0")}m`;
}
```

and at the two label sites: `` const label = (at: Date) => `${elapsedLabel(at, startedAt)} in`; `` (lowercase "in" — the column has no `uppercase` class, and shouting IN was part of the ambiguity), and the birth event's `timeLabel: "0h 00m"`.

- [ ] **Step 3: Run** `lib/life-timeline.test.ts` + `components/life/timeline.test.tsx` (may assert rendered labels) → green. Full suite.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/life-timeline.ts apps/web/src/lib/life-timeline.test.ts apps/web/src/components/life/
git commit -m "fix(web): timeline time labels say 46h 06m, not a bare 46:06 that reads as min:sec"
```

---

### Task 4: `/you` identity row shows the real avatar (#7)

**Files:**
- Modify: `components/account/identity-row.tsx` (new optional `avatarHash` prop)
- Modify: `components/account/you-panel.tsx` (fetch + pass the hash)
- Modify: `components/account/account-panels.tsx:102,122` (pass the hash on Home too — same split exists there)
- Test: `components/account/identity-row.test.tsx`

**Interfaces:**
- Consumes: `avatarSrc(hash)` from `@/components/shared/avatar`; `getAvatar` from `@/lib/api`; the shared `["avatar"]` query key (one source of truth for the session's own hash — see the comment in `avatar-panel.tsx:22`).
- Produces: `IdentityRow({ name, provider, tagLine?, verified?, avatarHash? })` — `avatarHash?: string | null | undefined`; `undefined`/`null` falls back to the lettered disc.

- [ ] **Step 1: Write the failing test** — append to `components/account/identity-row.test.tsx` (match its existing render style):

```tsx
it("renders the real avatar when a hash is present, lettered disc otherwise", () => {
  const { container, rerender } = render(<IdentityRow name="Rusty" provider="discord" avatarHash="abc123def4567890" />);
  const img = container.querySelector("img");
  expect(img).not.toBeNull();
  expect(img!.getAttribute("src")).toBe("/api/avatars/abc123def4567890.webp");
  // Decorative: the letter disc it replaces was aria-hidden; the image stays out of the a11y tree too.
  expect(img!.getAttribute("alt")).toBe("");

  rerender(<IdentityRow name="Rusty" provider="discord" avatarHash={null} />);
  expect(container.querySelector("img")).toBeNull();
  expect(container.textContent).toContain("R"); // the lettered fallback
});
```

- [ ] **Step 2: Run → FAIL** (no `img` rendered for a hash).

- [ ] **Step 3: Implement** in `identity-row.tsx` — add the prop and branch where `<AvatarDisc>` renders:

```tsx
import { avatarSrc } from "@/components/shared/avatar";
// ...
export function IdentityRow({ name, provider, tagLine, verified = false, avatarHash }: {
  name: string; provider: string | null; tagLine?: string | null; verified?: boolean;
  avatarHash?: string | null;
}) {
  // ...
  {avatarHash ? (
    <img src={avatarSrc(avatarHash)} alt="" width={40} height={40}
      className="h-10 w-10 flex-none rounded-full border border-hairline object-cover" />
  ) : (
    <AvatarDisc name={name} />
  )}
```

Update the stale file-top comment (it currently says this component *never* renders the login avatar — after this change it renders it with the disc as fallback).

- [ ] **Step 4: Wire the hash in both containers** (both are already client components):
  - `you-panel.tsx`: `const avatar = useQuery({ queryKey: ["avatar"], queryFn: getAvatar });` (imports: `useQuery` from `@tanstack/react-query`, `getAvatar` from `@/lib/api`) and pass `avatarHash={avatar.data?.hash ?? null}` to `<IdentityRow>`. The `["avatar"]` key is already populated by `AvatarPanel` on the same page — this is a cache read, not a second fetch.
  - `account-panels.tsx`: same query, `enabled` gated the same way the file gates its other signed-in queries (find the pattern at the top of the component — do not fetch for signed-out visitors), and pass `avatarHash` at lines 102 and 122.

  Containers are thin and untested by convention — the prop plumbing needs no new container test, but run `you-panel.test.tsx` / `account-panels`' suite (`three-modes.test.tsx`) to catch signature breaks.

- [ ] **Step 5: Run** touched tests + full suite → green.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/account/
git commit -m "fix(web): identity row renders your real avatar — one identity, one picture"
```

---

### Task 5: Durations (and metres) exempted from CSS uppercase (#9)

**Files:**
- Modify: `components/account/home-sidebar.tsx:52`
- Modify: `components/player/past-life-card.tsx:15,28,34`
- Modify: `components/player/standing-card.tsx:15-17` (the `sub` string becomes JSX)
- Test: `components/account/home-sidebar.test.tsx` (or the file's existing test), `components/player/past-life-card.test.tsx`, `components/player/standing-card.test.tsx`

**Interfaces:** none new — pure render change. Rule being applied: **a `formatDuration`/`formatMeters` value inside a block that carries the `uppercase` class gets wrapped in `<span className="normal-case">`.**

- [ ] **Step 1: Write the failing tests.** One per component, asserting the wrapper class on the value. Example for the sidebar (adapt to each file's existing harness):

```tsx
it("duration values are exempt from the row's uppercase", () => {
  // render a board row with timeAliveSeconds: 96_720 (26h 52m)
  const value = screen.getByText("26h 52m");
  expect(value.className).toContain("normal-case");
});
```

For `past-life-card`: assert on the `lasted` duration and the `longest kill` metre value. For `standing-card`: assert the alive card's `Alive` line duration.

- [ ] **Step 2: Run → FAIL** (no `normal-case` in the tree).

- [ ] **Step 3: Implement site by site:**
  - `home-sidebar.tsx:52`: `<span className="flex-none normal-case tabular-nums">{formatDuration(r.timeAliveSeconds)}</span>`
  - `past-life-card.tsx:15`: `… · lasted <span className="normal-case">{formatDuration(life.timeAliveSeconds)}</span>`
  - `past-life-card.tsx:28`: the death-line distance becomes JSX: `{death.distanceMeters != null ? <> · <span className="normal-case">{formatMeters(death.distanceMeters)}</span></> : null}`
  - `past-life-card.tsx:34`: `<span><span className="normal-case">{life.longestKillMeters == null ? "—" : formatMeters(life.longestKillMeters)}</span> longest kill</span>`
  - `standing-card.tsx`: `sub` is currently a template string; convert to JSX so the duration can carry the class:

```tsx
const sub =
  alive && standing.alive ? <>Alive <span className="normal-case">{formatDuration(standing.alive.timeAliveSeconds)}</span></>
  : banned ? "Died — awaiting respawn"
  : "No open life";
```

  (`sub` renders inside a `<p>` — a `ReactNode` drops in without further change. If a test snapshots the string, update it.)
  - Sweep for stragglers: `grep -rn "formatDuration\|formatMeters\|formatRunLength\|banCountdown" apps/web/src/components --include='*.tsx' | grep -v test`, and for each render site check whether an ancestor in the same file carries `uppercase`; wrap any found the same way. Known ones to check: `servers/standing-groups.tsx` (`formatRunLength` at :105 and :144, ban countdowns), `servers/*` sheet rows if any, `kill-list.tsx`, `life/timeline.tsx` kill chips. Do NOT wrap values whose container is not uppercased.

- [ ] **Step 4: Run** touched tests + full suite → green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/
git commit -m "fix(web): durations and distances read 26h 52m / 375 m even inside uppercase blocks"
```

---

### Task 6: Friend request state gets a caption (#9)

**Files:**
- Modify: `components/player/friend-button.tsx` (the `outgoing` and `incoming` branches)
- Test: `components/player/friend-button.test.tsx`

**Interfaces:** none — presentational branch change inside the existing props-only view component.

- [ ] **Step 1: Write the failing tests** (match the file's existing render harness for the view component):

```tsx
it("outgoing: names the state, not just the escape hatch", () => {
  render(<FriendButtonView status="outgoing" onRemove={vi.fn()} /* …existing required props… */ />);
  expect(screen.getByText("Friend request sent")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Cancel request" })).toBeInTheDocument();
});

it("incoming: names the state above Accept/Decline", () => {
  render(<FriendButtonView status="incoming" /* … */ />);
  expect(screen.getByText("Friend request received")).toBeInTheDocument();
});
```

⚠️ Read the test file first for the view component's actual name and required props — the review only saw the rendered page; the component may be internal (`FriendActions` etc. — it lives around `friend-button.tsx:50-75`).

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement.** In the `outgoing` branch (`friend-button.tsx:67-70`), render a caption above/beside the button:

```tsx
if (p.status === "outgoing") {
  return (
    <div className="flex flex-col items-end gap-1">
      <p className="font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">Friend request sent</p>
      <button type="button" onClick={p.onRemove} disabled={p.pending} className={BTN}>Cancel request</button>
    </div>
  );
}
```

Mirror for `incoming` ("Friend request received" above Accept/Decline), preserving the existing buttons and handlers exactly. Keep the caption at the 11px functional floor, `text-ink-muted` (this is a light surface).

- [ ] **Step 4: Run** `friend-button.test.tsx` + full suite → green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/player/friend-button.tsx apps/web/src/components/player/friend-button.test.tsx
git commit -m "fix(web): friend-request buttons get a state caption — no more bare CANCEL REQUEST"
```

---

### Task 7: Map online-list Share buttons match the site's action casing (#7)

**Files:**
- Modify: `components/map/shell/online-list.tsx:70-82` (both button variants)
- Test: `components/map/shell/online-list-share.test.tsx`

**Interfaces:** none — className-only.

Context: the site's action convention is uppercase mono; these two buttons ("Share", "Sharing · Stop") are the only sentence-case actions left (the `/you` actions were checked during planning and already carry `uppercase`). This is the dark map surface — tokens stay `text-paper`/`text-cream-dim`, never `red-deep`.

- [ ] **Step 1: Write the failing test** — in `online-list-share.test.tsx`, following its existing render setup:

```tsx
it("share buttons carry the uppercase action treatment", () => {
  // render one sharing row and one not-sharing row (the file's existing fixtures)
  for (const btn of screen.getAllByRole("button", { name: /share|sharing · stop/i })) {
    expect(btn.className).toContain("uppercase");
  }
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — add `uppercase tracking-[.05em]` to both buttons' className (lines ~70 and ~79). Text content stays "Share" / "Sharing · Stop" (CSS does the casing; the accessible name is unaffected in RTL's normalizer but the test above matches case-insensitively regardless).

- [ ] **Step 4: Run** the file + full suite → green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/map/shell/online-list.tsx apps/web/src/components/map/shell/online-list-share.test.tsx
git commit -m "fix(web): map share buttons join the uppercase action convention"
```

---

### Task 8: `/login` acknowledges a signed-in visitor (#9)

**Files:**
- Modify: `components/login-panel.tsx`
- Test: Create `components/login-panel.test.tsx`

**Interfaces:**
- Consumes: `useAccountStatus()` from `@/lib/use-account-status` (returns the union `loading|signedOut|unlinked|pending|verified` — see `@/lib/account-status`).
- Produces: unchanged external signature `LoginPanel({ providers, magicLink })`.

Behavior: while `loading` or `signedOut`, render the form exactly as today. In any signed-in state (`unlinked|pending|verified`), render an honest notice instead of sign-in buttons: "You're already signed in." with links Home (`/`) and Your account (`/you`). No redirect — a redirect from a stale link is disorienting and unstateable; a notice is honest and testable.

- [ ] **Step 1: Write the failing test** — `components/login-panel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mockStatus = vi.fn();
vi.mock("@/lib/use-account-status", () => ({ useAccountStatus: () => mockStatus() }));
vi.mock("@/lib/auth-client", () => ({ signIn: { magicLink: vi.fn(), social: vi.fn() } }));

import { LoginPanel } from "./login-panel";

describe("LoginPanel", () => {
  it("signed out: renders the sign-in form", () => {
    mockStatus.mockReturnValue({ kind: "signedOut" });
    render(<LoginPanel providers={["discord"]} magicLink={false} />);
    expect(screen.getByRole("button", { name: /discord/i })).toBeInTheDocument();
  });

  it("signed in: says so instead of offering sign-in again", () => {
    mockStatus.mockReturnValue({ kind: "verified", link: { gamertag: "Steve" } });
    render(<LoginPanel providers={["discord"]} magicLink={false} />);
    expect(screen.getByText(/already signed in/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /discord/i })).toBeNull();
    expect(screen.getByRole("link", { name: /your account/i })).toHaveAttribute("href", "/you");
  });

  it("loading: renders the form (no signed-in flash for anonymous visitors)", () => {
    mockStatus.mockReturnValue({ kind: "loading" });
    render(<LoginPanel providers={["discord"]} magicLink={false} />);
    expect(screen.getByRole("button", { name: /discord/i })).toBeInTheDocument();
  });
});
```

⚠️ Verify the real shape `useAccountStatus` returns (`kind` vs a bare string — read `lib/use-account-status.ts`) and the accessible name `LoginForm` gives the Discord button (read `login-form.tsx`) before finalizing the mocks/queries.

- [ ] **Step 2: Run → FAIL** (signed-in case still renders the form).

- [ ] **Step 3: Implement** in `login-panel.tsx`:

```tsx
"use client";
import Link from "next/link";
import { LoginForm } from "./login-form";
import { signIn } from "@/lib/auth-client";
import { useAccountStatus } from "@/lib/use-account-status";

export function LoginPanel({ providers, magicLink }: { providers: string[]; magicLink: boolean }) {
  const status = useAccountStatus();
  // `loading` deliberately falls through to the form: most /login visitors are signed out, and
  // a skeleton-then-form flash punishes all of them to spare the rare stale-link visitor a flash
  // the notice replaces a moment later anyway.
  if (status.kind !== "loading" && status.kind !== "signedOut") {
    return (
      <div className="border border-dashed border-dash px-4 py-3">
        <p className="font-mono text-xs uppercase tracking-[.04em] text-ink">You&apos;re already signed in.</p>
        <p className="mt-2 font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
          <Link href="/" className="font-bold text-ink underline hover:text-red">Home</Link>
          {" · "}
          <Link href="/you" className="font-bold text-ink underline hover:text-red">Your account</Link>
        </p>
      </div>
    );
  }
  return (
    <LoginForm
      providers={providers}
      magicLink={magicLink}
      onMagicLink={async (email) => { await signIn.magicLink({ email, callbackURL: "/welcome" }); }}
      onSocial={(provider) => { void signIn.social({ provider: provider as "discord" | "google" | "github", callbackURL: "/welcome" }); }}
    />
  );
}
```

(Adjust the status-union access to whatever `useAccountStatus` actually returns.)

- [ ] **Step 4: Run** the new test + full suite → green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/login-panel.tsx apps/web/src/components/login-panel.test.tsx
git commit -m "fix(web): /login tells a signed-in visitor they're signed in instead of pitching sign-in"
```

---

### Task 9: Life-hero snapshot box only renders when there is a picture (#9)

**Files:**
- Modify: `components/life/hero.tsx:42-46`
- Test: `components/life/hero.test.tsx`

**Interfaces:** none — conditional render on the existing `data.avatarHash`.

- [ ] **Step 1: Write the failing test** — in `hero.test.tsx`, using its existing fixtures:

```tsx
it("omits the snapshot box entirely for an avatar-less player", () => {
  // render LifeHero with data.avatarHash: null
  expect(screen.queryByText(/snapshot · this life/i)).toBeNull();
});

it("renders the snapshot box when a hash exists", () => {
  // render LifeHero with data.avatarHash: "abc123def4567890"
  expect(screen.getByText(/snapshot · this life/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run → FAIL** (caption currently renders unconditionally over the silhouette).

- [ ] **Step 3: Implement** — wrap the portrait column:

```tsx
{data.avatarHash != null && (
  <div className="w-[132px] flex-none">
    <Avatar hash={data.avatarHash} size={132} dim={!view.alive} />
    <p className="mt-2 text-center font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">Snapshot · this life</p>
  </div>
)}
```

The empty-frame-with-caption promised something that wasn't there; with no hash the text column simply takes the full width (the parent is already `flex-col sm:flex-row`, no other change needed). This does not violate live-data honesty: `avatarHash: null` is a RESOLVED empty (the payload arrived), not a loading state.

- [ ] **Step 4: Run** `hero.test.tsx` + full suite → green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/life/hero.tsx apps/web/src/components/life/hero.test.tsx
git commit -m "fix(web): life hero drops the empty snapshot frame for avatar-less players"
```

---

### Task 10: Map first-load blank band — container-resize invalidation (#8)

**Files:**
- Modify: `components/map/map-canvas.tsx` (Effect 1, after map creation)
- Test: `components/map/map-canvas-view.test.tsx` (limited — see below); real proof is the browser pass in Task 12.

**Interfaces:** none — internal to the sealed Leaflet lifecycle.

**Diagnosis to verify first:** `applyWorldBounds()` already runs before the first draw (`map-canvas.tsx:363-366`) — the ordering rule is honoured. The suspect is different: Leaflet measures the container ONCE at creation, and `m.on("resize", …)` is Leaflet's own event, which fires on **window** resizes only. `/maps/[map]` is a full-viewport flex column whose map region's height settles after fonts/bars mount — a **container** resize with no window resize, which Leaflet never notices. The map keeps its stale (shorter) measurement: tiles and `fitBounds` cover the old height, and the freshly-revealed bottom strip stays blank until the first interaction forces a re-measure. The fix is a `ResizeObserver` on the container calling `invalidateSize()` — which fires Leaflet's `resize` event, so the existing `applyWorldBounds` re-run comes for free.

- [ ] **Step 1: Reproduce/confirm the diagnosis in code.** Read Effect 1 top to bottom; confirm there is no `ResizeObserver`/`invalidateSize` anywhere in the file (`grep -n "invalidateSize\|ResizeObserver" apps/web/src/components/map/map-canvas.tsx`). If one already exists, stop and re-diagnose against the browser symptom instead of stacking a second observer.

- [ ] **Step 2: Implement** — inside the `.then((mod) => { … })` block after `runFocus()`:

```ts
// Leaflet measures the container once at creation and its own `resize` event only fires
// on WINDOW resizes — but this container's size settles after creation (full-viewport
// flex column: bars/fonts mount late), and on that container-only resize Leaflet keeps
// the stale measurement: the freshly revealed strip stays blank until the first
// interaction forces a re-measure (the v0.51.x first-load blank band). invalidateSize()
// re-measures AND fires Leaflet's `resize`, so the applyWorldBounds re-run above comes
// for free on the same tick.
if (typeof ResizeObserver !== "undefined" && ref.current) {
  const ro = new ResizeObserver(() => { mapRef.current?.invalidateSize(); });
  ro.observe(ref.current);
  resizeObserverRef.current = ro;
}
```

with `const resizeObserverRef = useRef<ResizeObserver | null>(null);` alongside the other refs, and in Effect 1's cleanup (next to the existing map teardown):

```ts
resizeObserverRef.current?.disconnect();
resizeObserverRef.current = null;
```

If the `LeafletMap` type in this file lacks `invalidateSize`, add it to the local type declarations the file already maintains (`invalidateSize(): void;`).

- [ ] **Step 3: jsdom-level guard.** jsdom has no ResizeObserver and no layout — the `typeof` guard above keeps every existing map test green. Run `map-canvas-view.test.tsx`, `friends-map.test.tsx`, `map-page.test.tsx` → green. (No new jsdom test can prove the fix; it is on the Task 12 browser checklist.)

- [ ] **Step 4: Typecheck + full suite → green.**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/map/map-canvas.tsx
git commit -m "fix(web): map re-measures on container resize — kills the first-load blank band"
```

---

### Task 11: Leaflet attribution stops hiding under the map controls (#8)

**Files:**
- Modify: `components/map/map-page.tsx` (add a scoping class on the map region wrapper)
- Modify: `app/globals.css` (scoped attribution offset + dark treatment)
- Test: browser-only (Task 12); one class-presence pin in `components/map/map-page.test.tsx`.

**Interfaces:** none.

Context: on `/maps/[map]`, `LocateButton` + `FriendsPanel` overlay the map's bottom-right (`map-page.tsx:247`, `absolute bottom-3 right-3 z-10`) and the grid chip sits bottom-left (`:228`) — exactly over Leaflet's default bottom-right attribution control, which also gets clipped by the map edge. The attribution must stay (vendored license text, deliberately not suppressed — `map-canvas.tsx:29-32`), so give it clearance INSIDE the corner Leaflet owns. Scope the CSS so the life-trail `TrackMap` panel (no overlaid controls) keeps Leaflet's default placement.

- [ ] **Step 1: Add the scope class.** In `map-page.tsx`, on the element that wraps `<FriendsMap …>` and the overlay controls (the `relative` map-region container), add the class `map-app`.

- [ ] **Step 2: Add the scoped CSS** in `app/globals.css`, next to the existing Leaflet overrides (`.leaflet-tooltip.friend-label`, the coarse-pointer zoom-button scaling):

```css
/* /maps only: the Locate/Online cluster overlays the map's bottom-right corner
 * (map-page.tsx `bottom-3 right-3`), directly over Leaflet's default attribution,
 * and the map edge clips it. Lift the whole bottom control corner clear of the
 * cluster and restyle the pill for the dark shell. The life-trail TrackMap has no
 * overlaid controls, so this is scoped to .map-app rather than global. */
.map-app .leaflet-bottom.leaflet-right {
  margin-bottom: 3.5rem; /* clears the 44px control cluster + its bottom-3 inset */
}
.map-app .leaflet-control-attribution {
  background: rgb(var(--dark) / 0.9);
  color: rgb(var(--cream-dim));
  font-size: 10px; /* decorative tier: license text, present verbatim in dzmap.yaml */
}
.map-app .leaflet-control-attribution a {
  color: rgb(var(--paper));
}
```

⚠️ Check the real token names in `globals.css` before writing (`--dark`, `--cream-dim`, `--paper` — the controls dark surface uses the four named `dark-*` tokens; use whichever of those the file actually defines, no raw hexes — that rule is grep-gated).

- [ ] **Step 3: Pin the scope class** so a refactor can't silently drop it — in `map-page.test.tsx`, add to an existing render test:

```tsx
expect(container.querySelector(".map-app")).not.toBeNull();
```

- [ ] **Step 4: Run** `map-page.test.tsx` + full suite → green. (Whether the overlap is actually cleared is browser-verified in Task 12.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/map/map-page.tsx apps/web/src/app/globals.css apps/web/src/components/map/map-page.test.tsx
git commit -m "fix(web): leaflet attribution gets clearance and dark styling under the map controls"
```

---

### Task 12: Changelog, full verification, browser pass

**Files:**
- Modify: `CHANGELOG.md` (Unreleased section — this is the LAST file touched before the PR, per repo convention)

- [ ] **Step 1: Full gate.** `pnpm turbo run test --concurrency=1` (needs `TEST_DATABASE_URL`; web-only changes, but run the whole thing — it's the PR gate) and `pnpm turbo run typecheck`. Both green before proceeding.

- [ ] **Step 2: Browser verification** (jsdom cannot see layout/paint — this is the proof for Tasks 10 and 11, and the spot-check for the rest). Drive real Chrome via claude-in-chrome against `pnpm dev`:
  1. `/maps/chernarusplus` fresh load: no blank band across the bottom of the map region before any interaction.
  2. Same page: attribution pill legible, dark-styled, not under LOCATE/ONLINE, not clipped.
  3. Online panel: Share buttons render uppercase.
  4. `/friends` and `/notifications`: H1s read Friends / Notifications.
  5. A dossier + life timeline: `375 m` metre values, `26h 52m` durations inside uppercase rows, time labels `46h 06m in`.
  6. `/you`: identity row shows the uploaded avatar (requires the signed-in session).
  7. `/login` while signed in: the "already signed in" notice.
  - ⚠️ Known environment limits (from the review session): the user's Chrome runs full-screen, so `resize_window` is ineffective and macOS floors real windows at ~500px — the below-768px pass stays on the outstanding list unless a device-emulation session is available. Do not claim mobile verification without one.
  8. If anything fails, fix it before the changelog — a red browser check is a red gate.

- [ ] **Step 3: Changelog entry** under `## [Unreleased]`:

```markdown
### Fixed

- **A consistency pass over the whole site.** Every page now renders at its intended width
  (a flexbox quirk had each page shrink-wrapping to a random width); the notification bell's
  popover no longer grows taller than the screen; home-sidebar notifications say what happened
  instead of three identical titles; the one leaderboard is called **Survivors** everywhere
  (nav, tab bar, sidebar) instead of three different names — and the Friends and Notifications
  pages likewise drop their "Roster"/"Wire" aliases; kill distances read `375 m` so they can't
  be mistaken for minutes, durations always read `26h 52m` (never `26H 52M`), and timeline
  timestamps say `46h 06m in` instead of an ambiguous `46:06`; the idle server row's "JOIN"
  button — a promise console DayZ can't keep — now honestly says how to connect; your account
  page shows your real avatar in the identity row; friend-request buttons say what state
  they're in; `/login` tells you when you're already signed in; the life page no longer shows
  an empty portrait frame for players without an avatar; and the map fixes its two rough
  edges — a blank band on first load and the tile-license text hiding under the buttons.
```

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog for the UX consistency pass"
```

- [ ] **Step 5: Open the PR** via the `keel:finish-work` skill (it runs the checks and opens the PR against `main` with the required conventions).

---

## Deferred follow-ups (explicitly out of scope, recorded here so they aren't lost)

1. **Top-heavy desktop home** — content ends ~40% down the viewport; needs a real layout design pass, not a fix.
2. **Map-switcher unification** — three patterns for one choice (board pills, `/maps` masthead dropdown, home strip "All →" link); pick one pattern and apply it everywhere, as its own design-scale change.
3. **Below-768px browser pass** — blocked on device emulation or a real handset (full-screen Chrome + macOS ~500px window floor); also still owed by sub-projects B and M1 — named check: the five-tab row including the longer "Survivors" label must fit at 320px (it replaced "Board", whose stated reason for existing was that width).

## Self-review notes

- Spec coverage: #5-rest → Task 2 (+ deferral 2); #6 → Tasks 1, 5; #7 → Tasks 4, 7 (the `/you` action-casing half of #7 was checked during planning — those buttons already carry `uppercase`; no task needed); #8 → Tasks 10, 11 (+ browser proof in 12); #9 → Tasks 3 (timestamps), 6 (friend caption), 8 (login), 9 (snapshot box), 5 (duration casing), deferral 1 (top-heavy home). Already-shipped #1–#4 excluded by design.
- Type consistency: `formatMeters` defined in Task 1 is the same symbol consumed in Task 5; `avatarHash` prop type matches `Avatar`'s `hash: string | null`.
- The two mocks flagged with ⚠️ (Tasks 2, 6, 8) direct the implementer to read the real hook/prop shapes first — indicative code, verified at implementation time, because the plan author confirmed the file locations but not every private prop name.
