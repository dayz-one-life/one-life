# Cold-Home Relaunch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The signed-out home becomes a four-beat pitch — dark full-width ledger hero, obituary wall, rules strip, CTA slab — with the xl sidebar gated to verified users only.

**Architecture:** Presentation + home-page fetch rewiring only (no API/read-model change). New presentational components in `apps/web/src/components/front-page/`; a `HomeShell` client wrapper gates the xl grid + sidebar on `accountStatus === "verified"`; the page gates obituaries+stats fetches to signed-out loads and the survivors fetch to signed-in loads. Spec: `docs/superpowers/specs/2026-07-28-cold-home-relaunch-design.md` (approved mockup: `.superpowers/brainstorm/94936-1785273254/content/cold-home-v2.html`).

**Tech Stack:** Next.js App Router (RSC + client components), Tailwind with the repo's Paper/Ink/Red tokens, vitest + RTL (jsdom).

## Global Constraints

- **Copy is FINAL and verbatim** (spec §7). Headline two lines, NO trailing periods: `DEATHS TO DATE: {n}` (h1, fills width) / `STILL STANDING: {n}` (smaller, beneath). Kicker: `One life. No respawns — hardcore permadeath DayZ · Xbox`. Deck: "Every life on our servers is tracked to the minute — birth to death, across sessions. When you die, the ban is real and the record is permanent." CTA: `Claim your life →` (→ `/login`).
- **Live-data honesty:** missing stats → evergreen dark hero, never a zero, no banner. Failed OR empty obituaries → the Fallen section absent entirely. Feeds degrade independently (own `settleFeed` each).
- **Fetch gating:** stats + obituaries fetch ONLY when signed out (cookie heuristic); survivors + board resolution ONLY when signed in (sidebar is its sole consumer now).
- **Sidebar verified-only:** signedOut/unlinked/pending/loading render a single centered column; the xl grid + `HomeSidebar` mount only for `verified` (client-side, via `HomeShell`).
- **A11y:** the h1's accessible name is the sr-only sentence `Deaths to date: {n}. Still standing: {n}` (no trailing period); every animated/visible ledger span is `aria-hidden`. `CountUp` is reused untouched.
- **Dark-surface tokens only** on hero/slab (`bg-dark`, `text-paper`, `text-cream`, `text-cream-dim`, plain `text-red` — never `red-deep` on dark). `HowToConnect` already has `onDark` — pass it, don't fork it.
- **Repo law:** DB not touched; web tests run with `pnpm --filter @onelife/web test -- <pattern>`; CHANGELOG.md Unreleased entry before PR. Branch: `feature/cold-home-relaunch` (already created, spec committed).

---

### Task 1: `FitLine` — width-filling headline line

**Files:**
- Create: `apps/web/src/components/front-page/fit-line.tsx`
- Test: `apps/web/src/components/front-page/fit-line.test.tsx`

**Interfaces:**
- Produces: `fitFontSize(cloneWidth: number, containerWidth: number, basePx: number, minPx: number, maxPx: number): number` (pure, exported for tests) and `FitLine({ finalText, className, children }: { finalText: string; className?: string; children: React.ReactNode })` — a client component that renders `children` in a block whose font-size is scaled so `finalText` spans the container width. Task 2 wraps the deaths line in it.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/components/front-page/fit-line.test.tsx
import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { FitLine, fitFontSize } from "./fit-line";

describe("fitFontSize", () => {
  it("scales the base size by container/clone ratio", () => {
    expect(fitFontSize(500, 1000, 50, 24, 200)).toBe(100);
  });
  it("clamps to max", () => {
    expect(fitFontSize(100, 10000, 50, 24, 160)).toBe(160);
  });
  it("clamps to min", () => {
    expect(fitFontSize(5000, 300, 50, 24, 160)).toBe(24);
  });
  it("returns the base size when the clone width is unmeasurable (jsdom, 0)", () => {
    expect(fitFontSize(0, 1000, 50, 24, 160)).toBe(50);
  });
});

