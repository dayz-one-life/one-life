# Onboarding / Status Banner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent, site-wide banner under the masthead that reflects the visitor's account-onboarding state (signed out / unlinked / pending / verified) and drives the single next action, collapsing the masthead's amber CTA to a quiet Account link except when verified.

**Architecture:** One pure `accountStatus()` derivation is the single source of truth for both the banner and the masthead's right-hand slot. Presentational components (`StatusBanner`, `MastheadSlot`) take props and are unit-tested; thin smart wrappers read hooks and are not (matching the repo's existing convention where pages wire hooks and components like `ClaimStatus`/`EmoteSequence` take props). No backend changes — the `GET /me/gamertag-links` list endpoint already serializes the emote challenge; the only data change is a poll interval on the existing `useGamertagLinks` query so pending progress ticks live.

**Tech Stack:** Next.js (App Router) + React 19, TanStack Query v5, Better Auth react client, Tailwind (custom HSL tokens: `amber`, `bone`, `dim`, `muted`, `panel`, `panel-2`, `line`), Vitest + Testing Library (jsdom).

## Global Constraints

- All web code is TypeScript/ESM under `apps/web/src`; import alias `@/` → `apps/web/src`.
- Run web unit tests from `apps/web`: `npx vitest run <path>`. Typecheck: `pnpm turbo run typecheck`.
- Tailwind color tokens only (no raw hex where a token exists): `amber`, `bone`, `dim`, `muted`, `panel`, `panel-2`, `line`. Amber-glow banner chrome = `border-y-2 border-amber bg-amber/20`.
- Presentational components take props and are unit-tested; components that call hooks (`useSession`, `useQuery`, mutations) are thin wrappers and are NOT unit-tested.
- The active link helper is existing `activeLink(links)` (`@/lib/active-link`) — first link with status `pending|verified`.
- Exact banner copy (verbatim):
  - signedOut title: `Sign in to claim your gamertag`
  - signedOut subtitle: `One account tracks your lives across every One Life server and lets you verify the gamertag that's yours.`
  - signedOut button: `Sign in →` → `/login`
  - unlinked title: `Link your gamertag to get started`
  - unlinked subtitle: `Connect your Xbox gamertag to claim your lives and prove on the roster that they're yours.`
  - unlinked button: `Link gamertag →` → `/account/claim`
  - pending subtitle: `Log in to any One Life server and perform these emotes in order — we detect them automatically.`
  - pending title: `⚠ Finish verifying {GAMERTAG}` + progress pill `{n} / {total} DONE`
  - pending footer: `expires in {…}` + `Cancel claim`
  - expired title: `⚠ Your verification for {GAMERTAG} expired`
  - expired subtitle: `The emote challenge timed out. Start a fresh one and perform the new sequence in game.`
  - expired button: `Start a new challenge →`
- Poll interval for pending links: `5000` ms.
- Every task is TDD where a unit test applies: write the failing test, run it red, implement, run it green, commit. Smart-wrapper tasks with no unit test verify via typecheck.

---

### Task 1: `formatExpiry` helper

**Files:**
- Create: `apps/web/src/lib/format-expiry.ts`
- Test: `apps/web/src/lib/format-expiry.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `formatExpiry(expiresAt: string, now: number): string` — returns `expires in Xh` when ≥ 1h remains, `expires in Ym` under an hour, `expired` at/after `expiresAt`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/lib/format-expiry.test.ts
import { describe, it, expect } from "vitest";
import { formatExpiry } from "./format-expiry";

const NOW = 1_700_000_000_000;
const iso = (ms: number) => new Date(NOW + ms).toISOString();

describe("formatExpiry", () => {
  it("shows whole hours when an hour or more remains", () => {
    expect(formatExpiry(iso(6 * 3_600_000), NOW)).toBe("expires in 6h");
    expect(formatExpiry(iso(60 * 60_000), NOW)).toBe("expires in 1h");
  });
  it("shows minutes under an hour", () => {
    expect(formatExpiry(iso(30 * 60_000), NOW)).toBe("expires in 30m");
  });
  it("shows expired at or past the deadline", () => {
    expect(formatExpiry(iso(0), NOW)).toBe("expired");
    expect(formatExpiry(iso(-5 * 60_000), NOW)).toBe("expired");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/lib/format-expiry.test.ts`
