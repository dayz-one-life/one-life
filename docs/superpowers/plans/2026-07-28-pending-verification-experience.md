# Pending-Verification Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A player mid-verification (`accountStatus: "pending"`) gets a home page that leads with the emote challenge instead of a stale "link your gamertag" pitch, honest copy about the 5–15-minute ADM log batching delay, and a masthead menu that says "Finish verification →" instead of asking them to re-do the claim.

**Architecture:** Client-side audience gating only — the pending/unlinked distinction exists solely in `useAccountStatus()`, so the server markup of `app/(site)/(boxed)/page.tsx` keeps its current order (`UnverifiedPitch` → `#claim` → new `PendingSupport`). `UnverifiedPitch` narrows to unlinked-only; a new `PendingSupport` renders pending-only support content below the challenge; `ProveItPanel` gains a walkthrough + batching-expectation copy; `AccountAffordance` gains a pending branch. Presentation only: no migration, no API change, no env var, no worker. Spec: `docs/superpowers/specs/2026-07-28-pending-verification-experience-design.md`.

**Tech Stack:** Next.js App Router (apps/web), React 19, Tailwind (tabloid tokens), TanStack Query, Vitest + React Testing Library (jsdom).

## Global Constraints

- Branch: `feature/pending-verification-experience` (already exists, spec committed). All work commits there.
- Run web tests with: `pnpm --filter @onelife/web run test -- <file>` (no DB needed for these suites). Full check before PR: `pnpm turbo run typecheck` and `pnpm turbo run test --concurrency=1` (DB suites need `TEST_DATABASE_URL`; if unset, at minimum run the full web-package test suite).
- Copy rules (verbatim from spec):
  - Batching line: **"DayZ reports emotes in batches — your progress can take up to 15 minutes to appear here. It does not update in real time."**
  - Pending masthead menu item: **"Finish verification →"** linking to **`/#claim`**.
  - Pending lead: kicker **"One step left"**, headline **"Prove it's you in game"**.
- No CTA anywhere on the pending home may ask for a step already done (no "Link your gamertag" text for pending).
- Dark-surface color rules: on the dark challenge panel use `yellow`/`red`/`red-soft` tokens, never `red-deep` (light-surface-only token — see CLAUDE.md RED POLICY).
- Type floors: functional mono copy ≥ 11px equivalents used in existing panels; reuse existing class patterns, don't invent new sizes.
- Invariants that must survive: `VerificationAnnouncer` stays an unconditional sibling of `body` in `AccountPanels`; the ladder keeps exactly one `current` step; the `#claim` anchor div stays in `page.tsx` (unlinked hero/slab links still target it).

---

### Task 1: `UnverifiedPitch` renders for unlinked only

For `pending`, the component must render nothing — that floats the `#claim` section to the top of the pending home. The `servers` prop and `ConnectSection` beat existed only for pending, so both go.

**Files:**
- Modify: `apps/web/src/components/front-page/unverified-pitch.tsx`
- Modify: `apps/web/src/components/front-page/unverified-pitch.test.tsx`
- Modify: `apps/web/src/app/(site)/(boxed)/page.tsx` (drop the `servers` prop from `<UnverifiedPitch>`)

**Interfaces:**
- Consumes: `useAccountStatus()` (`@/lib/use-account-status`), existing beats (`Hero`, `Rules`, `Fallen`, `CtaSlab`).
- Produces: `UnverifiedPitch({ stats, obits }: { stats: SiteStats | null; obits: ObituaryCard[] })` — **no `servers` prop anymore**. Task 2 supplies pending's connect content instead.

- [ ] **Step 1: Rewrite the test file's expectations**

Replace the body of `unverified-pitch.test.tsx` with:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { UnverifiedPitch } from "./unverified-pitch";

const mockStatus = vi.fn();
vi.mock("@/lib/use-account-status", () => ({ useAccountStatus: () => mockStatus() }));
vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
vi.stubGlobal("ResizeObserver", vi.fn().mockImplementation(() => ({ observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() })));

const props = {
  stats: { deaths: 99, alive: 3 },
  obits: [],
};