describe("FitLine", () => {
  it("renders children and a hidden measuring clone carrying the final text", () => {
    const { container } = render(
      <FitLine finalText="DEATHS TO DATE: 4,213">
        <span>DEATHS TO DATE: 0</span>
      </FitLine>,
    );
    expect(container.textContent).toContain("DEATHS TO DATE: 0");
    // The clone is measurement-only: aria-hidden and invisible.
    const clone = container.querySelector("[data-fitline-clone]");
    expect(clone).not.toBeNull();
    expect(clone).toHaveAttribute("aria-hidden", "true");
    expect(clone!.textContent).toBe("DEATHS TO DATE: 4,213");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @onelife/web test -- fit-line`
Expected: FAIL — module `./fit-line` not found.

- [ ] **Step 3: Write minimal implementation**

```tsx
// apps/web/src/components/front-page/fit-line.tsx
"use client";
import { useEffect, useRef, useState } from "react";

/** Pure scaling rule: measure the final string at `basePx`, scale by container/clone, clamp.
 *  A clone width of 0 means the environment can't measure (jsdom, display:none ancestors) —
 *  keep the CSS fallback size rather than dividing by zero into Infinity. */
export function fitFontSize(cloneWidth: number, containerWidth: number, basePx: number, minPx: number, maxPx: number): number {
  if (cloneWidth <= 0 || containerWidth <= 0) return basePx;
  return Math.min(maxPx, Math.max(minPx, basePx * (containerWidth / cloneWidth)));
}

const BASE_PX = 50;
const MIN_PX = 28;
const MAX_PX = 180;

/**
 * Renders a single nowrap line sized so `finalText` fills the container width.
 *
 * The measurement target is a hidden CLONE carrying the FINAL string — never the live children,
 * whose CountUp digits are mid-animation at mount (spec §5). `tabular-nums` upstream keeps the
 * final string the widest the line will be. SSR/jsdom render at the CSS fallback size; the
 * effect upgrades it after mount and re-runs on resize via ResizeObserver.
 */
export function FitLine({ finalText, className = "", children }: {
  finalText: string;
  className?: string;
  children: React.ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cloneRef = useRef<HTMLSpanElement>(null);
  const [sizePx, setSizePx] = useState<number | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    const clone = cloneRef.current;
    if (!container || !clone) return;
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const next = fitFontSize(clone.scrollWidth, container.clientWidth, BASE_PX, MIN_PX, MAX_PX);
        setSizePx((prev) => (prev === next ? prev : next));
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [finalText]);

  return (
    <div ref={containerRef} className={className}>
      {/* Measuring clone: same type styles via inherit, fixed BASE_PX, invisible, out of flow. */}
      <span
        ref={cloneRef}
        data-fitline-clone
        aria-hidden="true"
        className="pointer-events-none invisible absolute whitespace-nowrap"
        style={{ fontSize: BASE_PX }}
      >
        {finalText}
      </span>
      <div className="whitespace-nowrap" style={sizePx !== null ? { fontSize: sizePx } : undefined}>
        {children}
      </div>
    </div>
  );
}
```

Note: jsdom has no `ResizeObserver` — the test file needs a stub before render if the effect throws. Add at the top of the test file (module scope):

```tsx
import { vi } from "vitest";
vi.stubGlobal("ResizeObserver", vi.fn().mockImplementation(() => ({ observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() })));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @onelife/web test -- fit-line`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/front-page/fit-line.tsx apps/web/src/components/front-page/fit-line.test.tsx
git commit -m "feat(web): FitLine width-filling headline component"
```

---

### Task 2: Hero rework — dark two-line ledger

**Files:**
- Modify: `apps/web/src/components/front-page/hero.tsx` (full rewrite, code below)
- Test: `apps/web/src/components/front-page/front-page.test.tsx` (rewrite the `Hero` describe)

**Interfaces:**
- Consumes: `FitLine` (Task 1), existing `CountUp` from `./count-up`, `SiteStats` from `@/lib/types`.
- Produces: `Hero({ stats }: { stats?: SiteStats | null })` — same signature as today; only the rendering changes. Task 6 keeps passing `stats={stats.data}`.

- [ ] **Step 1: Rewrite the `Hero` describe (failing tests first)**

Replace the existing `describe("Hero", …)` block in `front-page.test.tsx` with (keep the file's existing mocks — `matchMedia` stub and `useAccountStatus` mock stay):

```tsx
describe("Hero", () => {
  const stats = { deaths: 4213, alive: 38 };

  it("renders the two-line ledger with no trailing periods", () => {
    render(<Hero stats={stats} />);
    // Accessible name = sr-only sentence; one mid period, no trailing period.
    expect(
      screen.getByRole("heading", { level: 1, name: "Deaths to date: 4,213. Still standing: 38" }),
    ).toBeInTheDocument();
    // The still-standing line is its own (aria-hidden) visible line, not part of line 1.
    expect(screen.getByText(/Still standing:/i)).toBeInTheDocument();
    // Kicker carries the demoted brand line.
    expect(screen.getByText(/One life\. No respawns —/i)).toBeInTheDocument();
  });

  it("carries the primary CTA to /login", () => {
    render(<Hero stats={stats} />);
    expect(screen.getByRole("link", { name: "Claim your life →" })).toHaveAttribute("href", "/login");
  });

  it("without stats, renders the evergreen dark hero — no zero, no ledger, CTA intact", () => {
    render(<Hero stats={null} />);
    expect(screen.getByRole("heading", { level: 1, name: "One life. No respawns" })).toBeInTheDocument();
    expect(screen.queryByText(/Deaths to date/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\b0\b/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Claim your life →" })).toHaveAttribute("href", "/login");
  });
});
```

Delete the old Hero assertions ("The record of record", the `/about` link) — the About exit moves to the masthead/footer per spec; the deck sentence changes too.

- [ ] **Step 2: Run to verify the new tests fail**

Run: `pnpm --filter @onelife/web test -- front-page`
Expected: the three Hero tests FAIL against the current paper hero.

- [ ] **Step 3: Rewrite `hero.tsx`**

```tsx
import Link from "next/link";
import { CountUp } from "./count-up";
import { FitLine } from "./fit-line";
import type { SiteStats } from "@/lib/types";

const fmt = (n: number) => n.toLocaleString("en-US");

/** The primary CTA — also reused by the CTA slab (Task 4) so the two asks cannot drift. */
export function ClaimCta({ large = false }: { large?: boolean }) {
  return (
    <Link
      href="/login"
      className={`inline-block -skew-x-[5deg] bg-red text-white font-display font-bold uppercase tracking-[.08em] hover:bg-red-deep ${large ? "px-10 py-4 text-lg" : "px-7 py-3.5 text-base"}`}
    >
      Claim your life →
    </Link>
  );
}

/**
 * The cold home's hero — beat 1 of the relaunch (cold-home-relaunch spec §2): dark full-bleed,
 * two-line ledger, NO trailing periods, CTA in the hero. Without stats the same dark stage
 * carries the evergreen brand line as the h1 — never a zero, no banner (live-data honesty).
 * The sr-only sentence stays the h1's accessible name; every visible ledger span is aria-hidden
 * (CountUp's ticking digits must not reach a screen reader).
 */
export function Hero({ stats }: { stats?: SiteStats | null }) {
  return (
    <section className="border-b-[6px] border-red bg-dark px-6 py-12 text-cream md:px-10 md:py-16">
      <p className="font-mono text-xs uppercase tracking-[.28em] text-cream-dim">
        <span className="font-bold text-red">One life. No respawns</span> — hardcore permadeath DayZ · Xbox
      </p>
      {stats ? (
        <h1 className="mt-4 font-display font-bold uppercase leading-[.95]">
          <span className="sr-only">
            {`Deaths to date: ${fmt(stats.deaths)}. Still standing: ${fmt(stats.alive)}`}
          </span>
          <span aria-hidden="true" className="block">
            <FitLine finalText={`Deaths to date: ${fmt(stats.deaths)}`} className="tabular-nums">
              Deaths to date: <span className="text-red"><CountUp value={stats.deaths} /></span>
            </FitLine>
            <span className="mt-3 block font-semibold tracking-[.12em] text-cream-dim text-2xl md:text-4xl">
              Still standing: <span className="text-cream tabular-nums">{fmt(stats.alive)}</span>
            </span>
          </span>
        </h1>
      ) : (
        <h1 className="mt-4 font-display text-5xl font-bold uppercase leading-[.95] md:text-7xl">
          One life. No respawns
        </h1>
      )}
      <p className="mt-6 max-w-xl font-sans text-lg leading-relaxed text-cream-dim">
        Every life on our servers is tracked to the minute — birth to death, across sessions.
        When you die, the ban is real and the record is permanent.
      </p>
      <div className="mt-7">
        <ClaimCta />
      </div>
    </section>
  );
}
```

If `text-cream`/`text-cream-dim`/`bg-red`/`hover:bg-red-deep` are not all valid tokens, check `tailwind.config.ts` for the exact names (cream/cream-dim exist — `ColdFork` used them; red/red-deep are core tokens). Do not invent new tokens.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @onelife/web test -- front-page && pnpm --filter @onelife/web test -- fit-line`
Expected: PASS. (Other suites in the file — TopSurvivors/SignInCta — untouched for now; Task 4 handles them.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/front-page/hero.tsx apps/web/src/components/front-page/front-page.test.tsx
git commit -m "feat(web): dark two-line ledger hero with in-hero CTA"
```

---

### Task 3: The Fallen (obituary wall) + Rules strip

**Files:**
- Create: `apps/web/src/components/front-page/fallen.tsx`
- Create: `apps/web/src/components/front-page/rules.tsx`
- Test: `apps/web/src/components/front-page/fallen.test.tsx`

**Interfaces:**
- Consumes: `ObituaryCard` type from `@/lib/types` (fields used: `slug`, `gamertag`, `map`, `headline`, `lede`, `timeAliveSeconds`); `mapLabel`, `formatDuration` from `@/components/player/format`.
- Produces: `Fallen({ rows }: { rows: ObituaryCard[] })` — renders NOTHING when `rows` is empty (the caller passes `[]` for failed fetches too); `Rules()` — static. Task 6 mounts both.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/components/front-page/fallen.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import type { ObituaryCard } from "@/lib/types";
import { Fallen } from "./fallen";
import { Rules } from "./rules";

const obit = (over: Partial<ObituaryCard>): ObituaryCard => ({
  slug: "yrjustbad-life-3", gamertag: "YrJustBad", map: "chernarusplus", mapSlug: "chernarus",
  lifeNumber: 3, headline: "Shot in the back on the Topolka dam", lede: "He had outlasted forty-one others.",
  tags: [], timeAliveSeconds: 112320, kills: 4, longestKillMeters: 210, cause: "pvp",
  deathAt: "2026-07-27T20:00:00Z", ...over,
});

describe("Fallen", () => {
  it("renders up to three obituary cards linking to their articles", () => {
    render(<Fallen rows={[obit({}), obit({ slug: "b", gamertag: "Khushie" }), obit({ slug: "c", gamertag: "Un4givn" }), obit({ slug: "d", gamertag: "Fourth" })]} />);
    expect(screen.getByRole("heading", { name: /The Fallen/i })).toBeInTheDocument();
    const cards = screen.getAllByRole("link", { name: /Shot in the back/ });
    expect(cards).toHaveLength(3); // capped at 3
    expect(cards[0]).toHaveAttribute("href", "/obituaries/yrjustbad-life-3");
    expect(screen.getByRole("link", { name: "All obituaries →" })).toHaveAttribute("href", "/obituaries");
    // Meta line: callsign + honest duration + map label.
    expect(screen.getByText("YrJustBad")).toBeInTheDocument();
    expect(screen.getByText(/31h 12m survived/)).toBeInTheDocument();
    expect(screen.getAllByText(/Obituary · Chernarus/i).length).toBeGreaterThan(0);
  });

  it("renders NOTHING when there are no rows — absent proof is silence, never an empty shell", () => {
    const { container } = render(<Fallen rows={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("Rules", () => {
  it("renders the three rules", () => {
    render(<Rules />);
    expect(screen.getByText("One life")).toBeInTheDocument();
    expect(screen.getByText("Death is real")).toBeInTheDocument();
    expect(screen.getByText("Earn your way back")).toBeInTheDocument();
  });
});
```

(`formatDuration(112320)` — verify its output format in `@/components/player/format`; the repo renders durations as `31h 12m`. If it differs, match the test to the real helper, not the other way round.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @onelife/web test -- fallen`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

```tsx
// apps/web/src/components/front-page/fallen.tsx
import Link from "next/link";
import type { ObituaryCard } from "@/lib/types";
import { mapLabel, formatDuration } from "@/components/player/format";

/**
 * Beat 2 — the obituary wall (cold-home-relaunch spec §2). Proof that deaths here are events
 * with an audience. ⚠️ Empty rows (failed fetch OR genuinely no obituaries) render NOTHING —
 * a pitch page never shows an empty morgue or an error card; absent proof is silence.
 */
export function Fallen({ rows }: { rows: ObituaryCard[] }) {
  if (rows.length === 0) return null;
  const shown = rows.slice(0, 3);
  return (
    <section aria-label="Recent obituaries" className="px-6 py-9 md:px-10">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-2xl font-bold uppercase">
          The <span className="text-red">Fallen</span>
        </h2>
        <Link href="/obituaries" className="font-mono text-[11px] uppercase tracking-[.08em] text-ink-muted hover:text-red">
          All obituaries →
        </Link>
      </div>
      <ul role="list" className="mt-5 grid gap-4 md:grid-cols-3">
        {shown.map((o) => (
          <li key={o.slug} className="relative border border-hairline border-t-[3px] border-t-ink bg-white">
            <Link href={`/obituaries/${o.slug}`} className="block p-4">
              <p className="font-mono text-[10px] uppercase tracking-[.12em] text-red-deep">
                Obituary · {mapLabel(o.map)}
              </p>
              <h3 className="mt-2 font-display text-lg font-semibold leading-snug">{o.headline}</h3>
              <p className="mt-2 line-clamp-2 font-sans text-sm italic leading-relaxed text-ink-soft">
                {o.lede}
              </p>
              <p className="mt-3 flex justify-between border-t border-hairline pt-2.5 font-mono text-[10px] uppercase tracking-[.06em] text-ink-muted">
                <span>{o.gamertag}</span>
                <span>{formatDuration(o.timeAliveSeconds)} survived</span>
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

```tsx
// apps/web/src/components/front-page/rules.tsx
/** Beat 3 — the rules of the game (cold-home-relaunch spec §2). Static copy; the missing
 *  "how it works" a cold visitor needs before the CTA lands. */
const RULES = [
  { n: "Rule 01", title: "One life", body: "Your survival is tracked to the minute, across every session. The record is public and permanent." },
  { n: "Rule 02", title: "Death is real", body: "Die and you are banned from that server for 24 hours. No respawns. No exceptions." },
  { n: "Rule 03", title: "Earn your way back", body: "Unban tokens buy you back in early. Earn them by verifying, surviving, and recruiting. Spend them wisely." },
] as const;

export function Rules() {
  return (
    <section aria-label="The rules" className="grid border-y-[3px] border-ink bg-bone md:grid-cols-3">
      {RULES.map((r) => (
        <div key={r.n} className="border-b border-hairline p-6 last:border-b-0 md:border-b-0 md:border-r md:last:border-r-0">
          <p className="font-mono text-[10px] uppercase tracking-[.2em] text-red-deep">{r.n}</p>
          <h3 className="mt-1.5 font-display text-xl font-bold uppercase">{r.title}</h3>
          <p className="mt-2 font-sans text-sm leading-relaxed text-ink-soft">{r.body}</p>
        </div>
      ))}
    </section>
  );
}
```

If `line-clamp-2` isn't available (Tailwind < 3.3 or plugin-gated), check `tailwind.config.ts`; fall back to a manual `overflow-hidden` + `display:-webkit-box` inline style.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @onelife/web test -- fallen`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/front-page/fallen.tsx apps/web/src/components/front-page/rules.tsx apps/web/src/components/front-page/fallen.test.tsx
git commit -m "feat(web): obituary wall + rules strip for the cold home"
```

---

### Task 4: CTA slab; delete ColdFork + TopSurvivors

**Files:**
- Create: `apps/web/src/components/front-page/cta-slab.tsx`
- Delete: `apps/web/src/components/front-page/cold-fork.tsx`, `apps/web/src/components/front-page/top-survivors.tsx`
- Test: `apps/web/src/components/front-page/cta-slab.test.tsx`; Modify `front-page.test.tsx` (drop the TopSurvivors describe)

**Interfaces:**
- Consumes: `ClaimCta` from `./hero` (Task 2), `HowToConnect`/`ServersView` from `@/components/servers/how-to-connect` (existing `onDark` prop), `useAccountStatus` from `@/lib/use-account-status`.
- Produces: `CtaSlab({ servers }: { servers: ServersView })` — renders for `accountStatus.kind === "signedOut"` only, nothing otherwise (including `loading`, so a signed-in visitor never sees a pitch flash — same rule ColdFork had). Task 6 mounts it.

⚠️ Before deleting `top-survivors.tsx`, run `grep -rn "TopSurvivors" apps/web/src` — as of planning, its only consumers are the home page and its own test. If a new consumer appeared, stop and report instead of deleting.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/components/front-page/cta-slab.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { CtaSlab } from "./cta-slab";

const mockStatus = vi.fn();
vi.mock("@/lib/use-account-status", () => ({ useAccountStatus: () => mockStatus() }));

const servers = { kind: "ready", names: ["Chernarus", "Sakhal", "Livonia"] } as const;

describe("CtaSlab", () => {
  it("renders the ask, the CTA and the dark connect panel for signed-out visitors", () => {
    mockStatus.mockReturnValue({ kind: "signedOut" });
    render(<CtaSlab servers={servers} />);
    expect(screen.getByText(/You get one life\./i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Claim your life →" })).toHaveAttribute("href", "/login");
    expect(screen.getByText(/Sign in · Link your gamertag · Your life shows up here/i)).toBeInTheDocument();
    // The connect box reuses HowToConnect (onDark) — search term + map list present.
    expect(screen.getByText("One Life")).toBeInTheDocument();
    expect(screen.getByText(/Chernarus, Sakhal, Livonia/)).toBeInTheDocument();
    expect(screen.getByText(/Play first, claim later/i)).toBeInTheDocument();
  });

  it.each(["loading", "unlinked", "pending", "verified"] as const)(
    "renders nothing for %s",
    (kind) => {
      mockStatus.mockReturnValue(kind === "verified" ? { kind, link: { gamertag: "X" } } : { kind });
      const { container } = render(<CtaSlab servers={servers} />);
      expect(container).toBeEmptyDOMElement();
    },
  );
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @onelife/web test -- cta-slab`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement, and delete the two retired components**

```tsx
// apps/web/src/components/front-page/cta-slab.tsx
"use client";
import { useAccountStatus } from "@/lib/use-account-status";
import { HowToConnect, type ServersView } from "@/components/servers/how-to-connect";
import { ClaimCta } from "./hero";

/**
 * Beat 4 — the CTA slab (cold-home-relaunch spec §2). Replaces ColdFork: ONE ask, twice
 * answered — sign in, or play first via the server browser. Renders for `signedOut` only —
 * unlinked/pending get the claim ladder instead, and nothing renders while identity resolves
 * so a signed-in player never sees a sign-in pitch flash (ColdFork's rule, retained).
 */
export function CtaSlab({ servers }: { servers: ServersView }) {
  const status = useAccountStatus();
  if (status.kind !== "signedOut") return null;

  return (
    <section aria-label="Claim your life" className="bg-dark px-6 py-12 text-center text-cream md:px-10 md:py-14">
      <h2 className="font-display text-4xl font-bold uppercase leading-none md:text-5xl">
        You get one life. <span className="text-red">Claim it</span>
      </h2>
      <p className="mt-3 font-mono text-xs uppercase tracking-[.1em] text-cream-dim">
        Sign in · Link your gamertag · Your life shows up here
      </p>
      <div className="mt-7">
        <ClaimCta large />
      </div>
      <div className="mx-auto mt-9 max-w-lg border border-dark-line bg-dark-well p-5 text-left">
        <p className="font-mono text-[10.5px] uppercase tracking-[.16em] text-cream-dim">
          Play first, claim later — no account needed to play
        </p>
        <div className="mt-3">
          <HowToConnect servers={servers} onDark />
        </div>
      </div>
    </section>
  );
}
```

(`bg-dark-well`/`border-dark-line` are the named controls-dark tokens; verify exact names in `tailwind.config.ts` — the controls surfaces use `dark-well`/`dark-edge`. Use whichever exist; NO raw hexes, that's grep-gated.)

Then:

```bash
git rm apps/web/src/components/front-page/cold-fork.tsx apps/web/src/components/front-page/top-survivors.tsx
```

and remove the `TopSurvivors` describe + import from `front-page.test.tsx` (the `SignInCta` describe stays — `/about` still uses it).

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @onelife/web test -- cta-slab && pnpm --filter @onelife/web test -- front-page`
Expected: PASS. (The page still imports ColdFork/TopSurvivors — the web build/typecheck will fail until Task 6; that's expected mid-branch. Do NOT run typecheck as part of this task's gate.)

- [ ] **Step 5: Commit**

```bash
git add -A apps/web/src/components/front-page
git commit -m "feat(web): CTA slab; retire ColdFork and TopSurvivors"
```

---

### Task 5: `HomeShell` — verified-only sidebar

**Files:**
- Create: `apps/web/src/components/account/home-shell.tsx`
- Test: `apps/web/src/components/account/home-shell.test.tsx`

**Interfaces:**
- Consumes: `useAccountStatus`; `HomeSidebar`, `SidebarBoard` from `./home-sidebar` (unchanged).
- Produces: `HomeShell({ board, children }: { board: SidebarBoard | null; children: React.ReactNode })` — children are the main column. Verified → xl two-column grid (`xl:grid xl:grid-cols-[minmax(0,1fr)_380px]`, main keeps `xl:border-r xl:border-ink xl:pr-8`) + `HomeSidebar`; every other state → single column, no sidebar in the DOM. Task 6 wraps the page in it.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/components/account/home-shell.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { HomeShell } from "./home-shell";

const mockStatus = vi.fn();
vi.mock("@/lib/use-account-status", () => ({ useAccountStatus: () => mockStatus() }));
// The sidebar itself is not under test — and it drags in query hooks. Stub it.
vi.mock("./home-sidebar", () => ({ HomeSidebar: () => <aside data-testid="sidebar" /> }));

describe("HomeShell", () => {
  it("mounts the sidebar and grid for verified users", () => {
    mockStatus.mockReturnValue({ kind: "verified", link: { gamertag: "X" } });
    render(<HomeShell board={null}><p>main</p></HomeShell>);
    expect(screen.getByTestId("sidebar")).toBeInTheDocument();
  });

  it.each(["loading", "signedOut", "unlinked", "pending"] as const)(
    "renders a single column with NO sidebar in the DOM for %s",
    (kind) => {
      mockStatus.mockReturnValue({ kind });
      render(<HomeShell board={null}><p>main</p></HomeShell>);
      expect(screen.getByText("main")).toBeInTheDocument();
      expect(screen.queryByTestId("sidebar")).not.toBeInTheDocument();
    },
  );
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @onelife/web test -- home-shell`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// apps/web/src/components/account/home-shell.tsx
"use client";
import { useAccountStatus } from "@/lib/use-account-status";
import { HomeSidebar, type SidebarBoard } from "./home-sidebar";

/**
 * Home's column layout, gated client-side on VERIFIED (cold-home-relaunch spec §3): the xl
 * sidebar is signed-in glance material (friends, standing, notifications), so signedOut/
 * unlinked/pending/loading get a single centered column with no sidebar in the DOM at all.
 * The server cannot distinguish verified from a cookie, so SSR renders the single column and a
 * verified visitor gains the sidebar at hydration — acceptable for xl-only glance content.
 * ⚠️ Nothing actionable may live only in the sidebar (unchanged invariant).
 */
export function HomeShell({ board, children }: { board: SidebarBoard | null; children: React.ReactNode }) {
  const status = useAccountStatus();
  const verified = status.kind === "verified";

  if (!verified) {
    return <main className="mx-auto w-full min-w-0 max-w-5xl">{children}</main>;
  }
  return (
    <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_380px]">
      <main className="mx-auto w-full min-w-0 max-w-5xl xl:border-r xl:border-ink xl:pr-8">
        {children}
      </main>
      <HomeSidebar board={board} />
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @onelife/web test -- home-shell`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/account/home-shell.tsx apps/web/src/components/account/home-shell.test.tsx
git commit -m "feat(web): HomeShell — sidebar becomes verified-only"
```

---

### Task 6: Page rewiring

**Files:**
- Modify: `apps/web/src/app/(site)/(boxed)/page.tsx` (full rewrite, code below)
- Test: `apps/web/src/app/(site)/(boxed)/page.test.tsx` (adjust mocks + add gating tests)

**Interfaces:**
- Consumes: everything above — `Hero`, `Fallen`, `Rules`, `CtaSlab`, `HomeShell`; plus existing `getObituariesFeed` from `@/lib/api` (already exists — `getObituariesFeed(1)`), `settleFeed`, `serversView`, `resolveDestinationFrom`, `AccountPanels`.
- Produces: the final page. Fetch gating contract (pinned by tests): signed OUT → stats + obituaries fetched, survivors NOT; signed IN → survivors fetched, stats + obituaries NOT.

- [ ] **Step 1: Rewrite the page**

```tsx
import { cookies } from "next/headers";
import { getServers, getSurvivors, getSiteStats, getObituariesFeed } from "@/lib/api";
import { settleFeed } from "@/lib/settle-feed";
import { Hero } from "@/components/front-page/hero";
import { Fallen } from "@/components/front-page/fallen";
import { Rules } from "@/components/front-page/rules";
import { CtaSlab } from "@/components/front-page/cta-slab";
import { serversView } from "@/components/servers/how-to-connect";
import { resolveDestinationFrom } from "@/lib/resolve-destination";
import { AccountPanels } from "@/components/account/account-panels";
import { HomeShell } from "@/components/account/home-shell";

/**
 * The home page (cold-home-relaunch spec). ⚠️ THE PITCH IS FOR COLD VISITORS ONLY: signed-in
 * detection is session-COOKIE PRESENCE (zero latency, no hydration flash); a stale cookie
 * over-detects and `AccountPanels`' signInFallback covers it.
 *
 * Fetch gating (each its own settleFeed — feeds degrade independently):
 * - stats + obituaries feed ONLY the cold pitch → fetched ONLY when signed out. Do NOT make
 *   either unconditional: getSiteStats runs a fleet-wide COUNT + getAliveSurvivors (whole kills
 *   table), and the obituaries feed is another page-1 query nobody signed-in sees.
 * - survivors + board resolution feed ONLY the verified sidebar → fetched ONLY when signed in.
 * Both promise sets are kicked off before the servers await so they run concurrently;
 * settleFeed never rejects, so un-awaited promises cannot produce unhandled rejections.
 */
export default async function Home() {
  const cookieStore = await cookies();
  const signedIn = cookieStore.getAll().some((c) => c.name.includes("session_token"));

  const statsPromise = signedIn ? null : settleFeed(getSiteStats());
  const obitsPromise = signedIn ? null : settleFeed(getObituariesFeed(1));

  const servers = await settleFeed(getServers());

  // Sidebar board (verified xl glance) — its only remaining consumer is signed-in.
  const boardSlug = signedIn ? await resolveDestinationFrom(servers.data) : null;
  const boardServer = boardSlug ? servers.data?.find((s) => s.slug === boardSlug) ?? null : null;
  const survivors = boardSlug
    ? await settleFeed(getSurvivors({ slug: boardSlug, page: 1 }))
    : { data: null, failed: false };

  const stats = statsPromise ? await statsPromise : { data: null, failed: false };
  const obits = obitsPromise ? await obitsPromise : { data: null, failed: false };

  return (
    <HomeShell
      board={
        boardSlug && boardServer
          ? { slug: boardSlug, map: boardServer.map, rows: survivors.data?.rows.slice(0, 3) ?? [], failed: survivors.failed }
          : null
      }
    >
      {!signedIn && (
        <>
          <Hero stats={stats.data} />
          {/* Failed OR empty → [] → Fallen renders nothing (absent proof is silence). */}
          <Fallen rows={obits.data?.rows ?? []} />
          <Rules />
          <CtaSlab servers={serversView(servers.data, { failed: servers.failed })} />
        </>
      )}
      <div className="px-6 py-8 md:px-10">
        <AccountPanels signInFallback={signedIn} />
      </div>
    </HomeShell>
  );
}
```

(`FeedFailedBanner` is deleted with the board strip — the failure it reported no longer renders on the cold home.)

- [ ] **Step 2: Update `page.test.tsx`**

Open the existing file and adapt: add `getObituariesFeed: vi.fn()` to the `@/lib/api` mock (default it to `mockRejectedValue(new Error("no feed"))` in `beforeEach`, matching the `getSiteStats` pattern) and stub `@/components/account/home-shell` is NOT needed — `HomeShell` is a client component; jsdom rendering of the RSC output follows the file's existing pattern (it already renders `Home()`; `useAccountStatus` is presumably mocked — follow the file's existing mocks). Add these tests:

```tsx
it("signed out: fetches stats and obituaries, never survivors", async () => {
  // follow the file's existing signed-out cookie mock pattern
  render(await Home());
  expect(getSiteStats).toHaveBeenCalled();
  expect(getObituariesFeed).toHaveBeenCalledWith(1);
  expect(getSurvivors).not.toHaveBeenCalled();
});

it("signed in: fetches survivors, never stats or obituaries", async () => {
  // follow the file's existing signed-in cookie mock pattern
  render(await Home());
  expect(getSurvivors).toHaveBeenCalled();
  expect(getSiteStats).not.toHaveBeenCalled();
  expect(getObituariesFeed).not.toHaveBeenCalled();
});

it("a resolved obituaries feed renders the Fallen wall", async () => {
  (getObituariesFeed as Mock).mockResolvedValue({
    rows: [{
      slug: "yrjustbad-life-3", gamertag: "YrJustBad", map: "chernarusplus", mapSlug: "chernarus",
      lifeNumber: 3, headline: "Shot in the back on the Topolka dam", lede: "He had outlasted forty-one others.",
      tags: [], timeAliveSeconds: 112320, kills: 4, longestKillMeters: 210, cause: "pvp",
      deathAt: "2026-07-27T20:00:00Z",
    }],
    total: 1, page: 1, pageSize: 12,
  });
  render(await Home());
  expect(screen.getByRole("heading", { name: /The Fallen/i })).toBeInTheDocument();
});

it("a failed obituaries feed renders no Fallen section and no error card", async () => {
  render(await Home()); // beforeEach default: rejected
  expect(screen.queryByRole("heading", { name: /The Fallen/i })).not.toBeInTheDocument();
});
```

Adjust any existing tests that asserted the board strip / ColdFork / FeedFailedBanner on the cold home — those assertions now invert (strip gone, slab present). Keep the existing ledger + evergreen-fallback page tests (they still hold).

- [ ] **Step 3: Run the page + full web suite**

Run: `pnpm --filter @onelife/web test -- page && pnpm --filter @onelife/web test && pnpm --filter @onelife/web typecheck`
Expected: all green (typecheck now passes again — the dangling ColdFork/TopSurvivors imports are gone).

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(site)/(boxed)/page.tsx" "apps/web/src/app/(site)/(boxed)/page.test.tsx"
git commit -m "feat(web): rewire home — four-beat cold pitch, gated fetches, verified-only sidebar"
```

---

### Task 7: Changelog, CLAUDE.md, full verification

**Files:**
- Modify: `CHANGELOG.md` (Unreleased), `CLAUDE.md` (amend the cold-home ledger entry)

- [ ] **Step 1: Changelog entry** (match existing format, under `## [Unreleased]`):

```markdown
### Changed

- The signed-out home page is a full pitch now: a dark full-width two-line ledger headline
  ("DEATHS TO DATE" / "STILL STANDING", no trailing periods) with the claim button right in the
  hero, a wall of recent obituaries, the three rules of the game, and one closing call-to-action
  with the server-browser instructions. The top-5 board strip and the old two-cell sign-in fork
  are gone, and the desktop sidebar now appears only for verified players.
```

- [ ] **Step 2: CLAUDE.md** — amend the "Cold-home ledger hero" entry: the hero is now DARK
  with the two-line no-trailing-periods headline via `FitLine` (hidden-clone measurement, final
  string, jsdom-safe 0-width guard); the cold home is the four-beat pitch (hero → `Fallen` →
  `Rules` → `CtaSlab`); `ColdFork`/`TopSurvivors` are RETIRED (do not reintroduce); the Fallen
  section renders NOTHING on failed OR empty feed; fetch gating is two-directional (stats+obits
  cold-only, survivors signed-in-only); `HomeSidebar` is verified-only via `HomeShell`. Keep it
  to one tight paragraph appended to the existing entry.

- [ ] **Step 3: Full suite + typecheck**

Run: `pnpm turbo run test --concurrency=1 && pnpm turbo run typecheck` (repo root, `TEST_DATABASE_URL` exported)
Expected: 22/22 green both.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md CLAUDE.md
git commit -m "docs: changelog + CLAUDE.md for the cold-home relaunch"
```

---

## Post-plan notes (not tasks)

- **Deploy:** plain `./deploy/deploy.sh`, no `--rebuild`, no env vars.
- **Browser checklist (pre-release, real Chrome — jsdom cannot verify any of these):** headline fills the container width at xl and at phone widths (FitLine); count-up still lands exactly; obituary wall at 1, 2 and 3 cards; dark `HowToConnect` legibility in the slab; verified account still gets the sidebar at xl; single column centers for cold visitors.
- **PR** via keel:finish-work.
