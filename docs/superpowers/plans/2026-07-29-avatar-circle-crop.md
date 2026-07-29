# Circle-Cropped Avatars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every avatar on the site a circle, with the shape rule stated exactly once.

**Architecture:** Add the circular treatment to the shared `Avatar` component
(`apps/web/src/components/shared/avatar.tsx`), then collapse the two sites that hand-roll their own
avatar markup (`shell/account-affordance.tsx`, `account/identity-row.tsx`) onto it. `Avatar` gains a
`variant` prop for the dark-surface token swap and a `className` prop for per-call-site overrides.
Display-only — the `sharp` pipeline and the stored bytes are untouched.

**Tech Stack:** Next.js (React 19), TypeScript, Tailwind, `cn` = `twMerge(clsx(...))`, vitest +
React Testing Library + jsdom.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-29-avatar-circle-crop-design.md`. Read it before starting.
- **Working directory:** `/home/acab/worktrees/avatar-circle-crop`, branch `feature/avatar-circle-crop`.
  This is a worktree — do NOT work in `/var/www/dayzonelife.com`, which is the production checkout.
- **`apps/web` only.** Do not touch `apps/api`, the `sharp` pipeline, any package under `packages/`,
  or any migration. No API change, no env var, no migration, no `--rebuild`.
- **Test command:** `pnpm --filter @onelife/web run test`. Single file:
  `pnpm --filter @onelife/web run test -- src/path/to/file.test.tsx`.
- **Typecheck:** `pnpm --filter @onelife/web run typecheck`.
- **Baseline at plan time:** 123 test files, 905 tests, 0 failures. Any failure you did not cause is
  worth reporting rather than fixing.
- **Dark-surface tokens are exact:** `border-dark-edge-bright`, `bg-dark-well`, `text-paper`.
  Paper-surface tokens are exact: `border-hairline`, `bg-bone`, `text-ink-muted`. No raw hexes —
  the repo grep-gates against them.
- **`--red-deep` is a light-surface token only.** Do not introduce it on any dark surface.
- **Commit style:** conventional commits, and every commit message ends with
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Do NOT open the PR.** The final task stops after the changelog entry. The human runs `keel:finish-work`.

---

### Task 1: `Avatar` becomes the shape authority

Adds `rounded-full` to all three branches, plus the `variant` and `className` props that Tasks 2
and 3 depend on. Nothing else changes shape until this lands.

**Files:**
- Modify: `apps/web/src/components/shared/avatar.tsx` (whole file, 47 lines)
- Test: `apps/web/src/components/shared/avatar.test.tsx` (append to existing `describe("Avatar")`)

**Interfaces:**
- Consumes: nothing.
- Produces: `Avatar` with the extended prop type below. Tasks 2 and 3 call it.

```ts
export function Avatar(props: {
  hash: string | null;
  size: number;
  dim?: boolean;
  fallbackInitial?: string;
  variant?: "paper" | "dark";   // default "paper"
  className?: string;           // merged last, wins by Tailwind class group
}): JSX.Element
```

- [ ] **Step 1: Write the failing tests**

Append these four tests inside the existing `describe("Avatar", ...)` block in
`apps/web/src/components/shared/avatar.test.tsx`. Leave the three existing tests untouched.

```tsx
  // ── Shape: one rule, all three branches. ────────────────────────────────
  test("all three branches are circular", () => {
    const img = render(<Avatar hash="abc123" size={48} />).container.querySelector("img")!;
    expect(img.className).toContain("rounded-full");

    const initial = render(<Avatar hash={null} size={48} fallbackInitial="K" />)
      .container.querySelector("span[aria-hidden]")!;
    expect(initial.className).toContain("rounded-full");

    const silhouette = render(<Avatar hash={null} size={48} />)
      .container.querySelector("span[aria-hidden]")!;
    expect(silhouette.className).toContain("rounded-full");
  });

  // ── Two-surface token rule (CLAUDE.md). RTL asserts the DOM, not contrast: ──
  // an unswapped variant renders present, functional and INVISIBLE with the suite
  // green. That is the v0.26.0 failure. This test is the only thing standing in
  // for a human looking at the masthead.
  test("variant=dark swaps the surface tokens on the image ring", () => {
    const img = render(<Avatar hash="abc123" size={36} variant="dark" />)
      .container.querySelector("img")!;
    expect(img.className).toContain("border-dark-edge-bright");
    expect(img.className).not.toContain("border-hairline");
  });

  test("variant=dark swaps the surface tokens on both fallback discs", () => {
    for (const el of [
      render(<Avatar hash={null} size={36} variant="dark" fallbackInitial="K" />)
        .container.querySelector("span[aria-hidden]")!,
      render(<Avatar hash={null} size={36} variant="dark" />)
        .container.querySelector("span[aria-hidden]")!,
    ]) {
      expect(el.className).toContain("border-dark-edge-bright");
      expect(el.className).toContain("bg-dark-well");
      expect(el.className).toContain("text-paper");
      expect(el.className).not.toContain("border-hairline");
      expect(el.className).not.toContain("bg-bone");
      expect(el.className).not.toContain("text-ink-muted");
    }
  });

  // `cn` is twMerge(clsx(...)), which resolves by Tailwind class GROUP rather than
  // appending. A caller-supplied border must REPLACE the component's own, not sit
  // beside it as a competing rule whose winner depends on stylesheet order.
  // Task 2's masthead hover depends on this being true.
  test("a caller className overrides the component's own token in the same group", () => {
    const img = render(<Avatar hash="abc123" size={36} className="border-red" />)
      .container.querySelector("img")!;
    expect(img.className).toContain("border-red");
    expect(img.className).not.toContain("border-hairline");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @onelife/web run test -- src/components/shared/avatar.test.tsx`

Expected: FAIL. The first test fails on `rounded-full` being absent; the `variant` tests fail
because the prop does not exist (TypeScript will also complain); the override test fails because
`border-hairline` is still present.

- [ ] **Step 3: Write the implementation**

Replace the entire contents of `apps/web/src/components/shared/avatar.tsx` with:

```tsx
import { cn } from "@/lib/utils";

export function avatarSrc(hash: string): string {
  return `/api/avatars/${hash}.webp`;
}

/**
 * ⚠️ THIS COMPONENT IS THE ONLY PLACE THE AVATAR SHAPE IS STATED.
 * Every avatar on the site is a circle, with no exceptions — including the 132px life-timeline
 * hero. If you are about to add `rounded-full` (or a border, or a fill) to an avatar at a call
 * site, add a variant here instead. The rule previously lived in three places and they drifted.
 *
 * The circle is a CSS mask over a square 256x256 webp — the `sharp` pipeline is untouched, so the
 * shape is retroactive to every stored avatar and no avatar hash or URL changes. See
 * docs/superpowers/specs/2026-07-29-avatar-circle-crop-design.md §2.
 */
const RING = { paper: "border-hairline", dark: "border-dark-edge-bright" } as const;
const DISC = { paper: "bg-bone text-ink-muted", dark: "bg-dark-well text-paper" } as const;

/** Decorative player avatar. Silhouette is the RESOLVED EMPTY state, not an error. alt="". */
export function Avatar({
  hash,
  size,
  dim = false,
  fallbackInitial,
  variant = "paper",
  className,
}: {
  hash: string | null;
  size: number;
  dim?: boolean;
  /** When provided (and `hash` is null), renders this initial in the disc instead of the
   *  silhouette SVG. The silhouette remains the default fallback for existing call sites. */
  fallbackInitial?: string;
  /** Surface the avatar sits on. `dark` swaps ring/fill/glyph tokens — see the two-surface token
   *  rule in CLAUDE.md. Getting this wrong renders ink-on-dark: present, functional, invisible. */
  variant?: "paper" | "dark";
  /** Merged LAST through `cn` (twMerge), so it overrides the component's own tokens by class
   *  group rather than competing with them. */
  className?: string;
}) {
  const box = { width: size, height: size };
  const disc = cn(
    "flex items-center justify-center rounded-full border",
    RING[variant],
    DISC[variant],
    dim && "opacity-60",
    className,
  );

  if (hash) {
    return (
      <img src={avatarSrc(hash)} alt="" width={size} height={size} loading="lazy" decoding="async"
        style={box}
        className={cn("rounded-full border object-cover", RING[variant],
          dim && "opacity-60 grayscale", className)} />
    );
  }
  if (fallbackInitial) {
    return (
      <span aria-hidden="true" style={box} className={disc}>
        <span className="font-display font-bold uppercase" style={{ fontSize: size * 0.45 }}>
          {fallbackInitial}
        </span>
      </span>
    );
  }
  return (
    <span aria-hidden="true" style={box} className={disc}>
      <svg viewBox="0 0 24 24" width={size * 0.5} height={size * 0.5} fill="currentColor">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" />
      </svg>
    </span>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @onelife/web run test -- src/components/shared/avatar.test.tsx`
Expected: PASS, 8 tests (4 new + 3 existing `Avatar` + 1 `avatarSrc`).

Then confirm the six existing consumers still pass — this is the change that makes them circular:

Run: `pnpm --filter @onelife/web run test -- src/components/survivors/survivor-row.test.tsx src/components/player/player-hero.test.tsx src/components/life/hero.test.tsx`
Expected: PASS, no changes needed. If one fails on an exact-className assertion, update that
assertion to match the new class list — do not remove `rounded-full` to make it pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/shared/avatar.tsx apps/web/src/components/shared/avatar.test.tsx
git commit -m "feat(web): make Avatar circular, add variant and className props

Adds rounded-full to all three branches, a paper/dark surface token
variant, and a className escape hatch merged last through twMerge.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Collapse the masthead affordance onto `Avatar`

The masthead is the **dark** surface and the reason `variant="dark"` exists.

**Files:**
- Modify: `apps/web/src/components/shell/account-affordance.tsx` (imports at :8, button at :91-107)
- Test: `apps/web/src/components/shell/account-affordance.test.tsx` (append one test)

**Interfaces:**
- Consumes: `Avatar` from Task 1, with `variant="dark"` and `className`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe("AccountAffordance", ...)` block. Note the existing file
already mocks `getAvatar` to resolve `{ hash: null }`, so the fallback disc is what renders.

```tsx
  // The masthead is DARK. Rendering through Avatar without variant="dark" produces the
  // paper tokens — ink on dark, i.e. present, functional and invisible (the v0.26.0 bug).
  it("renders the avatar through the shared Avatar on the dark variant", () => {
    mockStatus.mockReturnValue({ kind: "verified", link: { gamertag: "YrJustBad" } });
    const { container } = renderIt();
    const disc = container.querySelector('[aria-hidden="true"]')!;
    expect(disc.className).toContain("rounded-full");
    expect(disc.className).toContain("bg-dark-well");
    expect(disc.className).toContain("text-paper");
    expect(disc.className).not.toContain("bg-bone");
    // The hover state must survive the collapse — it now reaches Avatar via `group`.
    expect(disc.className).toContain("group-hover:border-red");
    expect(container.querySelector("button")!.className).toContain("group");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @onelife/web run test -- src/components/shell/account-affordance.test.tsx`
Expected: FAIL — the current markup is a bare `<span aria-hidden>` with no classes at all, so
`rounded-full` is absent.

- [ ] **Step 3: Write the implementation**

In `apps/web/src/components/shell/account-affordance.tsx`:

Change the import on line 8 from:

```tsx
import { avatarSrc } from "@/components/shared/avatar";
```

to:

```tsx
import { Avatar } from "@/components/shared/avatar";
```

Then replace the `<button>` element and its children (currently lines 91-107) with:

```tsx
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Your account"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="account-menu"
        className="group flex h-9 w-9 items-center justify-center rounded-full"
      >
        <Avatar
          hash={hash}
          size={36}
          fallbackInitial={initial}
          variant="dark"
          className="group-hover:border-red group-hover:text-red"
        />
      </button>
```

What moved and why:
- `overflow-hidden`, `border border-dark-edge-bright`, `bg-dark-well` are gone from the button —
  `Avatar` supplies the ring and fill now.
- `font-display text-sm font-bold uppercase text-paper` are gone — `Avatar`'s disc supplies the
  glyph styling. The initial changes from 14px to `36 * 0.45` = 16.2px, which is the rule every
  other fallback disc already follows (spec §3.3).
- `hover:border-red hover:text-red` moved onto `Avatar` as `group-hover:` variants, with `group`
  added to the button. This is why Task 1's `className` override test matters: the hover border
  must replace `border-dark-edge-bright`, not compete with it.
- `rounded-full` stays on the button so its focus ring follows the circle.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @onelife/web run test -- src/components/shell/account-affordance.test.tsx`
Expected: PASS — the new test plus all existing ones (the menu, Escape, roving focus, sign-out
teardown are all untouched).

Run: `pnpm --filter @onelife/web run typecheck`
Expected: PASS. A failure here most likely means `avatarSrc` is still imported but unused.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/shell/account-affordance.tsx apps/web/src/components/shell/account-affordance.test.tsx
git commit -m "refactor(web): masthead affordance renders through Avatar

Drops the hand-rolled img and initial span for the shared component on
the dark variant. Hover moves to group-hover so it still reaches the ring.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Collapse `IdentityRow` onto `Avatar`, delete `AvatarDisc`

**Files:**
- Modify: `apps/web/src/components/account/identity-row.tsx` (imports at :1-2, `AvatarDisc` at :7-17, conditional at :36-46)
- Test: `apps/web/src/components/account/identity-row.test.tsx` (append one test)

**Interfaces:**
- Consumes: `Avatar` from Task 1 (default `paper` variant).
- Produces: nothing. **`AvatarDisc` is deleted** — it is exported but `IdentityRow` is its only
  consumer, verified by grep across `apps/web/src`.

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe("IdentityRow", ...)` block:

```tsx
  it("renders the avatar through the shared Avatar, circular, on the paper variant", () => {
    const { container, rerender } = render(<IdentityRow name="Rusty" provider="discord" avatarHash="abc123def4567890" />);
    const img = container.querySelector("img")!;
    expect(img.className).toContain("rounded-full");
    expect(img.className).toContain("border-hairline");
    expect(img.className).toContain("flex-none"); // survives the collapse; it sits in a flex row

    rerender(<IdentityRow name="Rusty" provider="discord" avatarHash={null} />);
    const disc = container.querySelector('[aria-hidden="true"]')!;
    expect(disc.className).toContain("rounded-full");
    // Accepted visual change (spec §3.3): the bespoke bg-discord blurple disc is gone.
    expect(disc.className).toContain("bg-bone");
    expect(disc.className).not.toContain("bg-discord");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @onelife/web run test -- src/components/account/identity-row.test.tsx`
Expected: FAIL — the current disc is `bg-discord`, so `bg-bone` is absent.

- [ ] **Step 3: Write the implementation**

In `apps/web/src/components/account/identity-row.tsx`:

Replace lines 1-17 (the imports and the whole `AvatarDisc` function) with:

```tsx
import { Avatar } from "@/components/shared/avatar";
import { initialOf } from "./format";
```

`avatarSrc` is no longer imported — the hand-rolled `<img>` that used it is going. `initialOf` is
still needed.

Then replace the avatar conditional (currently lines 36-46) with:

```tsx
      <Avatar
        hash={avatarHash ?? null}
        size={40}
        fallbackInitial={initialOf(name)}
        className="flex-none"
      />
```

`Avatar` already handles the null case internally, so the ternary and the `AvatarDisc` branch both
disappear. `flex-none` is preserved via `className` because the row is a flex container and the
avatar must not shrink.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @onelife/web run test -- src/components/account/identity-row.test.tsx`
Expected: PASS — the new test plus all four existing ones. The existing "avatar disc is
decorative" test asserts the `[aria-hidden="true"]` element's `textContent` is `"B"`; `Avatar`'s
initial branch nests the letter inside the aria-hidden span, so `textContent` is still `"B"` and
it passes unchanged.

Run: `pnpm --filter @onelife/web run typecheck`
Expected: PASS.

Confirm nothing else imported the deleted export:

Run: `grep -rn "AvatarDisc" apps/web/src`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/account/identity-row.tsx apps/web/src/components/account/identity-row.test.tsx
git commit -m "refactor(web): IdentityRow renders through Avatar, drop AvatarDisc

The bespoke bg-discord disc fired for every provider, not just Discord.
Adopts Avatar's bone disc; the shape rule now lives in one place.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Full verification and changelog

**Files:**
- Modify: `CHANGELOG.md` (repo root)

**Interfaces:**
- Consumes: Tasks 1-3 complete and committed.
- Produces: a branch ready for `keel:finish-work`.

- [ ] **Step 1: Run the full web suite**

Run: `pnpm --filter @onelife/web run test`
Expected: PASS. Baseline was 123 files / 905 tests / 0 failures; this branch adds 6 tests across 3
files, so expect **123 files / 911 tests / 0 failures**. Report any discrepancy rather than
adjusting a test to match.

- [ ] **Step 2: Run the typecheck**

Run: `pnpm --filter @onelife/web run typecheck`
Expected: PASS, no errors.

- [ ] **Step 3: Confirm the blast radius is `apps/web` only**

Run: `git diff --stat origin/main...HEAD`
Expected: only files under `apps/web/src/components/` plus the two `docs/superpowers/` files.
If anything under `apps/api`, `packages/`, or a migration appears, stop and report — the spec
scopes this to `apps/web` only.

- [ ] **Step 4: Confirm the shape rule now lives in exactly one place**

Run: `grep -rn "rounded-full" apps/web/src/components | grep -iv "status\|dot\|ladder-frame\|standing-groups\|online-friends\|timeline"`
Expected: matches in `shared/avatar.tsx` (the three branches) and the focus-ring on
`shell/account-affordance.tsx`'s button — and nowhere else. Any other avatar-related hit means a
site was missed.

- [ ] **Step 5: Add the changelog entry**

keel requires a `CHANGELOG.md` entry on every contribution PR, and it is updated last. Open
`CHANGELOG.md`, find the `## [Unreleased]` section, and add under its `### Changed` heading
(create the heading if the section has none):

```markdown
- Avatars are circular everywhere. The shape now lives only in the shared `Avatar` component; the
  masthead account affordance and the account identity row render through it instead of
  hand-rolling their own markup. Display-only — stored avatars and their URLs are unchanged.
```

Match the surrounding entries' wording and punctuation style; if the existing entries differ from
this phrasing, follow theirs.

- [ ] **Step 6: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog for circular avatars

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Stop**

Do NOT push and do NOT open a PR. Report the final test count, the `git diff --stat` output, and
anything surprising. The human runs `keel:finish-work`.

---

## Deploy note

Web-only, presentation-only. Plain `./deploy/deploy.sh`, **no `--rebuild`**. No migration, no env
var, no worker, no systemd unit.