describe("UnverifiedPitch", () => {
  it("unlinked: renders the pitch beats", () => {
    mockStatus.mockReturnValue({ kind: "unlinked" });
    render(<UnverifiedPitch {...props} />);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument(); // the ledger h1
    expect(screen.getAllByRole("link", { name: "Link your gamertag →" }).length).toBeGreaterThan(0);
  });

  // dedupe: `unlinked`'s claim-ladder empty state (AccountPanels, not rendered by this component)
  // already carries HowToConnect, so this component must not render ConnectSection — that
  // would be a second identically-labelled "How to connect" landmark on one page.
  it("unlinked: does NOT render ConnectSection's copy — the claim ladder's empty state owns it", () => {
    mockStatus.mockReturnValue({ kind: "unlinked" });
    render(<UnverifiedPitch {...props} />);
    expect(screen.queryByText(/Play first, claim later/i)).not.toBeInTheDocument();
  });

  // ⚠️ Pending is NOT a pitch audience anymore (pending-verification spec §2): they already
  // claimed, so any "Link your gamertag" CTA here would demand a step they have done. Rendering
  // nothing floats the #claim challenge section to the top of their page.
  it("pending: renders NOTHING — the challenge leads the page instead", () => {
    mockStatus.mockReturnValue({ kind: "pending", link: { gamertag: "X" } });
    const { container } = render(<UnverifiedPitch {...props} />);
    expect(container).toBeEmptyDOMElement();
  });

  it.each(["loading", "signedOut", "verified"] as const)("renders NOTHING for %s — no flash", (kind) => {
    mockStatus.mockReturnValue(kind === "verified" ? { kind, link: { gamertag: "X" } } : { kind });
    const { container } = render(<UnverifiedPitch {...props} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @onelife/web run test -- unverified-pitch`
Expected: FAIL — "pending: renders NOTHING" fails (pending still renders the pitch), and the file may also fail to compile once props lose `servers` (that error appears in step 3's run instead).

- [ ] **Step 3: Rewrite `unverified-pitch.tsx`**

```tsx
"use client";
import { useAccountStatus } from "@/lib/use-account-status";
import type { SiteStats, ObituaryCard } from "@/lib/types";
import { Hero } from "./hero";
import { Rules } from "./rules";
import { Fallen } from "./fallen";
import { CtaSlab } from "./cta-slab";

/**
 * The pitch for signed-in-but-UNLINKED visitors (home-polish spec §3; narrowed by the
 * pending-verification spec §2): same beats as the cold home, CTAs pointed at the on-page claim
 * ladder (#claim) instead of /login.
 *
 * ⚠️ Pending renders NOTHING here. A pending player already claimed — every CTA in these beats
 * asks for a step they have done — and rendering nothing floats the #claim challenge section
 * (`AccountPanels`) to the top of their page. `PendingSupport` (below `#claim` in the page)
 * carries their support content instead. `unlinked` renders no ConnectSection either: its
 * claim-ladder empty state already carries HowToConnect, and a second identically-labelled
 * landmark on one page is a duplicate.
 *
 * Renders NOTHING until accountStatus resolves to unlinked — a verified player must never see a
 * pitch flash (SSR renders nothing here; appearing beats vanishing for the unverified).
 */
export function UnverifiedPitch({ stats, obits }: {
  stats: SiteStats | null;
  obits: ObituaryCard[];
}) {
  const status = useAccountStatus();
  if (status.kind !== "unlinked") return null;
  return (
    <>
      <Hero stats={stats} audience="unverified" />
      <Rules />
      <Fallen rows={obits} />
      <CtaSlab audience="unverified" />
    </>
  );
}
```

- [ ] **Step 4: Drop the `servers` prop at the call site**

In `apps/web/src/app/(site)/(boxed)/page.tsx`, the signed-in branch currently reads:

```tsx
{signedIn && (
  <UnverifiedPitch
    stats={stats.data}
    obits={obits.data?.rows ?? []}
    servers={serversView(servers.data, { failed: servers.failed })}
  />
)}
```

Change it to:

```tsx
{signedIn && <UnverifiedPitch stats={stats.data} obits={obits.data?.rows ?? []} />}
```

(Leave the `serversView` import in place — the signed-out branch's `ConnectSection` still uses it, and Task 2 adds a second use.)

- [ ] **Step 5: Run tests and typecheck to verify green**

Run: `pnpm --filter @onelife/web run test -- unverified-pitch front-page` and `pnpm --filter @onelife/web run typecheck`
Expected: PASS. If `front-page.test.tsx` fails because it passed a `servers` prop to `UnverifiedPitch`, remove that prop from the test's usage — the component no longer accepts it.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/front-page/unverified-pitch.tsx apps/web/src/components/front-page/unverified-pitch.test.tsx "apps/web/src/app/(site)/(boxed)/page.tsx"
git commit -m "feat(web): pending no longer sees the unlinked pitch — challenge leads the page"
```

---

### Task 2: `PendingSupport` — connect + obituaries below the challenge

New client component, rendered by the home page **below** the `#claim` section, pending-only: `HowToConnect` (they must get in game to emote) then `Fallen`. Bare `HowToConnect`, not `ConnectSection` — `ConnectSection`'s "Play first, claim later" kicker is untrue for someone who already claimed.

**Files:**
- Create: `apps/web/src/components/front-page/pending-support.tsx`
- Create: `apps/web/src/components/front-page/pending-support.test.tsx`
- Modify: `apps/web/src/app/(site)/(boxed)/page.tsx` (mount after the `#claim` div)

**Interfaces:**
- Consumes: `useAccountStatus()`; `HowToConnect`/`ServersView` (`@/components/servers/how-to-connect`); `Fallen` (`./fallen`); `ObituaryCard` (`@/lib/types`).
- Produces: `PendingSupport({ obits, servers }: { obits: ObituaryCard[]; servers: ServersView })`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/front-page/pending-support.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PendingSupport } from "./pending-support";
import type { ServersView } from "@/components/servers/how-to-connect";
import type { ObituaryCard } from "@/lib/types";

const mockStatus = vi.fn();
vi.mock("@/lib/use-account-status", () => ({ useAccountStatus: () => mockStatus() }));

const obit: ObituaryCard = {
  slug: "x-dies", headline: "X Dies", lede: "He did.", gamertag: "X",
  map: "chernarusplus", timeAliveSeconds: 3600,
} as ObituaryCard;

const props = {
  obits: [obit],
  servers: { kind: "ready", names: ["Chernarus"] } satisfies ServersView,
};

describe("PendingSupport", () => {
  it("pending: renders How to connect then the obituary wall, in that order", () => {
    mockStatus.mockReturnValue({ kind: "pending", link: { gamertag: "X" } });
    render(<PendingSupport {...props} />);
    const connect = screen.getByRole("region", { name: "How to connect" });
    const fallen = screen.getByRole("region", { name: "Recent obituaries" });
    // DOM order: connect precedes obituaries (Node.compareDocumentPosition is jsdom-safe).
    expect(connect.compareDocumentPosition(fallen) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("pending with no obituaries: connect renders, the wall renders nothing", () => {
    mockStatus.mockReturnValue({ kind: "pending", link: { gamertag: "X" } });
    render(<PendingSupport {...props} obits={[]} />);
    expect(screen.getByRole("region", { name: "How to connect" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Recent obituaries" })).not.toBeInTheDocument();
  });

  it.each(["loading", "signedOut", "unlinked", "verified"] as const)(
    "renders NOTHING for %s — no flash, no duplicate landmarks",
    (kind) => {
      mockStatus.mockReturnValue(kind === "verified" ? { kind, link: { gamertag: "X" } } : { kind });
      const { container } = render(<PendingSupport {...props} />);
      expect(container).toBeEmptyDOMElement();
    },
  );
});
```

Note: `HowToConnect` renders `<section aria-label="How to connect">` and `Fallen` renders `<section aria-label="Recent obituaries">` — both are queryable as `role: "region"` because a labelled `section` maps to `region`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @onelife/web run test -- pending-support`
Expected: FAIL — cannot resolve `./pending-support`.

- [ ] **Step 3: Write the component**

Create `apps/web/src/components/front-page/pending-support.tsx`:

```tsx
"use client";
import { useAccountStatus } from "@/lib/use-account-status";
import type { ObituaryCard } from "@/lib/types";
import { HowToConnect, type ServersView } from "@/components/servers/how-to-connect";
import { Fallen } from "./fallen";

/**
 * Support content for a PENDING player, mounted below the #claim challenge section
 * (pending-verification spec §2). They must get in game to perform the emotes, so connect
 * instructions come first; the obituary wall follows for flavor. Deliberately bare
 * `HowToConnect`, not `ConnectSection` — its "Play first, claim later" kicker is untrue for
 * someone who already claimed.
 *
 * Renders NOTHING for every other status, including `loading` (no flash) and `unlinked`
 * (whose claim-ladder empty state already carries HowToConnect — rendering it here too would
 * duplicate the landmark on one page).
 */
export function PendingSupport({ obits, servers }: {
  obits: ObituaryCard[];
  servers: ServersView;
}) {
  const status = useAccountStatus();
  if (status.kind !== "pending") return null;
  return (
    <>
      <div className="px-6 pb-10 md:px-10">
        <div className="max-w-lg">
          <HowToConnect servers={servers} />
        </div>
      </div>
      <Fallen rows={obits} />
    </>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @onelife/web run test -- pending-support`
Expected: PASS.

- [ ] **Step 5: Mount it in the home page**

In `apps/web/src/app/(site)/(boxed)/page.tsx`: add the import

```tsx
import { PendingSupport } from "@/components/front-page/pending-support";
```

and, immediately **after** the existing `#claim` div (`{signedIn && (<div id="claim" …><AccountPanels …/></div>)}`), add:

```tsx
{signedIn && (
  <PendingSupport
    obits={obits.data?.rows ?? []}
    servers={serversView(servers.data, { failed: servers.failed })}
  />
)}
```

- [ ] **Step 6: Typecheck + page test, then commit**

Run: `pnpm --filter @onelife/web run typecheck && pnpm --filter @onelife/web run test -- front-page pending-support`
Expected: PASS.

```bash
git add apps/web/src/components/front-page/pending-support.tsx apps/web/src/components/front-page/pending-support.test.tsx "apps/web/src/app/(site)/(boxed)/page.tsx"
git commit -m "feat(web): pending home gets connect instructions + obituary wall below the challenge"
```

---

### Task 3: `PendingLead` — the "one step left" lead above the ladder

A compact tabloid lead so the pending page opens with intent rather than a form. Rendered only in `AccountPanels`' pending branch, above the identity row. It is the pending page's only `h1` (the hero is gone for pending).

**Files:**
- Create: `apps/web/src/components/account/pending-lead.tsx`
- Modify: `apps/web/src/components/account/account-panels.tsx` (pending branch only)
- Test: add to `apps/web/src/components/account/three-modes.test.tsx`

**Interfaces:**
- Consumes: nothing (pure presentational, no props).
- Produces: `PendingLead()` — kicker "One step left", `h1` "Prove it's you in game".

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/components/account/three-modes.test.tsx`:

```tsx
import { PendingLead } from "./pending-lead";

describe("PendingLead", () => {
  test("kicker + h1 headline", () => {
    render(<PendingLead />);
    expect(screen.getByText("One step left")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Prove it's you in game" })).toBeInTheDocument();
  });
});
```

(The file already imports `render`, `screen`, `describe`, `test`, `expect` — the new `import { PendingLead }` line goes with the other component imports at the top.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @onelife/web run test -- three-modes`
Expected: FAIL — cannot resolve `./pending-lead`.

- [ ] **Step 3: Write the component**

Create `apps/web/src/components/account/pending-lead.tsx`:

```tsx
/**
 * The pending home's opening lead (pending-verification spec §2): the page has no hero for
 * pending, so this is its h1 — a compact tabloid kicker + headline above the ladder. Rendered
 * ONLY by AccountPanels' pending branch; unlinked keeps the pitch hero's h1 instead.
 */
export function PendingLead() {
  return (
    <header className="pt-2">
      <p className="font-mono text-[11px] uppercase tracking-[.16em] text-red-deep">One step left</p>
      <h1 className="mt-1.5 font-display text-4xl font-bold uppercase leading-none text-ink md:text-5xl">
        Prove it&rsquo;s you in game
      </h1>
    </header>
  );
}
```

(`text-red-deep` is correct here: `AccountPanels` renders on the light page surface, and small red mono text must use the deep token per the RED POLICY.)

- [ ] **Step 4: Mount it in the pending branch**

In `apps/web/src/components/account/account-panels.tsx`, add the import:

```tsx
import { PendingLead } from "@/components/account/pending-lead";
```

and change the pending branch body to open with it:

```tsx
  } else if (c.status.kind === "pending") {
    const link = c.status.link;
    body = (
      <>
        <PendingLead />
        <IdentityRow name={link.gamertag} provider={c.provider} avatarHash={avatar.data?.hash ?? null} />
        <LadderFrame kind="pending">
          <ProveItPanel
            gamertag={link.gamertag}
            challenge={link.challenge}
            now={now.getTime()}
            onCancel={() => a.cancel.mutate(link.id)}
            onReclaim={() => a.claim.mutate({ gamertag: link.gamertag })}
            canceling={a.cancel.isPending}
            reclaiming={a.claim.isPending}
          />
        </LadderFrame>
      </>
    );
  }
```

(Everything else in the branch — and the unconditional `VerificationAnnouncer` sibling — stays exactly as it is.)

- [ ] **Step 5: Run tests + typecheck to verify green**

Run: `pnpm --filter @onelife/web run test -- three-modes && pnpm --filter @onelife/web run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/account/pending-lead.tsx apps/web/src/components/account/account-panels.tsx apps/web/src/components/account/three-modes.test.tsx
git commit -m "feat(web): pending home opens with a One-step-left lead"
```

---

### Task 4: `ProveItPanel` — walkthrough + honest batching expectations

DayZ writes ADM logs in batches: an emote can take **5–15 minutes** to register. The panel must say so, and must give a short walkthrough — while keeping every existing behavior (progress pips, 5s poll upstream, `SrStatus` announcements, cancel/reclaim).

**Files:**
- Modify: `apps/web/src/components/account/verify-panel.tsx`
- Modify: `apps/web/src/components/account/link-verify-panels.test.tsx` (ProveItPanel describe block only)

**Interfaces:**
- Consumes/Produces: `ProveItPanel` props are **unchanged** (`gamertag`, `challenge`, `now`, `onCancel`, `onReclaim`, `canceling?`, `reclaiming?`).

- [ ] **Step 1: Update the ProveItPanel tests**

In `link-verify-panels.test.tsx`, inside `describe("ProveItPanel")`:

1. In the first test (`"live challenge: …"`), the emote-boxes assertions must scope to the emote list — the panel now has TWO lists (walkthrough + emotes). Replace

```tsx
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
```

with

```tsx
    const emoteList = screen.getByRole("list", { name: "Emote sequence" });
    const items = within(emoteList).getAllByRole("listitem");
    expect(items).toHaveLength(3);
```

and add `within` to the testing-library import at the top of the file:

```tsx
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
```

Also replace the old footnote assertion

```tsx
    expect(screen.getByText("On any One Life server. Other emotes between are fine — order is what counts. Only whoever controls the tag can finish this.")).toBeInTheDocument();
```

with

```tsx
    expect(screen.getByText(/Only whoever controls the tag can finish this/)).toBeInTheDocument();
```

2. In the test `"the status region is a separate node from the progress list"`, scope the same way — replace

```tsx
    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
```

with

```tsx
    const emoteList = screen.getByRole("list", { name: "Emote sequence" });
    expect(within(emoteList).getAllByRole("listitem")).toHaveLength(3);
```

3. In the expired test, `queryByRole("list")` must STILL find nothing (the walkthrough only renders on a live challenge) — leave that assertion as-is.

4. Add three new tests at the end of the describe block:

```tsx
  test("walkthrough: three numbered how-this-works steps", () => {
    render(<ProveItPanel gamertag="Boots" challenge={challenge({})} now={NOW} onCancel={() => {}} onReclaim={() => {}} />);
    const how = screen.getByRole("list", { name: "How this works" });
    const steps = within(how).getAllByRole("listitem");
    expect(steps).toHaveLength(3);
    expect(steps[0]!.textContent).toMatch(/Join any One Life server/);
    expect(steps[1]!.textContent).toMatch(/in order/);
    expect(steps[2]!.textContent).toMatch(/log off/i);
  });

  // ⚠️ ADM logs arrive in 5–15 minute batches. The panel must set that expectation, or a player
  // performing the sequence and watching nothing move concludes it is broken and cancels.
  test("batching expectation line is present and explicit", () => {
    render(<ProveItPanel gamertag="Boots" challenge={challenge({})} now={NOW} onCancel={() => {}} onReclaim={() => {}} />);
    expect(
      screen.getByText(
        "DayZ reports emotes in batches — your progress can take up to 15 minutes to appear here. It does not update in real time.",
      ),
    ).toBeInTheDocument();
  });

  // Nothing in the panel may promise immediacy. The only allowed match for these words is the
  // expectation line itself, which NEGATES them ("does not update in real time").
  test("no copy claims live or instant updates", () => {
    const { container } = render(
      <ProveItPanel gamertag="Boots" challenge={challenge({})} now={NOW} onCancel={() => {}} onReclaim={() => {}} />,
    );
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/instantly|immediately|watch (this|it) update|updates? live/i);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @onelife/web run test -- link-verify-panels`
Expected: FAIL — no list named "Emote sequence", no walkthrough list, no batching line.

- [ ] **Step 3: Update `verify-panel.tsx`'s live-challenge branch**

In the non-expired return of `ProveItPanel`:

1. Name the emote list (needed for the scoped queries and genuinely useful to AT users):

```tsx
      <ol role="list" aria-label="Emote sequence" className="mt-3.5 flex gap-2 font-mono text-[12px] tracking-[.03em]">
```

2. Between the emote `<ol>` and the existing footnote `<p>`, insert the walkthrough + expectation line:

```tsx
      <ol role="list" aria-label="How this works" className="mt-4 flex list-decimal flex-col gap-1.5 pl-4 font-mono text-[11px] uppercase leading-relaxed tracking-[.04em] text-cream-muted marker:text-yellow">
        <li>Join any One Life server.</li>
        <li>Perform the three emotes above, in order.</li>
        <li>Done — you can log off and close this page.</li>
      </ol>
      <p className="mt-3 border-l-2 border-yellow pl-3 font-mono text-[11px] uppercase leading-relaxed tracking-[.04em] text-yellow">
        DayZ reports emotes in batches — your progress can take up to 15 minutes to appear here. It does not update in real time.
      </p>
```

3. Shorten the existing footnote (its "on any server / in order" content moved into the walkthrough):

```tsx
      <p className="mt-3 font-mono text-[10px] uppercase leading-relaxed tracking-[.04em] text-cream-muted">
        Other emotes in between are fine — order is what counts. Only whoever controls the tag can finish this.
      </p>
```

The expired branch is unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @onelife/web run test -- link-verify-panels`
Expected: PASS — all ProveItPanel tests including the three new ones.

- [ ] **Step 5: Sweep for other suites asserting the old footnote, then commit**

Run: `grep -rn "order is what counts" apps/web/src --include="*.test.tsx"` — update any other match to the new copy the same way. Then `pnpm --filter @onelife/web run test` (whole web suite) to confirm nothing else pinned the old strings.

```bash
git add apps/web/src/components/account/verify-panel.tsx apps/web/src/components/account/link-verify-panels.test.tsx
git commit -m "feat(web): emote challenge explains itself and stops implying real-time updates"
```

---

### Task 5: `AccountAffordance` — pending state in the masthead

Pending gets: menu item **"Finish verification →"** → `/#claim`, the pending gamertag's initial in the disc (instead of "•"), and a yellow border on the disc as the pending cue. Verified/unlinked/signed-out branches unchanged.

**Files:**
- Modify: `apps/web/src/components/shell/account-affordance.tsx`
- Modify: `apps/web/src/components/shell/account-affordance.test.tsx`

**Interfaces:**
- Consumes: `AccountStatus` union (`pending` carries `link: GamertagLink` with `gamertag: string`).
- Produces: no API change — `AccountAffordance()` still takes no props.

- [ ] **Step 1: Write the failing tests**

Add to `account-affordance.test.tsx`:

```tsx
  it("pending: Finish verification link to /#claim, disc shows the tag initial with the yellow cue", () => {
    mockStatus.mockReturnValue({ kind: "pending", link: { gamertag: "boots" } });
    renderIt();
    const trigger = screen.getByRole("button", { name: "Your account" });
    expect(trigger).toHaveTextContent("B"); // pending tag's initial, not the anonymous "•"
    expect(trigger.className).toContain("border-yellow");
    fireEvent.click(trigger);
    expect(screen.getByRole("menuitem", { name: "Finish verification →" })).toHaveAttribute("href", "/#claim");
    expect(screen.queryByRole("menuitem", { name: "Claim your gamertag →" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Your profile →" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeInTheDocument();
  });

  it("verified and unlinked discs carry no yellow pending cue", () => {
    mockStatus.mockReturnValue({ kind: "verified", link: { gamertag: "X" } });
    renderIt();
    expect(screen.getByRole("button", { name: "Your account" }).className).not.toContain("border-yellow");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @onelife/web run test -- account-affordance`
Expected: FAIL — pending currently renders "•", no yellow border, and the menu says "Claim your gamertag →".

- [ ] **Step 3: Implement the pending branch**

In `account-affordance.tsx`, replace the derivation block

```tsx
  const gamertag = status.kind === "verified" ? status.link.gamertag : null;
  const initial = gamertag ? gamertag.trim().charAt(0).toUpperCase() : "•";
```

with

```tsx
  const gamertag = status.kind === "verified" ? status.link.gamertag : null;
  // A pending player has a claimed tag too — show its initial rather than an anonymous dot,
  // and mark the disc with the verification yellow so the state is visible at every width.
  const pendingTag = status.kind === "pending" ? status.link.gamertag : null;
  const initial = (gamertag ?? pendingTag)?.trim().charAt(0).toUpperCase() || "•";
```

Give the trigger button the pending cue by replacing its fixed border class:

```tsx
        className={cn(
          "flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border bg-dark-well font-display text-sm font-bold uppercase text-paper hover:border-red hover:text-red",
          pendingTag ? "border-yellow" : "border-dark-edge-bright",
        )}
```

(add `import { cn } from "@/lib/utils";` to the imports).

And make the menu three-way — replace the `{gamertag ? … : …}` menu-item block with:

```tsx
          {gamertag ? (
            <Link role="menuitem" href={`/players/${playerSlug(gamertag)}`} className={itemClass}>
              Your profile →
            </Link>
          ) : pendingTag ? (
            <Link role="menuitem" href="/#claim" className={itemClass}>
              Finish verification →
            </Link>
          ) : (
            <Link role="menuitem" href="/" className={itemClass}>
              Claim your gamertag →
            </Link>
          )}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @onelife/web run test -- account-affordance`
Expected: PASS — the two new tests and all six pre-existing ones.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/shell/account-affordance.tsx apps/web/src/components/shell/account-affordance.test.tsx
git commit -m "feat(web): masthead shows pending state — Finish verification, tag initial, yellow cue"
```

---

### Task 6: Full verification + changelog

**Files:**
- Modify: `CHANGELOG.md` (Unreleased section)

- [ ] **Step 1: Run the full check**

Run: `pnpm turbo run typecheck` and `pnpm turbo run test --concurrency=1`
(DB suites need `TEST_DATABASE_URL` — this dev machine's Postgres may be on port 5434, check `docker ps`. If the DB is unavailable, run at minimum `pnpm --filter @onelife/web run test` in full and say so honestly in the summary.)
Expected: all green.

- [ ] **Step 2: Add the changelog entry**

Under `## [Unreleased]` in `CHANGELOG.md`:

```markdown
### Changed

- Players mid-verification now get a home page about finishing verification, not starting it: the
  emote challenge leads the page under a "One step left" headline, connect instructions and the
  obituary wall follow, and the old pitch — whose every button asked them to link a gamertag they
  had already linked — no longer shows. The challenge panel now walks through the three steps and
  says plainly that DayZ reports emotes in batches, so progress can take up to 15 minutes to
  appear. The account menu in the masthead now says "Finish verification" and marks the avatar
  with a pending cue instead of offering the claim step again.
```

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog for the pending-verification experience"
```

- [ ] **Step 4: Browser verification (manual, with the user's Chrome)**

The user has a live pending account on production; the CHANGES are only verifiable locally or after deploy. If a local dev server can be run (`docker compose up -d postgres` + the api/web dev scripts), verify in a real browser: pending home leads with the "One step left" headline + challenge; no "Link your gamertag" CTA anywhere on the page; connect + obituaries below; masthead disc shows the initial with a yellow ring and the menu says "Finish verification →" landing on `#claim`. Otherwise record this as an outstanding post-deploy check in the PR body (the repo's established convention for browser passes).

---

## Self-review notes

- Spec §2 → Tasks 1–3; §3 → Task 4; §4 → Task 5; §5 test list → distributed into each task's tests. No gaps found.
- The spec's "no copy matching /real.?time|instantly/" negative assertion is implemented as the Task 4 "no copy claims live or instant updates" test; the regex deliberately does NOT include the bare words "real time", because the expectation line itself contains them in negated form.
- Type consistency: `PendingSupport({ obits, servers })`, `UnverifiedPitch({ stats, obits })`, `PendingLead()` used consistently across Tasks 1–3 and the page wiring; `ProveItPanel`'s props unchanged.