Expected: FAIL — cannot resolve `./format-expiry` / `formatExpiry is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/web/src/lib/format-expiry.ts
/** Human "expires in Xh"/"Ym" string for a challenge deadline; "expired" at/after it. */
export function formatExpiry(expiresAt: string, now: number): string {
  const ms = new Date(expiresAt).getTime() - now;
  if (ms <= 0) return "expired";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `expires in ${mins}m`;
  return `expires in ${Math.floor(mins / 60)}h`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/lib/format-expiry.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/format-expiry.ts apps/web/src/lib/format-expiry.test.ts
git commit -m "feat(web): formatExpiry helper for challenge deadlines"
```

---

### Task 2: `accountStatus` derivation + `hasPendingLink`

**Files:**
- Create: `apps/web/src/lib/account-status.ts`
- Test: `apps/web/src/lib/account-status.test.ts`

**Interfaces:**
- Consumes: `GamertagLink` from `@/lib/types`; `activeLink` from `@/lib/active-link`.
- Produces:
  - `type AccountStatus = { kind: "loading" } | { kind: "signedOut" } | { kind: "unlinked" } | { kind: "pending"; link: GamertagLink } | { kind: "verified"; link: GamertagLink }`
  - `accountStatus(args: { signedIn: boolean; loading: boolean; links: GamertagLink[] | undefined }): AccountStatus`
  - `hasPendingLink(links: GamertagLink[] | undefined): boolean`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/lib/account-status.test.ts
import { describe, it, expect } from "vitest";
import { accountStatus, hasPendingLink } from "./account-status";
import type { GamertagLink } from "./types";

const link = (over: Partial<GamertagLink>): GamertagLink => ({
  id: 1, serverId: 1, gamertag: "GHOST_ACTOR", status: "pending",
  verifiedAt: null, challenge: null, ...over,
});

describe("accountStatus", () => {
  it("is loading when the loading flag is set", () => {
    expect(accountStatus({ signedIn: false, loading: true, links: undefined })).toEqual({ kind: "loading" });
  });
  it("is signedOut when not signed in", () => {
    expect(accountStatus({ signedIn: false, loading: false, links: undefined })).toEqual({ kind: "signedOut" });
  });
  it("is unlinked when signed in with no active link", () => {
    expect(accountStatus({ signedIn: true, loading: false, links: [] })).toEqual({ kind: "unlinked" });
    const cancelled = [link({ status: "cancelled" })];
    expect(accountStatus({ signedIn: true, loading: false, links: cancelled })).toEqual({ kind: "unlinked" });
  });
  it("is pending when the active link is pending", () => {
    const pend = link({ status: "pending" });
    expect(accountStatus({ signedIn: true, loading: false, links: [pend] })).toEqual({ kind: "pending", link: pend });
  });
  it("is verified when the active link is verified", () => {
    const ver = link({ status: "verified", verifiedAt: "2026-07-14T00:00:00Z" });
    expect(accountStatus({ signedIn: true, loading: false, links: [ver] })).toEqual({ kind: "verified", link: ver });
  });
});

