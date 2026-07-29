# Home Polish + Discord-Direct Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seven follow-ups: US copy, the pitch for unverified visitors with `#claim` CTAs, rules↔fallen swap, a light closing connect section (no light sliver), a two-column hero deck/CTA, Discord-direct `/login`, and an honest avatar-sync failure.

**Architecture:** Web-heavy plus one API error-mapping change. Stats/obituaries move to cached cookie-free fetches so they run unconditionally; a client `UnverifiedPitch` gate extends the pitch to unlinked/pending with an `audience` prop redirecting CTAs at the on-page claim ladder. Spec: `docs/superpowers/specs/2026-07-28-home-polish-discord-design.md`.

**Tech Stack:** Next.js App Router, TanStack Query, Better Auth client, Fastify, vitest + RTL.

## Global Constraints

- **Copy exact:** `Favorite them so you can find them again without searching.` Unverified CTA label `Link your gamertag →` → `#claim`; cold CTA stays `Claim your life →` → `/login`. Unverified slab sub-line `You're signed in · Link your gamertag · Your life shows up here`.
- **Pitch order (both audiences): hero → Rules → Fallen → CtaSlab → ConnectSection.**
- **No verified pitch flash:** SSR and the verified path render nothing for the cookie-holding pitch; it appears only when `accountStatus` resolves to `unlinked`/`pending`.
- **The gating-test retirement is DELIBERATE** (spec §3): stats+obits become `apiGetCached` (60s, cookie-free) fetched unconditionally; the old "signed in: never stats/obits" tests pin a cost argument the cached fetch voids — delete them, do not port them.
- **Live-data honesty unchanged:** failed stats → evergreen hero; failed/empty obits → Fallen absent; per-feed `settleFeed`.
- **Sync failure taxonomy:** upstream non-200 → `409 provider_image_stale`; network/allowlist/etc → `502 fetch_failed`. Panel copy: stale → `Discord has rotated your photo's link — sign out and back in to refresh it, or upload a photo directly.`; fetch_failed → `Couldn't reach your login provider just now — try again in a minute.`
- **Discord-direct only when Discord is the ONLY method** (`providers` exactly `["discord"]` AND `magicLink === false`); every other configuration (or a failed providers fetch) renders the existing panel. Interstitial carries a working `Continue to Discord →` fallback link.
- **Repo law:** dark tokens on hero/slab, light on the connect section; web tests `pnpm --filter @onelife/web test -- <pattern>`; TEST_DATABASE_URL for API suites (port 5434, db onelife_test); CHANGELOG before PR. Branch: `feature/home-polish-discord` (spec committed).

---

### Task 1: Copy, section order, hero columns

**Files:**
- Modify: `apps/web/src/components/servers/how-to-connect.tsx:56` (Favourite → Favorite)
- Modify: `apps/web/src/components/front-page/hero.tsx` (ClaimCta props + two-column deck/CTA)
- Modify: `apps/web/src/app/(site)/(boxed)/page.tsx:53-61` (swap Fallen/Rules order)
- Test: `apps/web/src/components/servers/how-to-connect.test.tsx`, `apps/web/src/components/front-page/front-page.test.tsx`, `apps/web/src/app/(site)/(boxed)/page.test.tsx`

**Interfaces:**
- Produces: `ClaimCta({ large?, fill?, href = "/login", label = "Claim your life →" }: { large?: boolean; fill?: boolean; href?: string; label?: string })` — Tasks 3–4 pass `href`/`label`/`fill`.

- [ ] **Step 1: Failing tests**

`how-to-connect.test.tsx` — add:

```tsx
it("uses US English for the favorite instruction", () => {
  render(<HowToConnect servers={{ kind: "ready", names: ["Chernarus"] }} />);
  expect(screen.getByText(/Favorite them/)).toBeInTheDocument();
  expect(screen.queryByText(/Favourite/)).not.toBeInTheDocument();
});
```

`front-page.test.tsx` — add to the Hero describe:

```tsx
it("deck and CTA sit in one two-column row at md, button filling its column", () => {
  const { container } = render(<Hero stats={{ deaths: 4213, alive: 38 }} />);
  const row = container.querySelector("[data-testid='hero-cta-row']");
  expect(row).not.toBeNull();
  expect(row!.className).toMatch(/md:grid-cols-2/);
  const cta = screen.getByRole("link", { name: "Claim your life →" });
  expect(cta.className).toMatch(/(^|\s)h-full(\s|$)/);
  expect(cta.className).toMatch(/(^|\s)w-full(\s|$)/);
});
```

`page.test.tsx` — in the cold-landing test (L88 `"no session cookie keeps the full cold landing"`), add an order assertion:

```tsx
// Rules render BEFORE the Fallen wall (spec §4).
const html = container.innerHTML;
expect(html.indexOf("Death is real")).toBeLessThan(html.indexOf("The Fallen") === -1 ? Infinity : html.indexOf("The Fallen"));
```

(Wire the obits mock in that test to resolve one row first if it currently rejects — otherwise `The Fallen` is absent and the assertion is vacuous; follow the file's existing resolved-obits fixture from its Fallen test.)

- [ ] **Step 2: Run to verify failures** — `pnpm --filter @onelife/web test -- how-to-connect && pnpm --filter @onelife/web test -- front-page && pnpm --filter @onelife/web test -- page` → new tests FAIL.

- [ ] **Step 3: Implement**

`how-to-connect.tsx:56`: `Favourite them` → `Favorite them`.

`hero.tsx` — ClaimCta becomes:

```tsx
export function ClaimCta({ large = false, fill = false, href = "/login", label = "Claim your life →" }: {
  large?: boolean; fill?: boolean; href?: string; label?: string;
}) {
  const size = fill
    ? "flex h-full w-full items-center justify-center px-10 py-6 text-xl md:text-2xl"
    : large ? "inline-block px-10 py-4 text-lg" : "inline-block px-7 py-3.5 text-base";
  return (
    <Link
      href={href}
      // red-deep as a BACKGROUND under white text on dark: deliberate (contrast improves on
      // hover) — not a light-surface-token violation; do not "fix" in a RED-POLICY sweep.
      className={`-skew-x-[5deg] bg-red text-white font-display font-bold uppercase tracking-[.08em] hover:bg-red-deep ${size}`}
    >
      {label}
    </Link>
  );
}
```

(Existing call sites — hero body and `cta-slab.tsx`'s `<ClaimCta large />` — keep working unchanged.)

Hero bottom (replacing the deck `<p>` at L74-77 and the `mt-7` CTA div):

```tsx
<div data-testid="hero-cta-row" className="mt-6 grid gap-6 md:grid-cols-2 md:items-stretch">
  <p className="max-w-xl font-sans text-lg leading-relaxed text-cream-dim">
    Every life on our servers is tracked to the minute — birth to death, across sessions.
    When you die, the ban is real and the record is permanent.
  </p>
  <div className="min-h-[72px]">
    <ClaimCta fill />
  </div>
</div>
```

`page.tsx`: reorder the pitch block to `Hero` → `Rules` → `Fallen` → `CtaSlab`.

- [ ] **Step 4: Run to verify green** — same three patterns → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/servers/how-to-connect.tsx apps/web/src/components/servers/how-to-connect.test.tsx apps/web/src/components/front-page/hero.tsx apps/web/src/components/front-page/front-page.test.tsx "apps/web/src/app/(site)/(boxed)/page.tsx" "apps/web/src/app/(site)/(boxed)/page.test.tsx"
git commit -m "feat(web): US copy, rules-before-fallen, two-column hero CTA"
```

---

### Task 2: Cached, unconditional home feeds

**Files:**
- Modify: `apps/web/src/lib/api.ts` (cached variants), `apps/web/src/app/(site)/(boxed)/page.tsx:27-43`
- Test: `apps/web/src/app/(site)/(boxed)/page.test.tsx` (retire two gating tests, re-point mocks)

**Interfaces:**
- Produces: `getSiteStatsCached()` / `getObituariesFeedCached(page)` in `@/lib/api`, both `apiGetCached(…, HOME_FEED_REVALIDATE_SECONDS)` with `const HOME_FEED_REVALIDATE_SECONDS = 60`. Page fetches them unconditionally. Tasks 3–4 rely on `stats`/`obits` being available in the signed-in branch.

- [ ] **Step 1: Update the tests first**

In `page.test.tsx`:
- Add `getSiteStatsCached: vi.fn()` and `getObituariesFeedCached: vi.fn()` to the `@/lib/api` mock; move the beforeEach defaults (rejected) onto the cached variants; existing pitch tests re-point their `mockResolvedValue` calls to the cached fns.
- DELETE the two gating tests: `"signed out: fetches stats and obituaries, never survivors"`'s stats/obits half becomes an unconditional assertion (`getSiteStatsCached` called in BOTH cookie states) and `"signed in: fetches survivors, never stats or obituaries"` keeps ONLY the survivors half (`getSurvivors` called when signed in, not when signed out). Replace with:

```tsx
it("stats and obituaries come from the CACHED cookie-free fetchers in both cookie states", async () => {
  render(await Home());                       // signed out
  expect(getSiteStatsCached).toHaveBeenCalled();
  expect(getObituariesFeedCached).toHaveBeenCalledWith(1);
  expect(getSiteStats).not.toHaveBeenCalled();      // the cookie-forwarding fetcher must NOT serve home
  expect(getObituariesFeed).not.toHaveBeenCalled();
});
```

(and mirror the cookie-present render in the same test or a sibling). Keep the degradation tests (evergreen hero on failure, Fallen absent) — they now run against the cached mocks.

- [ ] **Step 2: Run to verify failures** — `pnpm --filter @onelife/web test -- page` → FAIL (cached fns unused).

- [ ] **Step 3: Implement**

`api.ts`, beside `getSiteStats`:

```ts
/** Home's pitch feeds — public, cookie-independent, fetched on EVERY home render (cold AND
 *  signed-in, since the unverified pitch needs them too). `apiGetCached` keeps that free: no
 *  cookie forwarding, shared 60s fetch cache. Do NOT point authenticated surfaces at these. */
const HOME_FEED_REVALIDATE_SECONDS = 60;
export const getSiteStatsCached = () => apiGetCached<SiteStats>("/api/stats", HOME_FEED_REVALIDATE_SECONDS);
export const getObituariesFeedCached = (page: number) =>
  apiGetCached<ObituariesFeed>(`/api/obituaries?page=${page}`, HOME_FEED_REVALIDATE_SECONDS);
```

`page.tsx`: replace the gated promises with unconditional ones (update the L13-25 doc comment — the old "signed-in must skip this fetch" rule is superseded by the cached fetch + unverified pitch; say so and point at the spec):

```tsx
const statsPromise = settleFeed(getSiteStatsCached());
const obitsPromise = settleFeed(getObituariesFeedCached(1));
// … servers/boardSlug/survivors unchanged …
const stats = await statsPromise;
const obits = await obitsPromise;
```

- [ ] **Step 4: Run** — `pnpm --filter @onelife/web test -- page && pnpm --filter @onelife/web typecheck` → green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/api.ts "apps/web/src/app/(site)/(boxed)/page.tsx" "apps/web/src/app/(site)/(boxed)/page.test.tsx"
git commit -m "feat(web): home pitch feeds go cached + cookie-free, fetched unconditionally"
```

---

### Task 3: The unverified pitch

**Files:**
- Modify: `apps/web/src/components/front-page/hero.tsx` (audience prop), `apps/web/src/components/front-page/cta-slab.tsx` (audience prop)
- Create: `apps/web/src/components/front-page/unverified-pitch.tsx`
- Modify: `apps/web/src/app/(site)/(boxed)/page.tsx` (mount + `#claim` anchor)
- Test: `apps/web/src/components/front-page/unverified-pitch.test.tsx` (new), `front-page.test.tsx` + `cta-slab.test.tsx` (audience variants), `page.test.tsx` (anchor)

**Interfaces:**
- Consumes: `ClaimCta` href/label props (Task 1); cached feed data on the page (Task 2); `Rules`, `Fallen`, `CtaSlab`, `Hero`, `useAccountStatus`.
- Produces: `type PitchAudience = "cold" | "unverified"` (exported from `hero.tsx`); `Hero({ stats, audience = "cold" })`; `CtaSlab({ servers, audience = "cold" })`; `UnverifiedPitch({ stats, obits, servers }: { stats: SiteStats | null; obits: ObituaryCard[]; servers: ServersView })`.

- [ ] **Step 1: Failing tests**

`front-page.test.tsx` (Hero describe):

```tsx
it("unverified audience: the CTA reads Link your gamertag and anchors to the ladder", () => {
  render(<Hero stats={{ deaths: 10, alive: 2 }} audience="unverified" />);
  expect(screen.getByRole("link", { name: "Link your gamertag →" })).toHaveAttribute("href", "#claim");
  expect(screen.queryByRole("link", { name: "Claim your life →" })).not.toBeInTheDocument();
});
```

`cta-slab.test.tsx`:

```tsx
it("unverified audience renders without the signedOut gate, with the linked-in copy", () => {
  mockStatus.mockReturnValue({ kind: "unlinked" });
  render(<CtaSlab servers={servers} audience="unverified" />);
  expect(screen.getByText(/You're signed in · Link your gamertag · Your life shows up here/i)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Link your gamertag →" })).toHaveAttribute("href", "#claim");
});
```

`unverified-pitch.test.tsx`:

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
  servers: { kind: "ready", names: ["Chernarus"] } as const,
};

describe("UnverifiedPitch", () => {
  it.each(["unlinked", "pending"] as const)("renders the pitch for %s", (kind) => {
    mockStatus.mockReturnValue(kind === "pending" ? { kind, link: { gamertag: "X" } } : { kind });
    render(<UnverifiedPitch {...props} />);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument(); // the ledger h1
    expect(screen.getAllByRole("link", { name: "Link your gamertag →" }).length).toBeGreaterThan(0);
  });

  it.each(["loading", "signedOut", "verified"] as const)("renders NOTHING for %s — no flash", (kind) => {
    mockStatus.mockReturnValue(kind === "verified" ? { kind, link: { gamertag: "X" } } : { kind });
    const { container } = render(<UnverifiedPitch {...props} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

`page.test.tsx`: in a signed-in render, assert the panels wrapper carries the anchor: `expect(container.querySelector("#claim")).not.toBeNull();` (and in the signed-out render `#claim` is absent — Task 4 removes the wrapper there; write the signed-out half in Task 4).

- [ ] **Step 2: Run to verify failures** — the three component patterns + page → FAIL.

- [ ] **Step 3: Implement**

`hero.tsx`: `export type PitchAudience = "cold" | "unverified";` and `Hero({ stats, audience = "cold" }: { stats?: SiteStats | null; audience?: PitchAudience })`; the CTA cell becomes:

```tsx
<ClaimCta fill {...(audience === "unverified" ? { href: "#claim", label: "Link your gamertag →" } : {})} />
```

`cta-slab.tsx`:

```tsx
export function CtaSlab({ servers, audience = "cold" }: { servers: ServersView; audience?: PitchAudience }) {
  const status = useAccountStatus();
  // Cold: the slab gates itself on signedOut (no pitch flash while identity resolves).
  // Unverified: the PARENT (UnverifiedPitch) owns the gate; gating here too would double-gate.
  if (audience === "cold" && status.kind !== "signedOut") return null;
  const sub = audience === "unverified"
    ? "You're signed in · Link your gamertag · Your life shows up here"
    : "Sign in · Link your gamertag · Your life shows up here";
  // … existing markup; sub-line renders {sub}; CTA:
  // <ClaimCta large {...(audience === "unverified" ? { href: "#claim", label: "Link your gamertag →" } : {})} />
}
```

`unverified-pitch.tsx`:

```tsx
"use client";
import { useAccountStatus } from "@/lib/use-account-status";
import type { SiteStats, ObituaryCard } from "@/lib/types";
import type { ServersView } from "@/components/servers/how-to-connect";
import { Hero } from "./hero";
import { Rules } from "./rules";
import { Fallen } from "./fallen";
import { CtaSlab } from "./cta-slab";

/**
 * The four-beat pitch for signed-in-but-unverified visitors (home-polish spec §3): same beats as
 * the cold home, CTAs pointed at the on-page claim ladder (#claim) instead of /login. Renders
 * NOTHING until accountStatus resolves to unlinked/pending — a verified player must never see a
 * pitch flash (SSR renders nothing here; appearing beats vanishing for the unverified).
 */
export function UnverifiedPitch({ stats, obits, servers }: {
  stats: SiteStats | null;
  obits: ObituaryCard[];
  servers: ServersView;
}) {
  const status = useAccountStatus();
  if (status.kind !== "unlinked" && status.kind !== "pending") return null;
  return (
    <>
      <Hero stats={stats} audience="unverified" />
      <Rules />
      <Fallen rows={obits} />
      <CtaSlab servers={servers} audience="unverified" />
    </>
  );
}
```

`page.tsx`: in the signed-in branch (`{signedIn && …}` — add one), mount `<UnverifiedPitch stats={stats.data} obits={obits.data?.rows ?? []} servers={serversView(servers.data, { failed: servers.failed })} />` ABOVE the AccountPanels wrapper; add `id="claim"` to the AccountPanels wrapper div. (ConnectSection joins both branches in Task 4.)

- [ ] **Step 4: Run** — the four patterns + `pnpm --filter @onelife/web typecheck` → green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/front-page "apps/web/src/app/(site)/(boxed)/page.tsx" "apps/web/src/app/(site)/(boxed)/page.test.tsx"
git commit -m "feat(web): the pitch reaches unverified players, CTAs anchored at the claim ladder"
```

---

### Task 4: The closing — light connect section, no sliver

**Files:**
- Modify: `apps/web/src/components/front-page/cta-slab.tsx` (drop the connect box), `apps/web/src/components/front-page/unverified-pitch.tsx` (append ConnectSection)
- Create: `apps/web/src/components/front-page/connect-section.tsx`
- Modify: `apps/web/src/app/(site)/(boxed)/page.tsx` (cold branch appends ConnectSection; the AccountPanels wrapper renders only when signedIn)
- Test: `apps/web/src/components/front-page/connect-section.test.tsx` (new), `cta-slab.test.tsx`, `page.test.tsx`

**Interfaces:**
- Consumes: `HowToConnect`/`ServersView` (light mode — no `onDark`).
- Produces: `ConnectSection({ servers }: { servers: ServersView })` — a light full-width section, the page's last content block for pitch audiences.

- [ ] **Step 1: Failing tests**

`connect-section.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ConnectSection } from "./connect-section";

describe("ConnectSection", () => {
  it("renders the light connect panel with the search term and maps", () => {
    render(<ConnectSection servers={{ kind: "ready", names: ["Chernarus", "Sakhal"] }} />);
    expect(screen.getByText("One Life")).toBeInTheDocument();
    expect(screen.getByText(/Chernarus, Sakhal/)).toBeInTheDocument();
    expect(screen.getByText(/Play first, claim later/i)).toBeInTheDocument();
  });
});
```

`cta-slab.test.tsx`: update the existing connect-box assertions — the slab must NOT contain the connect panel any more (`expect(screen.queryByText("One Life")).not.toBeInTheDocument()` inside the slab render; drop/replace the old map-list assertion).

`page.test.tsx`:

```tsx
it("signed out: the connect section is the last content block and no account-panels wrapper renders", async () => {
  const { container } = render(await Home());
  expect(screen.getByText(/Play first, claim later/i)).toBeInTheDocument();
  expect(container.querySelector("#claim")).toBeNull(); // wrapper (and anchor) absent when signed out
});
```

- [ ] **Step 2: Run to verify failures.**

- [ ] **Step 3: Implement**

`connect-section.tsx`:

```tsx
import { HowToConnect, type ServersView } from "@/components/servers/how-to-connect";

/** The page's last content block for pitch audiences (home-polish spec §5): light, full-width —
 *  so the document ends light-content → dark footer with no dark-slab/light-sliver sandwich.
 *  The heading copy moved here from the slab's old connect box. */
export function ConnectSection({ servers }: { servers: ServersView }) {
  return (
    <section aria-label="How to connect" className="px-6 py-10 md:px-10">
      <p className="font-mono text-[11px] uppercase tracking-[.16em] text-ink-muted">
        Play first, claim later — no account needed to play
      </p>
      <div className="mt-3 max-w-lg">
        <HowToConnect servers={servers} />
      </div>
    </section>
  );
}
```

(⚠️ `HowToConnect` renders its own `aria-label="How to connect"` section — to avoid duplicate landmarks, use `aria-label="Play first"` on this outer section OR drop the outer label; check the existing markup and keep exactly ONE labelled landmark. Adjust the test to whichever the component ends up exposing.)

`cta-slab.tsx`: delete the connect box block (the `mx-auto mt-9 …` div and the `HowToConnect` import if now unused).

`unverified-pitch.tsx`: append `<ConnectSection servers={servers} />` after `<CtaSlab …/>`.

`page.tsx`: cold branch appends `<ConnectSection servers={serversView(servers.data, { failed: servers.failed })} />` after `CtaSlab`; the AccountPanels wrapper becomes:

```tsx
{signedIn && (
  <div id="claim" className="px-6 py-8 md:px-10">
    <AccountPanels signInFallback={signedIn} />
  </div>
)}
```

(The stale-cookie case — cookie present, session dead — still renders `AccountPanels`' signInFallback inside the wrapper; unchanged behavior.)

- [ ] **Step 4: Run** — `connect-section`, `cta-slab`, `page`, full `pnpm --filter @onelife/web test && pnpm --filter @onelife/web typecheck` → green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/front-page "apps/web/src/app/(site)/(boxed)/page.tsx" "apps/web/src/app/(site)/(boxed)/page.test.tsx"
git commit -m "feat(web): light closing connect section; slab sheds its box; no signed-out sliver"
```

---

### Task 5: Discord-direct login

**Files:**
- Create: `apps/web/src/components/discord-redirect.tsx`
- Modify: `apps/web/src/app/(site)/(boxed)/login/page.tsx`
- Test: `apps/web/src/components/discord-redirect.test.tsx` (new); the login page's existing test file if one exists (check `login` test siblings — adjust its providers fixtures if it renders the page)

**Interfaces:**
- Consumes: `signIn` from `@/lib/auth-client` (`signIn.social({ provider: "discord", callbackURL: "/welcome" })` — the exact call `login-panel.tsx:36` makes); `AuthMethods` (`{ providers: string[]; magicLink: boolean }`).
- Produces: `DiscordRedirect()` — client component that fires the redirect on mount; `isDiscordOnly(methods: AuthMethods | null): boolean` exported from the same file (pure, testable).

- [ ] **Step 1: Failing tests**

```tsx
// apps/web/src/components/discord-redirect.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { DiscordRedirect, isDiscordOnly } from "./discord-redirect";

const social = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/auth-client", () => ({ signIn: { social: (...a: unknown[]) => social(...a) } }));

describe("isDiscordOnly", () => {
  it("true only for exactly [discord] with magic link off", () => {
    expect(isDiscordOnly({ providers: ["discord"], magicLink: false })).toBe(true);
    expect(isDiscordOnly({ providers: ["discord"], magicLink: true })).toBe(false);
    expect(isDiscordOnly({ providers: ["discord", "google"], magicLink: false })).toBe(false);
    expect(isDiscordOnly({ providers: [], magicLink: false })).toBe(false);
    expect(isDiscordOnly(null)).toBe(false); // failed providers fetch → never auto-redirect
  });
});

describe("DiscordRedirect", () => {
  it("fires the discord social sign-in on mount and shows the fallback link", () => {
    render(<DiscordRedirect />);
    expect(social).toHaveBeenCalledWith({ provider: "discord", callbackURL: "/welcome" });
    expect(screen.getByText(/Redirecting to Discord/i)).toBeInTheDocument();
    const fallback = screen.getByRole("button", { name: "Continue to Discord →" });
    fallback.click();
    expect(social).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @onelife/web test -- discord-redirect` → FAIL.

- [ ] **Step 3: Implement**

```tsx
// apps/web/src/components/discord-redirect.tsx
"use client";
import { useEffect, useRef } from "react";
import { signIn } from "@/lib/auth-client";

/** True only when Discord is the sole way in — any other configuration (dev magic-link, extra
 *  providers, a FAILED providers fetch) keeps the button page (home-polish spec §7). */
export function isDiscordOnly(methods: { providers: string[]; magicLink: boolean } | null): boolean {
  return !!methods && !methods.magicLink && methods.providers.length === 1 && methods.providers[0] === "discord";
}

const go = () => void signIn.social({ provider: "discord", callbackURL: "/welcome" });

/** Renders instead of the login panel when Discord is the only method: fires the OAuth redirect
 *  immediately, with a real fallback control so a blocked redirect is never a dead end. */
export function DiscordRedirect() {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return; // StrictMode double-invoke guard — one redirect, not two
    fired.current = true;
    go();
  }, []);
  return (
    <div className="flex flex-col items-start gap-4">
      <p aria-live="polite" className="font-sans text-base text-ink-soft">Redirecting to Discord…</p>
      <button
        type="button"
        onClick={go}
        className="-skew-x-[5deg] bg-discord px-5 py-3 font-display text-sm font-bold uppercase tracking-[.08em] text-white hover:opacity-90"
      >
        Continue to Discord →
      </button>
    </div>
  );
}
```

`login/page.tsx`: after the existing `const methods = await getAuthMethods().catch(() => null)`, branch:

```tsx
{methods === null ? (
  /* existing role="alert" unavailable fallback, unchanged */
) : isDiscordOnly(methods) ? (
  <DiscordRedirect />
) : (
  <LoginPanel providers={methods.providers} magicLink={methods.magicLink} />
)}
```

(Import `DiscordRedirect, isDiscordOnly` from `@/components/discord-redirect`. Keep the page's kicker/h1/sub copy for both branches.)

- [ ] **Step 4: Run** — `pnpm --filter @onelife/web test -- discord-redirect && pnpm --filter @onelife/web test -- login && pnpm --filter @onelife/web typecheck` → green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/discord-redirect.tsx apps/web/src/components/discord-redirect.test.tsx "apps/web/src/app/(site)/(boxed)/login/page.tsx"
git commit -m "feat(web): /login forwards straight to Discord when it is the only method"
```

---

### Task 6: Honest avatar-sync failure

**Files:**
- Modify: `apps/api/src/routes/avatars.ts:68-74` (error mapping), `apps/api/src/lib/avatar-store.ts` (no change needed — it already throws `fetch_failed_status_${res.status}`; verify)
- Modify: `apps/web/src/components/account/avatar-panel.tsx:9-14` (messages)
- Test: `apps/api/test/avatar-routes.test.ts` (extend), `apps/web/src/components/account/avatar-panel.test.tsx` (extend)

**Interfaces:**
- Produces: `POST /me/avatar/sync` → `409 { error: "provider_image_stale" }` when the provider answered non-200; `502 { error: "fetch_failed" }` otherwise. Panel messages per Global Constraints.

- [ ] **Step 1: Failing tests**

`apps/api/test/avatar-routes.test.ts` — find the existing sync tests (they stub the provider image server / `allowTestHosts`); add:

```ts
it("maps an upstream non-200 to 409 provider_image_stale, not a 502", async () => {
  // point session.user.image at a test-host URL whose handler returns 404 (follow the file's
  // existing loopback test-server pattern for sync tests)
  const res = await postSync();
  expect(res.statusCode).toBe(409);
  expect(res.json()).toEqual({ error: "provider_image_stale" });
});

it("keeps 502 fetch_failed for a connection failure", async () => {
  // image URL pointing at a closed port on loopback
  const res = await postSync();
  expect(res.statusCode).toBe(502);
  expect(res.json()).toEqual({ error: "fetch_failed" });
});
```

(Adapt to the file's real helpers — it already has sync coverage; mirror how it builds sessions and test images. If no closed-port test exists, `127.0.0.1:1` is the conventional refused address.)

`avatar-panel.test.tsx`:

```tsx
it("announces the stale-provider message on 409 provider_image_stale", async () => {
  // follow the file's existing sync-error test pattern, rejecting with an ApiError(409, "provider_image_stale")
  // assert the announcement text matches /rotated your photo's link/i
});
it("announces the transient message on 502 fetch_failed", async () => {
  // rejects with ApiError(502, "fetch_failed"); assert /try again in a minute/i
});
```

(Write these as real tests following the file's existing `onError` announcement tests — it has them for other codes.)

- [ ] **Step 2: Run to verify failures** — `pnpm --filter @onelife/api test -- avatar-routes` (TEST_DATABASE_URL needed) and `pnpm --filter @onelife/web test -- avatar-panel` → FAIL.

- [ ] **Step 3: Implement**

`avatars.ts` sync catch:

```ts
let raw: Buffer;
try {
  raw = await fetchProviderImage(providerImage, { allowTestHosts: opts?.allowTestHosts });
} catch (err) {
  // A failed sync leaves any existing row untouched — nothing is written below this point.
  // Upstream answered but the image is gone/moved (Discord rotates avatar CDN URLs, and the
  // copy stored at sign-in eventually 404s): that's the ACCOUNT's state, not our
  // infrastructure — 409, like no_provider_image. Everything else stays 502.
  const stale = err instanceof Error && err.message.startsWith("fetch_failed_status_");
  if (stale) return reply.code(409).send({ error: "provider_image_stale" });
  return reply.code(502).send({ error: "fetch_failed" });
}
```

`avatar-panel.tsx` `ERROR_MESSAGES`:

```ts
provider_image_stale:
  "Discord has rotated your photo's link — sign out and back in to refresh it, or upload a photo directly.",
fetch_failed: "Couldn't reach your login provider just now — try again in a minute.",
```

- [ ] **Step 4: Run** — both suites + `pnpm --filter @onelife/api typecheck` → green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/avatars.ts apps/api/test/avatar-routes.test.ts apps/web/src/components/account/avatar-panel.tsx apps/web/src/components/account/avatar-panel.test.tsx
git commit -m "fix(api,web): avatar sync distinguishes a stale provider image from a fetch failure"
```

---

### Task 7: Docs + full verification

**Files:** `CHANGELOG.md`, `CLAUDE.md`

- [ ] **Step 1: Changelog** (Unreleased, matching style):

```markdown
### Changed

- The home-page pitch now greets signed-in players who haven't linked a gamertag too, with every
  button pointing at the claim ladder; the rules now come before the obituaries; the hero's
  pitch line and claim button sit side by side with a full-size button; the page closes with a
  light "how to connect" section (no more stray light bar above the footer); and "Favourite"
  became "Favorite". Signing in now goes straight to Discord. A failed "refresh from login
  provider" now explains that Discord rotated the photo link instead of erroring.
```

- [ ] **Step 2: CLAUDE.md** — amend the cold-home ledger/relaunch entry: pitch order is hero →
  rules → fallen → CTA slab → light `ConnectSection`; the pitch ALSO renders for
  unlinked/pending via `UnverifiedPitch` (client-gated, CTAs → `#claim`; no verified flash);
  stats+obits are `apiGetCached` 60s cookie-free and UNCONDITIONAL (the old fetch-gating rule is
  superseded — do not restore it); the signed-out home renders no AccountPanels wrapper. Amend
  the SP2/login note: `/login` auto-forwards to Discord when it is the only enabled method
  (`isDiscordOnly` — dev configs with magic-link keep the panel). Note the avatar-sync 409
  `provider_image_stale` mapping in the Login avatars entry.

- [ ] **Step 3: Full suite + typecheck** — repo root, TEST_DATABASE_URL exported: `pnpm turbo run test --concurrency=1 && pnpm turbo run typecheck` → 22/22 both.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md CLAUDE.md
git commit -m "docs: changelog + CLAUDE.md for home polish + discord-direct login"
```

---

## Post-plan notes (not tasks)

- **Deploy:** plain `./deploy/deploy.sh`, no `--rebuild`, no migration, no env vars.
- **Browser checklist (pre-release):** unverified account sees the pitch and the CTAs scroll to the ladder; the Discord redirect round trip on the deployed site (real OAuth); hero columns at phone/desktop; the page ends with no light sliver; sync-stale message renders for a rotated Discord URL.
- **PR** via keel:finish-work.
