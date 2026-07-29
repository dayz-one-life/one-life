# Pending-Verification Hero Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the pending player's home open with a full-bleed dark hero carrying the emote challenge itself, matching the cold/unlinked pitch feel, per `docs/superpowers/specs/2026-07-29-pending-hero-design.md`.

**Architecture:** A new `PendingHero` client component (thin container + props-only `PendingHeroView`) mounts at page level above the padded `#claim` column; `AccountPanels`' pending branch shrinks to announcer + sign-out; `ProveItPanel` and `PendingLead` are absorbed and deleted; `PendingSupport` swaps its bare `HowToConnect` card for a `ConnectSection` copy variant.

**Tech Stack:** Next.js App Router (apps/web), React 19, Tailwind, vitest + React Testing Library (jsdom). No API, DB, or worker changes.

## Global Constraints

- Presentation only: no migration, no new API route, no env var — plain `./deploy/deploy.sh`, no `--rebuild`.
- The batching line is VERBATIM and must survive: "DayZ reports emotes in batches — your progress can take up to 15 minutes to appear here. It does not update in real time."
- No copy anywhere may claim live/instant updates (`/instantly|immediately|watch (this|it) update|updates? live/i` must not match).
- `red-deep` NEVER on the dark hero (light-surface token — RED POLICY in `globals.css`). Yellow is the pending signature for live elements; the hero frame is red.
- Exactly one `h1` on the pending home (the hero's) and exactly one `id="claim"` in the DOM.
- `VerificationAnnouncer` stays an unconditional sibling in `AccountPanels` (outlives pending→verified swap).
- Type floors: functional text ≥11px.
- Run web tests with `pnpm --filter @onelife/web test -- <pattern>`; DB suites are untouched.
- Every commit lands on branch `feature/pending-hero` (already created).

---

### Task 1: `PendingHeroView` + `PendingHero` container

**Files:**
- Create: `apps/web/src/components/front-page/pending-hero.tsx`
- Test: `apps/web/src/components/front-page/pending-hero.test.tsx`

**Interfaces:**
- Consumes: `Challenge` (`@/lib/types`: `{ sequence: string[]; progressIndex: number; expiresAt: string; expired: boolean }`), `formatExpiry(expiresAt: string, now: number): string`, `SkewCta`, `SrStatus`, `FitLine`, `cn`, `useAccountStatus()` (pending shape: `{ kind: "pending", link: { id, gamertag, challenge } }`), `useControlsActions()` (`{ claim, cancel, … }` TanStack mutations; `claim.mutate({ gamertag })`, `cancel.mutate(linkId)`).
- Produces: `PendingHeroView(props)` (exported, unit-tested) and `PendingHero()` (exported container; renders `null` unless `status.kind === "pending"`). Task 2 imports `PendingHero`.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/components/front-page/pending-hero.test.tsx` — this migrates the retired `ProveItPanel` suite's coverage (SR status, batching line, callbacks, walkthrough) onto the hero and adds the hero-specific assertions:

```tsx
import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { PendingHeroView } from "./pending-hero";
import type { Challenge } from "@/lib/types";

// FitLine observes its container with ResizeObserver, which jsdom lacks.
vi.stubGlobal(
  "ResizeObserver",
  vi.fn().mockImplementation(() => ({ observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() })),
);

const NOW = new Date("2026-07-16T12:00:00Z").getTime();

const challenge = (over: Partial<Challenge>): Challenge => ({
  sequence: ["facepalm", "salute", "clap"], progressIndex: 1,
  expiresAt: "2026-07-17T10:10:00Z", expired: false, ...over,
});

const view = (over: Partial<Parameters<typeof PendingHeroView>[0]> = {}) => (
  <PendingHeroView
    gamertag="BootsColdwater"
    challenge={challenge({})}
    now={NOW}
    onCancel={() => {}}
    onReclaim={() => {}}
    {...over}
  />
);

describe("PendingHeroView — live challenge", () => {
  test("h1 carries the headline and the gamertag; the step kicker sits above it", () => {
    render(view());
    expect(
      screen.getByRole("heading", { level: 1, name: "Prove it's you BootsColdwater" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Step 3 of 3")).toBeInTheDocument();
    expect(screen.getByText(/one step left/i)).toBeInTheDocument();
  });

  test("is a full-bleed dark hero with the red frame — and red-deep never appears on it", () => {
    const { container } = render(view());
    const section = container.querySelector("section")!;
    expect(section.className).toContain("bg-dark");
    expect(section.className).toContain("border-red");
    expect(container.innerHTML).not.toContain("red-deep");
  });

  test("emote boxes render with done/current states and the expiry countdown", () => {
    render(view());
    expect(screen.getByText(/expires in 22h/i)).toBeInTheDocument();
    const emoteList = screen.getByRole("list", { name: "Emote sequence" });
    const items = within(emoteList).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]!.textContent).toContain("✓");
    expect(items[1]!.textContent).toContain("←");
    expect(items[0]).toHaveAttribute("data-done", "true");
    expect(screen.getByText(/Only whoever controls the tag can finish this/)).toBeInTheDocument();
  });

  test("progress is announced via a role=status region, separate from the list", () => {
    const { rerender } = render(view({ challenge: challenge({ progressIndex: 1 }) }));
    expect(screen.getByRole("status")).toHaveTextContent("Step 1 of 3 confirmed");
    rerender(view({ challenge: challenge({ progressIndex: 2 }) }));
    expect(screen.getByRole("status")).toHaveTextContent("Step 2 of 3 confirmed");
    expect(screen.getByRole("status").tagName).not.toBe("OL");
  });

  test("walkthrough: three numbered how-this-works steps", () => {
    render(view());
    const how = screen.getByRole("list", { name: "How this works" });
    const steps = within(how).getAllByRole("listitem");
    expect(steps).toHaveLength(3);
    expect(steps[0]!.textContent).toMatch(/Join any One Life server/);
    expect(steps[1]!.textContent).toMatch(/in order/);
    expect(steps[2]!.textContent).toMatch(/log off/i);
  });

  // ⚠️ ADM logs arrive in 5–15 minute batches. The hero must set that expectation, or a player
  // performing the sequence and watching nothing move concludes it is broken and cancels.
  test("batching expectation line is present and verbatim", () => {
    render(view());
    expect(
      screen.getByText(
        "DayZ reports emotes in batches — your progress can take up to 15 minutes to appear here. It does not update in real time.",
      ),
    ).toBeInTheDocument();
  });

  test("no copy claims live or instant updates", () => {
    const { container } = render(view());
    expect(container.textContent ?? "").not.toMatch(/instantly|immediately|watch (this|it) update|updates? live/i);
  });

  test("cancel fires and is a 44pt target", () => {
    const onCancel = vi.fn();
    render(view({ onCancel }));
    const btn = screen.getByRole("button", { name: "Cancel claim" });
    expect(btn.className).toContain("min-h-[44px]");
    fireEvent.click(btn);
    expect(onCancel).toHaveBeenCalled();
  });
});

describe("PendingHeroView — expired", () => {
  test("same hero frame, expired headline as the h1, reclaim CTA replaces the boxes", () => {
    const onReclaim = vi.fn();
    const { container } = render(
      view({ challenge: challenge({ expired: true }), onReclaim }),
    );
    expect(container.querySelector("section")!.className).toContain("bg-dark");
    expect(
      screen.getByRole("heading", { level: 1, name: "Your verification for BootsColdwater expired" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start a new challenge →" }));
    expect(onReclaim).toHaveBeenCalled();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  test("a null challenge renders the expired state, never a crash or an empty live board", () => {
    render(view({ challenge: null }));
    expect(screen.getByRole("button", { name: "Start a new challenge →" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @onelife/web test -- pending-hero`
Expected: FAIL — cannot resolve `./pending-hero`.

- [ ] **Step 3: Write the implementation**

`apps/web/src/components/front-page/pending-hero.tsx`:

```tsx
"use client";
import type { Challenge } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatExpiry } from "@/lib/format-expiry";
import { useAccountStatus } from "@/lib/use-account-status";
import { useControlsActions } from "@/components/account/use-controls";
import { SkewCta } from "@/components/tabloid/skew-cta";
import { SrStatus } from "@/components/shared/sr-status";
import { FitLine } from "./fit-line";

const quietBtn =
  "inline-flex min-h-[44px] items-center font-mono text-[11px] uppercase tracking-[.05em] text-cream-muted underline underline-offset-2 hover:text-paper disabled:opacity-50";

/**
 * The pending home's full-bleed hero (pending-hero spec §2): the emote challenge as the page's
 * centerpiece, in the cold hero's visual language — dark stage, red frame, yellow for everything
 * live. Absorbs the retired ProveItPanel; this is the pending page's only h1, and the "Step 3
 * of 3" kicker is the 3-step ladder folded to one line (LadderFrame no longer renders for
 * pending).
 *
 * RED POLICY: `red-deep` is a light-surface token and must never appear here; the frame and the
 * SkewCta background are display-scale red, allowed on dark.
 */
export function PendingHeroView({
  gamertag,
  challenge,
  now,
  onCancel,
  onReclaim,
  canceling,
  reclaiming,
}: {
  gamertag: string;
  challenge: Challenge | null;
  now: number;
  onCancel: () => void;
  onReclaim: () => void;
  canceling?: boolean;
  reclaiming?: boolean;
}) {
  const expired = !challenge || challenge.expired;
  return (
    <section className="border-b-[6px] border-red bg-dark px-6 py-12 text-paper md:px-10 md:py-16">
      <p className="font-mono text-xs uppercase tracking-[.28em] text-cream-dim">
        <span className="font-bold text-yellow">Step 3 of 3</span> — one step left
      </p>
      {expired ? (
        <>
          <h1 className="mt-4 font-display text-4xl font-bold uppercase leading-[.95] md:text-6xl">
            Your verification for {gamertag} expired
          </h1>
          <p className="mt-4 max-w-xl font-sans text-lg leading-relaxed text-cream-dim">
            The emote challenge timed out. Start a fresh one and perform the new sequence in game.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-5">
            <SkewCta onClick={onReclaim} disabled={reclaiming}>Start a new challenge →</SkewCta>
            <button type="button" onClick={onCancel} disabled={canceling} className={quietBtn}>
              Cancel claim
            </button>
          </div>
        </>
      ) : (
        <>
          <h1 className="mt-4 font-display font-bold uppercase leading-[.95]">
            <FitLine finalText="Prove it's you" lineClassName="text-[clamp(2.5rem,9vw,10rem)]">
              Prove it's you
            </FitLine>
            <span className="mt-3 block text-2xl font-semibold tracking-[.12em] text-yellow md:text-4xl">
              {gamertag}
            </span>
          </h1>
          <p className="mt-6 font-mono text-[13px] font-bold uppercase tracking-[.08em] text-yellow">
            Perform, in order — {formatExpiry(challenge.expiresAt, now)}
          </p>
          {/* Separate node from the <ol> below — role="status" on the list itself would strip its
           *  list semantics. Scoped to progress only, so the ticking countdown above does not
           *  re-announce every second (SR-structure spec). */}
          <SrStatus>{`Step ${challenge.progressIndex} of ${challenge.sequence.length} confirmed`}</SrStatus>
          <ol
            role="list"
            aria-label="Emote sequence"
            className="mt-4 flex max-w-3xl gap-2.5 font-mono text-[13px] tracking-[.03em] md:text-base"
          >
            {challenge.sequence.map((emote, i) => {
              const done = i < challenge.progressIndex;
              const current = i === challenge.progressIndex;
              return (
                <li
                  key={i}
                  data-done={String(done)}
                  className={cn(
                    "flex-1 px-3 py-5 text-center uppercase",
                    done && "bg-paper font-bold text-ink",
                    current && "border border-dashed border-dark-edge-bright bg-dark-hollow text-yellow",
                    !done && !current && "border border-dashed border-dark-line text-cream-muted",
                  )}
                >
                  {i + 1} {emote}
                  <span aria-hidden="true">{done ? " ✓" : current ? " ←" : ""}</span>
                </li>
              );
            })}
          </ol>
          <div className="mt-8 grid max-w-3xl gap-6 md:grid-cols-2 md:items-start">
            <ol
              role="list"
              aria-label="How this works"
              className="flex list-decimal flex-col gap-2 pl-4 font-mono text-[11px] uppercase leading-relaxed tracking-[.04em] text-cream-muted marker:text-yellow"
            >
              <li>Join any One Life server.</li>
              <li>Perform the emotes above, in order.</li>
              <li>Done — you can log off and close this page.</li>
            </ol>
            <div>
              <p className="border-l-2 border-yellow pl-3 font-mono text-[11px] uppercase leading-relaxed tracking-[.04em] text-yellow">
                DayZ reports emotes in batches — your progress can take up to 15 minutes to appear
                here. It does not update in real time.
              </p>
              <p className="mt-3 font-mono text-[11px] uppercase leading-relaxed tracking-[.04em] text-cream-muted">
                Other emotes in between are fine — order is what counts. Only whoever controls the
                tag can finish this.
              </p>
            </div>
          </div>
          <div className="mt-8">
            <button type="button" onClick={onCancel} disabled={canceling} className={quietBtn}>
              Cancel claim
            </button>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * Thin container (untested, per convention): gates on pending — renders nothing for every other
 * status, including `loading` (no flash; appearing beats vanishing) — and wires the claim/cancel
 * mutations. The 5s pending poll lives in `useGamertagLinks`, untouched.
 */
export function PendingHero() {
  const status = useAccountStatus();
  const a = useControlsActions();
  if (status.kind !== "pending") return null;
  const link = status.link;
  return (
    <PendingHeroView
      gamertag={link.gamertag}
      challenge={link.challenge}
      now={Date.now()}
      onCancel={() => a.cancel.mutate(link.id)}
      onReclaim={() => a.claim.mutate({ gamertag: link.gamertag })}
      canceling={a.cancel.isPending}
      reclaiming={a.claim.isPending}
    />
  );
}
```

Note the hooks are both called before the early return (rules of hooks). The apostrophe in "Prove it's you" is the straight `'` in BOTH `finalText` and the children — FitLine measures the final string, and a mismatched character would measure a different line.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @onelife/web test -- pending-hero`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/front-page/pending-hero.tsx apps/web/src/components/front-page/pending-hero.test.tsx
git commit -m "feat(web): PendingHeroView — the emote challenge as a full-bleed hero"
```

---

### Task 2: Mount the hero; shrink `AccountPanels`; retire `ProveItPanel`, `PendingLead`, and the pending ladder

**Files:**
- Modify: `apps/web/src/app/(site)/(boxed)/page.tsx` (the signed-in block, lines ~70-75)
- Modify: `apps/web/src/app/(site)/(boxed)/page.test.tsx`
- Modify: `apps/web/src/components/account/account-panels.tsx` (pending branch + imports)
- Modify: `apps/web/src/components/account/ladder.ts`, `apps/web/src/components/account/ladder-frame.tsx`
- Modify: `apps/web/src/components/account/three-modes.test.tsx`, `apps/web/src/components/account/link-verify-panels.test.tsx`
- Delete: `apps/web/src/components/account/verify-panel.tsx`, `apps/web/src/components/account/pending-lead.tsx`

**Interfaces:**
- Consumes: `PendingHero` from Task 1.
- Produces: page structure Task 3's copy renders under; `LadderFrame({ children })` — the `kind` prop is REMOVED (unlinked is its only remaining caller), and `ladderSteps(): LadderStep[]` likewise drops its parameter.

- [ ] **Step 1: Write the failing page-structure test**

Append to `apps/web/src/app/(site)/(boxed)/page.test.tsx`. Two pre-existing mocks matter: `useAccountStatus` is pinned at `signedOut` file-wide, and `AccountPanels` is stubbed — add a `PendingHero` stub beside it (the real one reaches TanStack mutation hooks that need a QueryClientProvider this suite deliberately doesn't mount):

```tsx
// Below the AccountPanels mock near the top of the file:
vi.mock("@/components/front-page/pending-hero", () => ({
  PendingHero: () => <section data-testid="pending-hero-slot" />,
}));
```

And a new describe at the bottom:

```tsx
describe("Home page: pending-hero slot and anchor structure", () => {
  it("signed in: ONE #claim anchor wraps both the hero slot and the padded panels", async () => {
    cookieJar.push({ name: "__Secure-better-auth.session_token", value: "x" });
    getSurvivors.mockResolvedValue({ rows: [survivor], page: 1, pageSize: 5, total: 1 });
    const { container } = render(await Home());
    const claims = container.querySelectorAll("#claim");
    expect(claims).toHaveLength(1);
    const claim = claims[0]! as HTMLElement;
    // Full-bleed anchor: padding lives on an INNER wrapper, never on the anchor itself — the
    // hero must reach the viewport edges inside the anchor target.
    expect(claim.className).not.toMatch(/px-6/);
    expect(claim.querySelector("[data-testid='pending-hero-slot']")).not.toBeNull();
    const padded = claim.querySelector("div.px-6");
    expect(padded).not.toBeNull();
    expect(padded!.querySelector("[aria-label='Your account']")).not.toBeNull();
  });

  it("signed out: no hero slot and no anchor", async () => {
    const { container } = render(await Home());
    expect(container.querySelector("#claim")).toBeNull();
    expect(container.querySelector("[data-testid='pending-hero-slot']")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `pnpm --filter @onelife/web test -- "app/(site)/(boxed)/page"`
Expected: the two new tests FAIL (no hero slot; padding currently on the `#claim` div). Pre-existing tests still pass.

- [ ] **Step 3: Restructure the page**

In `apps/web/src/app/(site)/(boxed)/page.tsx`, add the import and replace the signed-in `#claim` block:

```tsx
import { PendingHero } from "@/components/front-page/pending-hero";
```

```tsx
      {signedIn && (
        /* One anchor wraps BOTH claim surfaces (pending-hero spec §3): the masthead's
         * "Finish verification → /#claim" lands at the hero's top for pending, at the padded
         * ladder for unlinked. The anchor div is full-bleed — padding on the inner wrapper. */
        <div id="claim">
          <PendingHero />
          <div className="px-6 py-8 md:px-10">
            <AccountPanels signInFallback={signedIn} />
          </div>
        </div>
      )}
```

(The `UnverifiedPitch` line above it and the `PendingSupport` line below it are unchanged.)

- [ ] **Step 4: Shrink `AccountPanels`' pending branch**

In `apps/web/src/components/account/account-panels.tsx`:

1. Remove the imports of `ProveItPanel` and `PendingLead`.
2. Replace the whole pending branch body with:

```tsx
  } else if (c.status.kind === "pending") {
    // The pending surface is the full-bleed PendingHero mounted ABOVE this padded column
    // (pending-hero spec §3). Nothing visible renders here — but the section stays mounted so
    // VerificationAnnouncer (below) survives the pending→verified swap, and SignedInFooter
    // keeps sign-out available in every signed-in state.
    body = null;
  } else {
```

`showFooter` and `VerificationAnnouncer` are untouched.

- [ ] **Step 5: Delete the absorbed components and narrow the ladder**

```bash
git rm apps/web/src/components/account/verify-panel.tsx apps/web/src/components/account/pending-lead.tsx
```

`apps/web/src/components/account/ladder.ts` — unlinked is the only caller left, so the parameter goes (a one-value union is noise). Replace `ladderSteps`:

```tsx
export function ladderSteps(): LadderStep[] {
  return [
    { label: "Signed in", state: "done" },
    { label: "Claim your gamertag", state: "current" },
    { label: "Prove it's you", state: "upcoming" },
  ];
}
```

Update the doc comment's last paragraph to note: pending no longer renders a ladder — its hero's "Step 3 of 3" kicker carries that state (pending-hero spec §2).

`apps/web/src/components/account/ladder-frame.tsx` — drop the `kind` prop:

```tsx
export function LadderFrame({ children }: { children: ReactNode }) {
  const steps = ladderSteps();
```

In `account-panels.tsx`, the unlinked branch's `<LadderFrame kind="unlinked">` becomes `<LadderFrame>`.

- [ ] **Step 6: Update the two test files that exercised the retired pieces**

`apps/web/src/components/account/three-modes.test.tsx`:
- Remove the `PendingLead` import and its entire `describe("PendingLead", …)` block.
- In the `LadderFrame` describe, remove `kind` from every render (`<LadderFrame><p>panel</p></LadderFrame>`) and delete the now-redundant "renders the panel exactly once, not once per step" duplication only if it was the pending-specific case — keep the test itself, just without `kind="pending"`.

`apps/web/src/components/account/link-verify-panels.test.tsx`:
- Remove the `ProveItPanel` import, the `NOW` const, the `challenge` helper, and the entire `describe("ProveItPanel", …)` block (its coverage moved to `pending-hero.test.tsx` in Task 1). Remove `within` and the `Challenge` type import if now unused.

- [ ] **Step 7: Run the web suite**

Run: `pnpm --filter @onelife/web test`
Expected: PASS. Failures to watch for: any test still importing `verify-panel`/`pending-lead` (grep: `grep -rn "verify-panel\|pending-lead\|ProveItPanel\|PendingLead" apps/web/src` must return nothing), and `LadderFrame` `kind` usages.

- [ ] **Step 8: Typecheck**

Run: `pnpm turbo run typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add -A apps/web/src
git commit -m "feat(web): pending home opens with the challenge hero; retire ProveItPanel + PendingLead"
```

---

### Task 3: Pending connect beat — `ConnectSection` copy variant in `PendingSupport`

**Files:**
- Modify: `apps/web/src/components/front-page/connect-section.tsx`
- Modify: `apps/web/src/components/front-page/connect-section.test.tsx`
- Modify: `apps/web/src/components/front-page/pending-support.tsx`
- Modify: `apps/web/src/components/front-page/pending-support.test.tsx`

**Interfaces:**
- Consumes: `ConnectSection({ servers, kicker? })` — new optional `kicker: string` prop, defaulting to the existing cold copy.
- Produces: the pending page's below-hero flow: `ConnectSection` (pending kicker) → `Fallen`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/src/components/front-page/connect-section.test.tsx` inside the existing describe:

```tsx
  it("a kicker override replaces the default copy (pending-hero spec §4)", () => {
    render(
      <ConnectSection
        servers={{ kind: "ready", names: ["Chernarus"] }}
        kicker="Get in game — perform your sequence on any One Life server"
      />,
    );
    expect(screen.getByText("Get in game — perform your sequence on any One Life server")).toBeInTheDocument();
    expect(screen.queryByText(/Play first, claim later/i)).not.toBeInTheDocument();
  });
```

In `apps/web/src/components/front-page/pending-support.test.tsx`, add to the describe:

```tsx
  it("pending: the connect beat carries the pending kicker, never the cold 'Play first' line", () => {
    mockStatus.mockReturnValue({ kind: "pending", link: { gamertag: "X" } });
    render(<PendingSupport {...props} />);
    expect(screen.getByText("Get in game — perform your sequence on any One Life server")).toBeInTheDocument();
    expect(screen.queryByText(/Play first, claim later/i)).not.toBeInTheDocument();
  });
```

(The existing order test — connect region before obituaries region — keeps passing unchanged: `ConnectSection` wraps the same `HowToConnect` landmark.)

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @onelife/web test -- "connect-section|pending-support"`
Expected: the two new tests FAIL (`kicker` prop unknown; pending kicker text absent).

- [ ] **Step 3: Implement**

`connect-section.tsx` — add the prop:

```tsx
export function ConnectSection({
  servers,
  kicker = "Play first, claim later — no account needed to play",
}: {
  servers: ServersView;
  /** Copy variant: pending passes its own line — the default "claim later" is untrue post-claim. */
  kicker?: string;
}) {
  return (
    <div className="px-6 py-10 md:px-10">
      <p className="font-mono text-[11px] uppercase tracking-[.16em] text-ink-muted">{kicker}</p>
      <div className="mt-3 max-w-lg">
        <HowToConnect servers={servers} />
      </div>
    </div>
  );
}
```

`pending-support.tsx` — swap the bare card for the beat (imports: drop `HowToConnect`, keep the `ServersView` type import, add `ConnectSection`):

```tsx
import { useAccountStatus } from "@/lib/use-account-status";
import type { ObituaryCard } from "@/lib/types";
import type { ServersView } from "@/components/servers/how-to-connect";
import { ConnectSection } from "./connect-section";
import { Fallen } from "./fallen";
```

and the pending return becomes:

```tsx
  return (
    <>
      <ConnectSection
        servers={servers}
        kicker="Get in game — perform your sequence on any One Life server"
      />
      <Fallen rows={obits} />
    </>
  );
```

Update the component's doc comment: the beat is now `ConnectSection` with a pending kicker (full-width beat rhythm, pending-hero spec §4) — still never the cold "Play first, claim later" line.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @onelife/web test -- "connect-section|pending-support"`
Expected: PASS, including the pre-existing landmark-order and renders-nothing tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/front-page/connect-section.tsx apps/web/src/components/front-page/connect-section.test.tsx apps/web/src/components/front-page/pending-support.tsx apps/web/src/components/front-page/pending-support.test.tsx
git commit -m "feat(web): pending connect beat — ConnectSection variant replaces the bare card"
```

---

### Task 4: Full verification + changelog

**Files:**
- Modify: `CHANGELOG.md` (Unreleased section)

- [ ] **Step 1: Run the full check**

Run: `pnpm turbo run typecheck` then `pnpm --filter @onelife/web test`
Expected: both PASS. (DB suites untouched — no need for `TEST_DATABASE_URL` here; run the full `pnpm turbo run test --concurrency=1` only if the environment has it exported.)

- [ ] **Step 2: Grep the guard rails**

```bash
grep -rn "ProveItPanel\|PendingLead\|verify-panel\|pending-lead" apps/web/src && echo LEFTOVERS || echo clean
grep -n "red-deep" apps/web/src/components/front-page/pending-hero.tsx && echo VIOLATION || echo clean
```
Expected: `clean` twice.

- [ ] **Step 3: Changelog entry**

Add under `## [Unreleased]` in `CHANGELOG.md` (create the section if absent, matching the file's existing format):

```markdown
- **Pending-verification hero** — the pending home now opens with the same full-bleed dark hero
  treatment as the cold and unlinked homes: the emote challenge is the hero (red frame, yellow
  live elements, the gamertag in the headline), the 3-step ladder folds into a "Step 3 of 3"
  kicker, and the below-hero flow becomes a proper connect beat + the Fallen wall. `ProveItPanel`
  and `PendingLead` are retired. Browser check outstanding: the hero at phone width (FitLine
  sizing, chip layout).
```

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog for the pending-verification hero"
```

Then hand off to `keel:finish-work` to open the PR.