describe("hasPendingLink", () => {
  it("is true only when some link is pending", () => {
    expect(hasPendingLink(undefined)).toBe(false);
    expect(hasPendingLink([link({ status: "verified" })])).toBe(false);
    expect(hasPendingLink([link({ status: "verified" }), link({ status: "pending" })])).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/lib/account-status.test.ts`
Expected: FAIL — cannot resolve `./account-status`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/web/src/lib/account-status.ts
import type { GamertagLink } from "./types";
import { activeLink } from "./active-link";

export type AccountStatus =
  | { kind: "loading" }
  | { kind: "signedOut" }
  | { kind: "unlinked" }
  | { kind: "pending"; link: GamertagLink }
  | { kind: "verified"; link: GamertagLink };

/** Single source of truth for the banner and the masthead slot. */
export function accountStatus(args: {
  signedIn: boolean;
  loading: boolean;
  links: GamertagLink[] | undefined;
}): AccountStatus {
  if (args.loading) return { kind: "loading" };
  if (!args.signedIn) return { kind: "signedOut" };
  const active = activeLink(args.links);
  if (!active) return { kind: "unlinked" };
  return active.status === "verified"
    ? { kind: "verified", link: active }
    : { kind: "pending", link: active };
}

/** True while any link is pending — gates live polling of the links query. */
export function hasPendingLink(links: GamertagLink[] | undefined): boolean {
  return links?.some((l) => l.status === "pending") ?? false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/lib/account-status.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/account-status.ts apps/web/src/lib/account-status.test.ts
git commit -m "feat(web): accountStatus derivation + hasPendingLink"
```

---

### Task 3: Hook layer — live polling + `useAccountStatus`

**Files:**
- Modify: `apps/web/src/lib/use-gamertag-links.ts`
- Create: `apps/web/src/lib/use-account-status.ts`

**Interfaces:**
- Consumes: `hasPendingLink`, `accountStatus`, `AccountStatus` from `@/lib/account-status`; `useSession` from `@/lib/auth-client`; `useGamertagLinks` from `@/lib/use-gamertag-links`.
- Produces: `useAccountStatus(): AccountStatus` — reads session + links and returns the derived status; shared by the masthead and the banner container.

> No unit test: both changes are hook wiring (require a `QueryClientProvider` + auth mock the repo doesn't set up). The pure logic they call (`hasPendingLink`, `accountStatus`) is already covered by Task 2. Verify with typecheck; behavior is verified end-to-end in Task 6.

- [ ] **Step 1: Add the poll interval to `useGamertagLinks`**

Modify `apps/web/src/lib/use-gamertag-links.ts`. Add the import and replace the `useGamertagLinks` function:

```ts
import { hasPendingLink } from "./account-status";
```

```ts
export function useGamertagLinks(enabled = true) {
  return useQuery({
    queryKey: ["gamertag-links"],
    queryFn: getGamertagLinks,
    enabled,
    // Poll while a link is pending so the banner's emote progress ticks live and
    // flips to verified on completion; stops once nothing is pending.
    refetchInterval: (q) => (hasPendingLink(q.state.data) ? 5000 : false),
  });
}
```

Leave the other hooks in the file (`useClaimGamertag`, `useCancelLink`, `useLinkStatus`) unchanged.

- [ ] **Step 2: Create `useAccountStatus`**

```ts
// apps/web/src/lib/use-account-status.ts
"use client";
import { useSession } from "./auth-client";
import { useGamertagLinks } from "./use-gamertag-links";
import { accountStatus, type AccountStatus } from "./account-status";

/** Derived onboarding status from the live session + links query. */
export function useAccountStatus(): AccountStatus {
  const { data: session, isPending } = useSession();
  const signedIn = !!session?.user;
  const links = useGamertagLinks(signedIn);
  const loading = isPending || (signedIn && links.isLoading);
  return accountStatus({ signedIn, loading, links: links.data });
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm turbo run typecheck --filter=@onelife/web`
Expected: PASS (no type errors). If the filter name differs, run `pnpm turbo run typecheck`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/use-gamertag-links.ts apps/web/src/lib/use-account-status.ts
git commit -m "feat(web): poll links while pending + useAccountStatus hook"
```

---

### Task 4: `StatusBanner` presentational component

**Files:**
- Create: `apps/web/src/components/status-banner.tsx`
- Test: `apps/web/src/components/status-banner.test.tsx`

**Interfaces:**
- Consumes: `AccountStatus` from `@/lib/account-status`; `formatExpiry` from `@/lib/format-expiry`; `cn` from `@/lib/utils`; `Challenge`/`GamertagLink` from `@/lib/types`.
- Produces: `StatusBanner(props: StatusBannerProps): JSX.Element | null` where
  ```ts
  type StatusBannerProps = {
    status: AccountStatus;
    onCancel: () => void;
    onReclaim: () => void;
    canceling?: boolean;
    reclaiming?: boolean;
    now?: number;
  };
  ```
  Renders `null` for `loading`/`verified`; invite variants for `signedOut`/`unlinked`; verify variant (or expired sub-variant) for `pending`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/components/status-banner.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { StatusBanner } from "./status-banner";
import type { GamertagLink } from "@/lib/types";

const NOW = 1_700_000_000_000;
const noop = { onCancel: vi.fn(), onReclaim: vi.fn() };

const pendingLink = (expired: boolean): GamertagLink => ({
  id: 7, serverId: 1, gamertag: "GHOST_ACTOR", status: "pending", verifiedAt: null,
  challenge: {
    sequence: ["Surrender", "Salute", "Point"], progressIndex: 1,
    expiresAt: new Date(NOW + 6 * 3_600_000).toISOString(), expired,
  },
});

describe("StatusBanner", () => {
  it("renders nothing when loading or verified", () => {
    const { container: a } = render(<StatusBanner status={{ kind: "loading" }} {...noop} />);
    expect(a).toBeEmptyDOMElement();
    const link = pendingLink(false);
    const { container: b } = render(<StatusBanner status={{ kind: "verified", link }} {...noop} />);
    expect(b).toBeEmptyDOMElement();
  });

  it("invites a signed-out visitor to sign in", () => {
    render(<StatusBanner status={{ kind: "signedOut" }} {...noop} />);
    expect(screen.getByText("Sign in to claim your gamertag")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute("href", "/login");
  });

  it("invites a linked-less user to link a gamertag", () => {
    render(<StatusBanner status={{ kind: "unlinked" }} {...noop} />);
    expect(screen.getByText("Link your gamertag to get started")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /link gamertag/i })).toHaveAttribute("href", "/account/claim");
  });

  it("shows emotes, live progress, expiry, and cancel while pending", () => {
    const onCancel = vi.fn();
    render(<StatusBanner status={{ kind: "pending", link: pendingLink(false) }} onCancel={onCancel} onReclaim={vi.fn()} now={NOW} />);
    expect(screen.getByText(/finish verifying/i)).toHaveTextContent("GHOST_ACTOR");
    expect(screen.getByText("1 / 3 DONE")).toBeInTheDocument();
    expect(screen.getByText("Salute")).toBeInTheDocument();
    expect(screen.getByText("expires in 6h")).toBeInTheDocument();
    screen.getByRole("button", { name: /cancel claim/i }).click();
    expect(onCancel).toHaveBeenCalled();
  });

  it("offers a fresh challenge when the pending challenge expired", () => {
    const onReclaim = vi.fn();
    render(<StatusBanner status={{ kind: "pending", link: pendingLink(true) }} onCancel={vi.fn()} onReclaim={onReclaim} now={NOW} />);
    expect(screen.getByText(/your verification for/i)).toHaveTextContent("GHOST_ACTOR");
    screen.getByRole("button", { name: /start a new challenge/i }).click();
    expect(onReclaim).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/components/status-banner.test.tsx`
Expected: FAIL — cannot resolve `./status-banner`.

- [ ] **Step 3: Write the implementation**

```tsx
// apps/web/src/components/status-banner.tsx
import Link from "next/link";
import type { ReactNode } from "react";
import type { AccountStatus } from "@/lib/account-status";
import type { Challenge } from "@/lib/types";
import { formatExpiry } from "@/lib/format-expiry";
import { cn } from "@/lib/utils";

type StatusBannerProps = {
  status: AccountStatus;
  onCancel: () => void;
  onReclaim: () => void;
  canceling?: boolean;
  reclaiming?: boolean;
  now?: number;
};

const bigBtn = "rounded-lg bg-amber px-7 py-3.5 text-base font-bold text-black hover:opacity-90";
const quietBtn = "text-xs text-muted underline underline-offset-2 hover:text-amber disabled:opacity-50";

function BannerShell({ children }: { children: ReactNode }) {
  return <div className="border-y-2 border-amber bg-amber/20 px-6 py-4">{children}</div>;
}

function Invite({ title, subtitle, href, label }: { title: string; subtitle: string; href: string; label: string }) {
  return (
    <BannerShell>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-7">
        <div className="flex-1">
          <p className="text-[17px] font-bold text-bone">{title}</p>
          <p className="mt-1 text-[13px] text-dim">{subtitle}</p>
        </div>
        <Link href={href} className={cn(bigBtn, "block w-full text-center sm:w-auto")}>{label}</Link>
      </div>
    </BannerShell>
  );
}

function EmoteChips({ sequence, progressIndex }: { sequence: string[]; progressIndex: number }) {
  return (
    <ol className="flex flex-wrap gap-2">
      {sequence.map((emote, i) => {
        const done = i < progressIndex;
        return (
          <li key={i} data-done={String(done)}
            className={cn("flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[13px]",
              done ? "border-line bg-panel text-muted line-through opacity-60" : "border-amber/40 bg-panel-2 text-bone")}>
            {done && <span className="text-amber no-underline">✓</span>}
            {emote}
          </li>
        );
      })}
    </ol>
  );
}

function Verify({ gamertag, challenge, onCancel, onReclaim, canceling, reclaiming, now }: {
  gamertag: string; challenge: Challenge | null;
  onCancel: () => void; onReclaim: () => void; canceling?: boolean; reclaiming?: boolean; now: number;
}) {
  const expired = !challenge || challenge.expired;
  if (expired) {
    return (
      <BannerShell>
        <p className="text-[17px] font-bold text-bone"><span className="text-amber">⚠</span> Your verification for <span>{gamertag}</span> expired</p>
        <p className="mt-1 text-[13px] text-dim">The emote challenge timed out. Start a fresh one and perform the new sequence in game.</p>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <button onClick={onReclaim} disabled={reclaiming} className="rounded-lg bg-amber px-4 py-2 text-[13px] font-semibold text-black hover:opacity-90 disabled:opacity-50">Start a new challenge →</button>
          <button onClick={onCancel} disabled={canceling} className={quietBtn}>Cancel claim</button>
        </div>
      </BannerShell>
    );
  }
  return (
    <BannerShell>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-[17px] font-bold text-bone"><span className="text-amber">⚠</span> Finish verifying <span>{gamertag}</span></p>
        <span className="text-[11px] font-extrabold tracking-wide text-amber">{challenge.progressIndex} / {challenge.sequence.length} DONE</span>
      </div>
      <p className="mt-1 text-[13px] text-dim">Log in to any One Life server and perform these emotes in order — we detect them automatically.</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <EmoteChips sequence={challenge.sequence} progressIndex={challenge.progressIndex} />
        <div className="flex items-center gap-4 sm:ml-auto">
          <span className="text-xs text-muted">{formatExpiry(challenge.expiresAt, now)}</span>
          <button onClick={onCancel} disabled={canceling} className={quietBtn}>Cancel claim</button>
        </div>
      </div>
    </BannerShell>
  );
}

export function StatusBanner({ status, onCancel, onReclaim, canceling, reclaiming, now = Date.now() }: StatusBannerProps) {
  switch (status.kind) {
    case "loading":
    case "verified":
      return null;
    case "signedOut":
      return <Invite title="Sign in to claim your gamertag" subtitle="One account tracks your lives across every One Life server and lets you verify the gamertag that's yours." href="/login" label="Sign in →" />;
    case "unlinked":
      return <Invite title="Link your gamertag to get started" subtitle="Connect your Xbox gamertag to claim your lives and prove on the roster that they're yours." href="/account/claim" label="Link gamertag →" />;
    case "pending":
      return <Verify gamertag={status.link.gamertag} challenge={status.link.challenge} onCancel={onCancel} onReclaim={onReclaim} canceling={canceling} reclaiming={reclaiming} now={now} />;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/components/status-banner.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/status-banner.tsx apps/web/src/components/status-banner.test.tsx
git commit -m "feat(web): StatusBanner presentational component"
```

---

### Task 5: `MastheadSlot` + masthead refactor

**Files:**
- Create: `apps/web/src/components/masthead-slot.tsx`
- Modify: `apps/web/src/components/header.tsx`
- Test (rewrite): `apps/web/src/components/header.test.tsx`

**Interfaces:**
- Consumes: `AccountStatus` from `@/lib/account-status`; `useAccountStatus` from `@/lib/use-account-status`; `cn` from `@/lib/utils`.
- Produces: `MastheadSlot({ status }: { status: AccountStatus }): JSX.Element | null` — loading placeholder / nothing (signedOut) / quiet Account link (unlinked, pending) / amber gamertag CTA (verified). `Masthead` becomes a thin wrapper that computes status via `useAccountStatus` and renders logo + `<MastheadSlot/>`.

- [ ] **Step 1: Rewrite the failing test**

Replace the entire contents of `apps/web/src/components/header.test.tsx`:

```tsx
// apps/web/src/components/header.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { MastheadSlot } from "./masthead-slot";
import type { GamertagLink } from "@/lib/types";

const link = (over: Partial<GamertagLink>): GamertagLink => ({
  id: 1, serverId: 1, gamertag: "GHOST_ACTOR", status: "verified",
  verifiedAt: "2026-07-14T00:00:00Z", challenge: null, ...over,
});

describe("MastheadSlot", () => {
  it("renders nothing when signed out", () => {
    const { container } = render(<MastheadSlot status={{ kind: "signedOut" }} />);
    expect(container).toBeEmptyDOMElement();
  });
  it("shows a loading placeholder", () => {
    render(<MastheadSlot status={{ kind: "loading" }} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
  it("shows a quiet Account link when unlinked or pending", () => {
    render(<MastheadSlot status={{ kind: "unlinked" }} />);
    expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute("href", "/account");
  });
  it("shows the pending user a quiet Account link", () => {
    render(<MastheadSlot status={{ kind: "pending", link: link({ status: "pending", verifiedAt: null }) }} />);
    expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute("href", "/account");
  });
  it("shows the amber gamertag CTA when verified", () => {
    render(<MastheadSlot status={{ kind: "verified", link: link({}) }} />);
    const cta = screen.getByRole("link", { name: "GHOST_ACTOR" });
    expect(cta).toHaveAttribute("href", "/account");
    expect(cta.className).toContain("bg-amber");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/components/header.test.tsx`
Expected: FAIL — cannot resolve `./masthead-slot`.

- [ ] **Step 3: Create `MastheadSlot`**

```tsx
// apps/web/src/components/masthead-slot.tsx
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { AccountStatus } from "@/lib/account-status";

const cta = "ml-auto inline-flex items-center justify-center rounded-md bg-amber px-4 py-2 text-sm font-medium text-black hover:opacity-90";
const account = "ml-auto text-sm text-dim underline decoration-line underline-offset-4 hover:text-amber";

export function MastheadSlot({ status }: { status: AccountStatus }) {
  if (status.kind === "loading") {
    return (
      <span className={cn(cta, "pointer-events-none opacity-50")} role="status" aria-live="polite">
        <span aria-hidden>…</span>
        <span className="sr-only">Loading account</span>
      </span>
    );
  }
  if (status.kind === "signedOut") return null;
  if (status.kind === "verified") {
    return <Link href="/account" className={cta}>{status.link.gamertag}</Link>;
  }
  // unlinked | pending → quiet account link (the banner carries the primary action)
  return <Link href="/account" className={account}>Account</Link>;
}
```

- [ ] **Step 4: Refactor `header.tsx` to use it**

Replace the entire contents of `apps/web/src/components/header.tsx`:

```tsx
"use client";
import Link from "next/link";
import { useAccountStatus } from "@/lib/use-account-status";
import { MastheadSlot } from "./masthead-slot";

export function Masthead() {
  const status = useAccountStatus();
  return (
    <header className="flex items-center gap-6 border-b border-line bg-panel-2 px-6 py-3">
      <Link href="/" aria-label="One Life — home">
        <img src="/one-life-horizontal.png" alt="One Life" className="h-9 w-auto" />
      </Link>
      <MastheadSlot status={status} />
    </header>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run src/components/header.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/masthead-slot.tsx apps/web/src/components/header.tsx apps/web/src/components/header.test.tsx
git commit -m "feat(web): masthead slot derives from accountStatus"
```

---

### Task 6: `StatusBannerContainer` + layout integration

**Files:**
- Create: `apps/web/src/components/status-banner-container.tsx`
- Modify: `apps/web/src/app/layout.tsx`

**Interfaces:**
- Consumes: `useAccountStatus` from `@/lib/use-account-status`; `useCancelLink`, `useClaimGamertag` from `@/lib/use-gamertag-links`; `StatusBanner` from `@/components/status-banner`.
- Produces: `StatusBannerContainer(): JSX.Element` — the smart wrapper the root layout renders between the masthead and the page.

> No unit test: smart wrapper (hooks + mutations), consistent with the untested pages. Verified via typecheck + running the app.

- [ ] **Step 1: Create the container**

```tsx
// apps/web/src/components/status-banner-container.tsx
"use client";
import { useAccountStatus } from "@/lib/use-account-status";
import { useCancelLink, useClaimGamertag } from "@/lib/use-gamertag-links";
import { StatusBanner } from "./status-banner";

export function StatusBannerContainer() {
  const status = useAccountStatus();
  const cancel = useCancelLink();
  const claim = useClaimGamertag();
  const active = status.kind === "pending" ? status.link : null;
  return (
    <StatusBanner
      status={status}
      onCancel={() => active && cancel.mutate(active.id)}
      onReclaim={() => active && claim.mutate({ gamertag: active.gamertag })}
      canceling={cancel.isPending}
      reclaiming={claim.isPending}
    />
  );
}
```

- [ ] **Step 2: Render it in the root layout**

Modify `apps/web/src/app/layout.tsx`. Add the import:

```tsx
import { StatusBannerContainer } from "@/components/status-banner-container";
```

Then render it between `<Masthead />` and the page content:

```tsx
        <QueryProvider>
          <Masthead />
          <StatusBannerContainer />
          <div className="flex-1">{children}</div>
          <Footer />
        </QueryProvider>
```

- [ ] **Step 3: Typecheck + full web test run**

Run: `pnpm turbo run typecheck --filter=@onelife/web` then `cd apps/web && npx vitest run`
Expected: typecheck PASS; all web tests PASS (new banner/status/masthead suites green, no regressions).

- [ ] **Step 4: Verify in the running app**

Use the `verify` skill (or `run` skill) to drive the four states end-to-end: signed out (Sign-in invite, no masthead CTA), signed in + no link (Link invite + Account link), pending (emote banner with live progress + Cancel), verified (no banner, amber gamertag CTA). Confirm mobile stacking at ~360px.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/status-banner-container.tsx apps/web/src/app/layout.tsx
git commit -m "feat(web): render onboarding status banner site-wide"
```

---

## Pre-PR steps (handled by finishing-a-feature)

- [ ] Update `CHANGELOG.md` (this PR): add the onboarding/status banner under the unreleased section.
- [ ] Update `CLAUDE.md` SP2 section: the masthead account CTA description becomes the banner-driven onboarding rail (signedOut/unlinked/pending → banner + collapsed masthead slot; verified → amber gamertag CTA, no banner).

## Self-Review

- **Spec coverage:** state table → Tasks 2/4/5; invite banners → Task 4; verify + expired → Task 4; masthead collapse → Task 5; no-backend + polling → Task 3; layout mount → Task 6; testing approach → Tasks 1,2,4,5; CHANGELOG/CLAUDE.md → Pre-PR. No gaps.
- **Placeholder scan:** none — every code step is complete and copy-pasteable.
- **Type consistency:** `AccountStatus` union identical across Tasks 2/4/5/6; `StatusBannerProps` matches the container's call in Task 6; `formatExpiry(expiresAt, now)` signature matches its use in Task 4; `hasPendingLink` matches Task 3's use; mutation calls (`cancel.mutate(id)`, `claim.mutate({ gamertag })`) match the existing hook signatures.
