# R1 Tabloid Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flip `apps/web` to the "Clean Glossy" tabloid design system (brand bible) and ship the new shell: masthead + 5-item nav, footer, front-page shell, About page, teaser pages, restyled status banner, and OG/favicon sync — with every existing surface staying legible via a compat token remap.

**Architecture:** One light theme driven by CSS-variable tokens (RGB triples consumed as `rgb(var(--x) / <alpha-value>)` in Tailwind, so opacity modifiers keep working). Legacy token *names* stay defined but re-point at new palette values so unrebuilt surfaces (survivors, player, account, login) flip automatically. New chrome (masthead/footer/pages) is built fresh; small shared "tabloid primitives" (kicker, section header, skew CTA) carry the signature devices.

**Tech Stack:** Next.js 15 App Router, React 19, Tailwind v3, `next/font/google` (Oswald, IBM Plex Mono), Vitest 2 + Testing Library, TanStack Query (unchanged).

**Spec:** `docs/superpowers/specs/2026-07-16-tabloid-redesign-design.md`

## Global Constraints

- **Palette (exact hexes, brand bible §10.2):** Paper `#FBFAF2`, Ink `#111111`, Red `#FF1E12`, Yellow `#FFE300`, Blue `#1552D8`, Bone `#EEF0DD`, Dark `#0C0C08`. Canvas neutrals: hairline `#D8D6C6`, hairline-2 `#E4E2D4`, archive `#F4F2E6`, dark-line `#26261C`, dashed `#B9B7A8`, ink-soft `#333333`, ink-muted `#666666`, cream-muted `#8A8878`, cream-dim `#C9C7BC`, red-soft `#FF6B63`, discord `#5865F2`.
- **Semantics:** red = death/breaking, yellow = drama/pending, blue = birth/alive. Yellow surfaces take ink text only, never white.
- **Type roles:** Oswald = headlines/nav/chips/buttons (uppercase); IBM Plex Mono = datelines/labels/stats/footers; Helvetica Neue system stack = body prose. Anton appears only inside raster wordmark assets.
- **Voice (brand bible §6):** deadpan, no exclamation points in prose, no emoji, no "RIP"/sincere grief clichés, never explain the joke. Copy in this plan is final unless a step says otherwise.
- **Assets source of truth:** `/Users/steveharmeyer/Development/dayz-one-life/brand` (sibling repo). The web app vendors copies; never edit assets in place here.
- **Workflow:** all commits on `feature/tabloid-shell`. Test: `pnpm turbo run test --concurrency=1` (web-only iteration: `pnpm --filter web test`). Typecheck: `pnpm turbo run typecheck`.
- **Legacy tokens** (`--bg --panel --panel-2 --line --bone --dim --muted --wash --amber --blood --steel`, `font-hand`) are compat shims — keep them working until R3 removes their last consumers. Do not use them in NEW components; new code uses the new token names only.
- **Test files import vitest APIs explicitly** (`import { describe, it, expect, vi } from "vitest"` — only the names used). The tsconfig does not load vitest globals types; relying on globals fails `pnpm turbo run typecheck --filter=@onelife/web`.

---

### Task 1: Vendor brand assets (wordmarks, favicons)

**Files:**
- Create: `apps/web/public/brand/wordmark-primary@1x.png`, `apps/web/public/brand/wordmark-primary@2x.png`, `apps/web/public/brand/wordmark-primary@3x.png`, `apps/web/public/brand/wordmark-onred@2x.png` (copied)
- Create: `apps/web/src/app/favicon.ico`, `apps/web/src/app/icon.png`, `apps/web/src/app/apple-icon.png` (copied)

**Interfaces:**
- Produces: `/brand/wordmark-primary@2x.png` public URL consumed by Task 4 (masthead) and Task 9 (OG uses a co-located copy). Next serves `favicon.ico`/`icon.png`/`apple-icon.png` automatically via App Router file conventions.

- [ ] **Step 1: Copy assets from the brand repo**

```bash
cd /Users/steveharmeyer/Development/dayz-one-life/one-life
mkdir -p apps/web/public/brand
cp ../brand/assets/logo/wordmark/wordmark-primary@1x.png apps/web/public/brand/
cp ../brand/assets/logo/wordmark/wordmark-primary@2x.png apps/web/public/brand/
cp ../brand/assets/logo/wordmark/wordmark-primary@3x.png apps/web/public/brand/
cp ../brand/assets/logo/wordmark/wordmark-onred@2x.png apps/web/public/brand/
cp ../brand/assets/logo/favicon/favicon.ico apps/web/src/app/favicon.ico
cp ../brand/assets/logo/favicon/favicon-192.png apps/web/src/app/icon.png
cp ../brand/assets/logo/favicon/favicon-180.png apps/web/src/app/apple-icon.png
```

- [ ] **Step 2: Verify the files landed**

Run: `ls apps/web/public/brand apps/web/src/app/favicon.ico apps/web/src/app/icon.png apps/web/src/app/apple-icon.png`
Expected: all seven files listed, no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/public/brand apps/web/src/app/favicon.ico apps/web/src/app/icon.png apps/web/src/app/apple-icon.png
git commit -m "feat(web): vendor brand wordmarks + favicon kit from brand repo"
```

---

### Task 2: Design tokens, fonts, theme flip + compat remap

**Files:**
- Modify: `apps/web/src/app/globals.css` (full rewrite)
- Modify: `apps/web/tailwind.config.ts` (full rewrite)
- Modify: `apps/web/src/app/fonts.ts` (full rewrite)
- Modify: `apps/web/src/app/layout.tsx:18` (html className)
- Modify: `apps/web/src/components/survivors/map-badge.tsx`, `apps/web/src/components/player/player-hero.tsx`, `apps/web/src/components/player/standing-card.tsx`, `apps/web/src/components/player/past-life-card.tsx` (raw-color sweep)
- Delete: `apps/web/src/app/fonts/AnimalsAreLikePeople.ttf`, `apps/web/src/app/fonts/PatrickHand-Regular.ttf`

**Interfaces:**
- Produces: Tailwind color utilities `paper ink red yellow blue tint dark hairline hairline-2 archive dark-line dash ink-soft ink-muted cream-muted cream-dim red-soft discord` (all alpha-capable); font utilities `font-display` (Oswald), `font-mono` (IBM Plex Mono), `font-sans` (Helvetica stack), `font-hand` (shim → mono). Legacy color names still compile.
- Consumes: nothing from other tasks.

- [ ] **Step 1: Rewrite `apps/web/src/app/globals.css`**

Note: `tint` is the brand's "Bone" surface `#EEF0DD` — it can't be named `bone` yet because the legacy `--bone` alias (primary *text* color on the old dark theme) must re-point at ink to keep old `text-bone` usages legible. Rename `tint` → `bone` in the R3 cleanup.

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  /* Brand palette (brand bible §10.2) — RGB triples for rgb(var() / alpha) */
  --paper: 251 250 242;      /* #FBFAF2 */
  --ink: 17 17 17;           /* #111111 */
  --red: 255 30 18;          /* #FF1E12 — death / breaking */
  --yellow: 255 227 0;       /* #FFE300 — drama / pending; ink text only */
  --blue: 21 82 216;         /* #1552D8 — birth / alive */
  --tint: 238 240 221;       /* #EEF0DD — brand "Bone" surface (see note) */
  --dark: 12 12 8;           /* #0C0C08 — masthead/footer/panels */

  /* Canvas neutrals */
  --hairline: 216 214 198;   /* #D8D6C6 row rules */
  --hairline-2: 228 226 212; /* #E4E2D4 lighter rules */
  --archive: 244 242 230;    /* #F4F2E6 past-life card bg */
  --dark-line: 38 38 28;     /* #26261C hairline on dark */
  --dash: 185 183 168;       /* #B9B7A8 dashed borders / pagination ("dash", not "dashed" — avoids colliding with Tailwind's border-dashed style utility) */
  --ink-soft: 51 51 51;      /* #333 body-on-paper */
  --ink-muted: 102 102 102;  /* #666 muted-on-paper */
  --cream-muted: 138 136 120;/* #8A8878 muted-on-dark */
  --cream-dim: 201 199 188;  /* #C9C7BC dim-on-dark */
  --red-soft: 255 107 99;    /* #FF6B63 red lightened for dark bg */
  --discord: 88 101 242;     /* #5865F2 */

  /* Legacy aliases — re-pointed at the new palette so unrebuilt surfaces
     stay legible. DO NOT use in new code. Delete at the end of R3. */
  --bg: var(--paper);
  --panel: var(--tint);
  --panel-2: var(--archive);
  --line: var(--hairline);
  --bone: var(--ink);
  --dim: var(--ink-soft);
  --muted: var(--ink-muted);
  --wash: var(--tint);
  --amber: var(--red);
  --blood: var(--red);
  --steel: var(--blue);
}

body { background: rgb(var(--paper)); color: rgb(var(--ink)); }
```

- [ ] **Step 2: Rewrite `apps/web/tailwind.config.ts`**

```ts
import type { Config } from "tailwindcss";

const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Brand tokens — use these in all new code
        paper: v("paper"),
        ink: v("ink"),
        red: v("red"),
        yellow: v("yellow"),
        blue: v("blue"),
        tint: v("tint"),
        dark: v("dark"),
        hairline: v("hairline"),
        "hairline-2": v("hairline-2"),
        archive: v("archive"),
        "dark-line": v("dark-line"),
        dash: v("dash"),
        "ink-soft": v("ink-soft"),
        "ink-muted": v("ink-muted"),
        "cream-muted": v("cream-muted"),
        "cream-dim": v("cream-dim"),
        "red-soft": v("red-soft"),
        discord: v("discord"),
        // Legacy aliases — compat only, removed end of R3
        bg: v("bg"),
        panel: v("panel"),
        "panel-2": v("panel-2"),
        line: v("line"),
        bone: v("bone"),
        dim: v("dim"),
        muted: v("muted"),
        amber: v("amber"),
        blood: v("blood"),
        steel: v("steel"),
        wash: v("wash"),
      },
      fontFamily: {
        display: ["var(--font-display)", "Haettenschweiler", "Impact", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "Menlo", "monospace"],
        sans: ["'Helvetica Neue'", "Helvetica", "Arial", "sans-serif"],
        // Compat shim: old handwriting role folds into mono until R2 removes it
        hand: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
```

Note: Tailwind's `red` default scale is shadowed by our flat `red`. Classes like `red-500` stop existing — the sweep in Step 5 removes all of them. `darkMode: "class"` is gone (one theme).

- [ ] **Step 3: Rewrite `apps/web/src/app/fonts.ts` and update the layout**

```ts
import { Oswald, IBM_Plex_Mono } from "next/font/google";

export const display = Oswald({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

export const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  style: ["normal", "italic"],
  variable: "--font-mono",
  display: "swap",
});
```

In `apps/web/src/app/layout.tsx`, change the import and html line:

```tsx
import { display, mono } from "./fonts";
```

```tsx
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
```

(Removes the hard-coded `dark` class and the `hand` variable.)

Delete the old font binaries:

```bash
git rm apps/web/src/app/fonts/AnimalsAreLikePeople.ttf apps/web/src/app/fonts/PatrickHand-Regular.ttf
```

- [ ] **Step 4: Run the existing test suite to catch fallout**

Run: `pnpm --filter web test`
Expected: PASS. Existing tests assert class *names* (`font-hand`, `bg-amber`) which still compile via shims. If a test fails on a class name that no longer exists, that class appears in Step 5's sweep — fix there, not by re-adding legacy classes.

- [ ] **Step 5: Raw-color sweep (emerald → blue, red-shades → red)**

The old theme used raw Tailwind palette classes that are off-brand (and `red-500`-style classes no longer compile now that `red` is flat). Mapping rule — preserve the utility prefix and opacity modifier, replace the color:

| Old | New |
|---|---|
| `emerald-<any shade>` | `blue` |
| `red-500`, `red-400`, `red-300` | `red` |

Find every instance:

```bash
cd apps/web/src && grep -rn "emerald-\|red-500\|red-400\|red-300" .
```

Known sites (verify the grep finds exactly these files, plus any stragglers):
- `components/survivors/map-badge.tsx` (emerald)
- `components/player/player-hero.tsx` (emerald)
- `components/player/standing-card.tsx` (emerald + `border-red-500/40 bg-red-500/[0.06]` at line ~20, `bg-red-500/15 text-red-300` at line ~24)
- `components/player/past-life-card.tsx` (`bg-red-500/[0.05] … text-red-300/90` at line ~28)

Example (standing-card.tsx line ~20): `"border-red-500/40 bg-red-500/[0.06]"` → `"border-red/40 bg-red/[0.06]"`.

- [ ] **Step 6: Verify tests, typecheck, and grep-clean**

Run: `pnpm --filter web test && pnpm turbo run typecheck --filter=web && grep -rn "emerald-\|red-500\|red-400\|red-300\|darkMode" apps/web/src apps/web/tailwind.config.ts`
Expected: tests PASS, typecheck PASS, grep returns nothing.

- [ ] **Step 7: Visual smoke check**

Run: `pnpm --filter web dev` and load `/survivors`, `/players/<any>`, `/login`, `/account` in a browser.
Expected: light paper theme everywhere, all text legible (dark text on light surfaces), amber CTAs now red, no invisible text. Imperfect styling is fine — broken/illegible is not.

- [ ] **Step 8: Commit**

```bash
git add -A apps/web
git commit -m "feat(web): flip theme to Clean Glossy tabloid tokens; Oswald + IBM Plex Mono; legacy-token compat remap"
```

---

### Task 3: Tabloid primitives (Kicker, SectionHeader, SkewCta)

**Files:**
- Create: `apps/web/src/components/tabloid/kicker.tsx`
- Create: `apps/web/src/components/tabloid/section-header.tsx`
- Create: `apps/web/src/components/tabloid/skew-cta.tsx`
- Test: `apps/web/src/components/tabloid/tabloid.test.tsx`

**Interfaces:**
- Produces:
  - `Kicker({ children, color? }: { children: ReactNode; color?: "red" | "blue" | "yellow" | "ink" })` — eyebrow label, defaults red.
  - `SectionHeader({ title, action? }: { title: string; action?: ReactNode })` — h2 over a 3px ink rule with optional right-aligned action slot.
  - `SkewCta({ href?, onClick?, tone?, disabled?, children }: { href?: string; onClick?: () => void; tone?: "red" | "dark" | "discord"; disabled?: boolean; children: ReactNode })` — the −5° skewed CTA; renders `next/link` when `href` given, else `<button>`. Default tone `red`.
- Consumes: Tailwind tokens from Task 2.

(The design's other devices — rubber stamp, status chips, dateline — are deferred to their first consumer in R2/R3 per YAGNI.)

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/web/src/components/tabloid/tabloid.test.tsx
import { render, screen } from "@testing-library/react";
import { Kicker } from "./kicker";
import { SectionHeader } from "./section-header";
import { SkewCta } from "./skew-cta";

describe("Kicker", () => {
  it("renders red by default", () => {
    render(<Kicker>About the paper</Kicker>);
    const el = screen.getByText("About the paper");
    expect(el.className).toContain("text-red");
    expect(el.className).toContain("uppercase");
  });
  it("supports semantic colors", () => {
    render(<Kicker color="blue">Birth notices</Kicker>);
    expect(screen.getByText("Birth notices").className).toContain("text-blue");
  });
});

describe("SectionHeader", () => {
  it("renders an h2 and optional action", () => {
    render(<SectionHeader title="Still breathing" action={<a href="/survivors">ALL →</a>} />);
    expect(screen.getByRole("heading", { level: 2, name: "Still breathing" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ALL →" })).toBeInTheDocument();
  });
});

describe("SkewCta", () => {
  it("renders a link when href is given", () => {
    render(<SkewCta href="/login">Sign in →</SkewCta>);
    const link = screen.getByRole("link", { name: "Sign in →" });
    expect(link).toHaveAttribute("href", "/login");
    expect(link.className).toContain("bg-red");
  });
  it("renders a button with tone + disabled", () => {
    render(<SkewCta tone="dark" disabled>Send</SkewCta>);
    const btn = screen.getByRole("button", { name: "Send" });
    expect(btn).toBeDisabled();
    expect(btn.className).toContain("bg-dark");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web test -- tabloid`
Expected: FAIL — modules `./kicker` etc. not found.

- [ ] **Step 3: Implement the three components**

```tsx
// apps/web/src/components/tabloid/kicker.tsx
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const colors = { red: "text-red", blue: "text-blue", yellow: "text-yellow", ink: "text-ink" } as const;

export function Kicker({ children, color = "red" }: { children: ReactNode; color?: keyof typeof colors }) {
  return (
    <p className={cn("font-display text-sm font-bold uppercase tracking-[.14em]", colors[color])}>
      {children}
    </p>
  );
}
```

```tsx
// apps/web/src/components/tabloid/section-header.tsx
import type { ReactNode } from "react";

export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between border-b-[3px] border-ink pb-2">
      <h2 className="font-display text-2xl font-bold uppercase leading-none">{title}</h2>
      {action}
    </div>
  );
}
```

```tsx
// apps/web/src/components/tabloid/skew-cta.tsx
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const tones = {
  red: "bg-red text-paper",
  dark: "bg-dark text-paper",
  discord: "bg-discord text-paper",
} as const;

const base =
  "inline-block -skew-x-[5deg] px-5 py-2.5 font-display text-sm font-semibold uppercase tracking-[.06em] hover:opacity-90 disabled:opacity-50";

export function SkewCta({
  href, onClick, tone = "red", disabled, children,
}: {
  href?: string; onClick?: () => void; tone?: keyof typeof tones; disabled?: boolean; children: ReactNode;
}) {
  const className = cn(base, tones[tone]);
  if (href) return <Link href={href} className={className}>{children}</Link>;
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={className}>
      {children}
    </button>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web test -- tabloid`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/tabloid
git commit -m "feat(web): tabloid primitives — Kicker, SectionHeader, SkewCta"
```

---

### Task 4: Nav model + new masthead (desktop nav, mobile menu, restyled slot)

**Files:**
- Create: `apps/web/src/lib/nav.ts`
- Test: `apps/web/src/lib/nav.test.ts`
- Modify: `apps/web/src/components/header.tsx` (full rewrite)
- Modify: `apps/web/src/components/masthead-slot.tsx` (restyle)
- Modify: `apps/web/src/components/header.test.tsx` (full rewrite)

**Interfaces:**
- Consumes: `useAccountStatus()` from `@/lib/use-account-status` (unchanged), `/brand/wordmark-primary@2x.png` (Task 1).
- Produces: `NAV_ITEMS: readonly { key, href, label }[]`; `activeNavKey(pathname: string): NavKey | null`; `Masthead` (same export name — layout untouched); `MastheadSlot({ status })` (same signature, new look).

- [ ] **Step 1: Write the failing nav-helper test**

```ts
// apps/web/src/lib/nav.test.ts
import { activeNavKey, NAV_ITEMS } from "./nav";

describe("NAV_ITEMS", () => {
  it("is the five-section paper nav, in order", () => {
    expect(NAV_ITEMS.map((n) => n.label)).toEqual([
      "News", "Obituaries", "Fresh Spawns", "Survivors", "About",
    ]);
  });
});

describe("activeNavKey", () => {
  it.each([
    ["/", null],
    ["/news", "news"],
    ["/obituaries", "obituaries"],
    ["/fresh-spawns", "fresh-spawns"],
    ["/survivors", "survivors"],
    ["/survivors/sakhal/kills", "survivors"],
    ["/players/yrjustbad", "survivors"],
    ["/about", "about"],
    ["/account", null],
    ["/login", null],
  ])("%s → %s", (path, key) => {
    expect(activeNavKey(path)).toBe(key);
  });
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `pnpm --filter web test -- nav`
Expected: FAIL — `./nav` not found.

- [ ] **Step 3: Implement `apps/web/src/lib/nav.ts`**

```ts
export const NAV_ITEMS = [
  { key: "news", href: "/news", label: "News" },
  { key: "obituaries", href: "/obituaries", label: "Obituaries" },
  { key: "fresh-spawns", href: "/fresh-spawns", label: "Fresh Spawns" },
  { key: "survivors", href: "/survivors", label: "Survivors" },
  { key: "about", href: "/about", label: "About" },
] as const;

export type NavKey = (typeof NAV_ITEMS)[number]["key"];

/** Which nav item a pathname lights up. Player pages belong to the Survivors section. */
export function activeNavKey(pathname: string): NavKey | null {
  if (pathname.startsWith("/news")) return "news";
  if (pathname.startsWith("/obituaries")) return "obituaries";
  if (pathname.startsWith("/fresh-spawns")) return "fresh-spawns";
  if (pathname.startsWith("/survivors") || pathname.startsWith("/players")) return "survivors";
  if (pathname.startsWith("/about")) return "about";
  return null;
}
```

- [ ] **Step 4: Run nav tests to verify pass**

Run: `pnpm --filter web test -- nav`
Expected: PASS.

- [ ] **Step 5: Rewrite the masthead**

```tsx
// apps/web/src/components/header.tsx
"use client";
import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { useAccountStatus } from "@/lib/use-account-status";
import { NAV_ITEMS, activeNavKey } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { MastheadSlot } from "./masthead-slot";

function NavLinks({ active, onNavigate, className }: {
  active: string | null; onNavigate?: () => void; className?: string;
}) {
  return (
    <>
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          onClick={onNavigate}
          aria-current={active === item.key ? "page" : undefined}
          className={cn(active === item.key ? "text-red" : "text-paper hover:text-red", className)}
        >
          {item.label}
        </Link>
      ))}
    </>
  );
}

export function Masthead() {
  const status = useAccountStatus();
  const pathname = usePathname();
  const active = activeNavKey(pathname ?? "/");
  const [open, setOpen] = useState(false);

  return (
    <header className="bg-dark">
      <div className="relative flex items-center justify-center px-4 pt-5 md:pt-7">
        <button
          type="button"
          aria-label="Open menu"
          aria-expanded={open}
          onClick={() => setOpen(true)}
          className="absolute left-4 flex flex-col gap-[5px] p-2 md:hidden"
        >
          <span aria-hidden className="block h-[3px] w-6 bg-paper" />
          <span aria-hidden className="block h-[3px] w-6 bg-paper" />
          <span aria-hidden className="block h-[3px] w-4 bg-red" />
        </button>
        <Link href="/" aria-label="One Life — home">
          <img src="/brand/wordmark-primary@2x.png" alt="One Life" className="h-auto w-[150px] md:w-[280px]" />
        </Link>
        <div className="absolute right-4">
          <MastheadSlot status={status} />
        </div>
      </div>

      <nav
        aria-label="Primary"
        className="mt-4 hidden justify-center gap-9 border-t border-dark-line py-3 font-display text-[15px] font-semibold uppercase tracking-[.12em] md:flex"
      >
        <NavLinks active={active} />
      </nav>
      {/* Mobile masthead has no nav row; the hamburger opens the menu (design 10b). */}
      <div className="mt-4 border-t border-dark-line md:hidden" />

      {open && (
        <div className="fixed inset-0 z-50 flex flex-col items-center gap-8 bg-dark pt-24">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute right-5 top-5 p-2 font-display text-2xl text-paper"
          >
            <span aria-hidden>×</span>
          </button>
          <nav aria-label="Primary" className="flex flex-col items-center gap-8 font-display text-2xl font-semibold uppercase tracking-[.12em]">
            <NavLinks active={active} onNavigate={() => setOpen(false)} />
          </nav>
        </div>
      )}
    </header>
  );
}
```

- [ ] **Step 6: Restyle `apps/web/src/components/masthead-slot.tsx`**

Same signature and state logic; new classes for the dark bar:

```tsx
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { AccountStatus } from "@/lib/account-status";
import { playerSlug } from "@/lib/slug";

const cta = "font-mono text-xs font-bold uppercase tracking-[.06em] text-paper border-b-2 border-red hover:text-red";
const account = "font-mono text-xs uppercase tracking-[.06em] text-cream-dim hover:text-paper";

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
    return <Link href={`/players/${playerSlug(status.link.gamertag)}`} className={cta}>{status.link.gamertag}</Link>;
  }
  // unlinked | pending → quiet account link (the banner carries the primary action)
  return <Link href="/account" className={account}>Account</Link>;
}
```

- [ ] **Step 7: Rewrite `apps/web/src/components/header.test.tsx`**

Preserve whatever mocking pattern the current file uses for `@/lib/use-account-status` (read it first); the tests become:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { Masthead } from "./header";

const mockStatus = vi.fn();
vi.mock("@/lib/use-account-status", () => ({ useAccountStatus: () => mockStatus() }));
const mockPathname = vi.fn(() => "/survivors");
vi.mock("next/navigation", () => ({ usePathname: () => mockPathname() }));

describe("Masthead", () => {
  beforeEach(() => mockStatus.mockReturnValue({ kind: "signedOut" }));

  it("renders the wordmark home link and all five nav items", () => {
    render(<Masthead />);
    expect(screen.getByRole("link", { name: "One Life — home" })).toHaveAttribute("href", "/");
    for (const label of ["News", "Obituaries", "Fresh Spawns", "Survivors", "About"]) {
      expect(screen.getAllByRole("link", { name: label }).length).toBeGreaterThan(0);
    }
  });

  it("marks the active section with aria-current and red", () => {
    mockPathname.mockReturnValue("/survivors/sakhal");
    render(<Masthead />);
    const link = screen.getAllByRole("link", { name: "Survivors" })[0]!;
    expect(link).toHaveAttribute("aria-current", "page");
    expect(link.className).toContain("text-red");
  });

  it("shows the verified gamertag chip", () => {
    mockStatus.mockReturnValue({ kind: "verified", link: { gamertag: "YrJustBad" } });
    render(<Masthead />);
    expect(screen.getByRole("link", { name: "YrJustBad" }).className).toContain("border-red");
  });

  it("opens and closes the mobile menu", async () => {
    render(<Masthead />);
    await userEvent.click(screen.getByRole("button", { name: "Open menu" }));
    expect(screen.getByRole("button", { name: "Close menu" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close menu" }));
    expect(screen.queryByRole("button", { name: "Close menu" })).not.toBeInTheDocument();
  });
});
```

If the existing `header.test.tsx` mocks `useAccountStatus` differently (e.g. mocking the underlying hooks), keep its working pattern and port these four test cases onto it.

- [ ] **Step 8: Run the web suite**

Run: `pnpm --filter web test`
Expected: PASS. (`gamertag-link.test.tsx` still passes — `font-hand` shim exists.)

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/nav.ts apps/web/src/lib/nav.test.ts apps/web/src/components/header.tsx apps/web/src/components/header.test.tsx apps/web/src/components/masthead-slot.tsx
git commit -m "feat(web): tabloid masthead — dark bar, centered wordmark, 5-item nav, mobile menu"
```

---

### Task 5: Footer

**Files:**
- Modify: `apps/web/src/components/footer.tsx` (full rewrite)
- Test: `apps/web/src/components/footer.test.tsx` (new)

**Interfaces:**
- Produces: `Footer` (same export; layout untouched).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/components/footer.test.tsx
import { render, screen } from "@testing-library/react";
import { it, expect } from "vitest";
import { Footer } from "./footer";

it("renders the paper's colophon line on the dark bar", () => {
  render(<Footer />);
  const footer = screen.getByRole("contentinfo");
  expect(footer.className).toContain("bg-dark");
  expect(footer).toHaveTextContent(
    "One Life — a chronicle of the living and the dead. · Hardcore · 1PP · US servers",
  );
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `pnpm --filter web test -- footer`
Expected: FAIL — no `bg-dark`, wrong text.

- [ ] **Step 3: Rewrite the footer**

```tsx
// apps/web/src/components/footer.tsx
export function Footer() {
  return (
    <footer className="bg-dark px-10 py-[18px] text-center font-mono text-xs uppercase tracking-[.08em] text-paper">
      One Life — a chronicle of the living and the dead. · Hardcore · 1PP · US servers
    </footer>
  );
}
```

- [ ] **Step 4: Run it to verify pass, then commit**

Run: `pnpm --filter web test -- footer`
Expected: PASS.

```bash
git add apps/web/src/components/footer.tsx apps/web/src/components/footer.test.tsx
git commit -m "feat(web): dark mono footer per design"
```

---

### Task 6: Status banner restyle

**Files:**
- Modify: `apps/web/src/components/status-banner.tsx` (styles only; props/logic unchanged)
- Modify: `apps/web/src/components/status-banner.test.tsx` (update any class assertions)

**Interfaces:**
- Consumes: `SkewCta` (Task 3), tokens (Task 2).
- Produces: `StatusBanner` with the identical `StatusBannerProps` signature — `status-banner-container.tsx` must not change.

- [ ] **Step 1: Restyle the banner**

Rules (from design 14a's notice bar + 10d's pending panel, adapted to a light strip):
- Shell (invites): `border-y border-ink bg-tint px-6 py-4`.
- Shell (pending/expired verify): `border-y-2 border-yellow bg-tint px-6 py-4` (yellow = pending semantic).
- Titles: `font-display text-lg font-bold uppercase text-ink` (drop the `⚠` emoji spans entirely — a11y finding folded in).
- Subtitles: `font-sans text-[13px] text-ink-soft`.
- Primary actions (`Sign in →`, `Link gamertag →`, `Start a new challenge →`): replace the amber `<Link>`/`<button>` recipes with `<SkewCta href=…>` / `<SkewCta onClick=… disabled=…>` (tone red).
- Quiet action (`Cancel claim`): `font-mono text-xs uppercase text-ink-muted underline underline-offset-2 hover:text-red disabled:opacity-50`.
- Progress counter (`n / total DONE`): `font-mono text-[11px] font-bold tracking-[.06em] text-ink`.
- Expiry text: `font-mono text-xs text-ink-muted`.
- `EmoteChips` (10d's three-step treatment, `font-mono text-[12px] uppercase tracking-[.05em] px-2.5 py-1`):
  - done (`i < progressIndex`): `bg-ink text-paper` with the existing ✓ span (`text-paper`), no line-through;
  - current (`i === progressIndex`): `border-2 border-dashed border-ink font-bold text-ink`;
  - upcoming (`i > progressIndex`): `border border-dashed border-dash text-ink-muted` (style utility + `dash` color token).
  Keep the `data-done` attribute for tests.

The full rewritten `status-banner.tsx` — replace the styling constants and JSX classes, keeping every prop, branch, and text string except the `⚠` spans:

```tsx
import Link from "next/link";
import type { ReactNode } from "react";
import type { AccountStatus } from "@/lib/account-status";
import type { Challenge } from "@/lib/types";
import { formatExpiry } from "@/lib/format-expiry";
import { cn } from "@/lib/utils";
import { SkewCta } from "@/components/tabloid/skew-cta";

type StatusBannerProps = {
  status: AccountStatus;
  onCancel: () => void;
  onReclaim: () => void;
  canceling?: boolean;
  reclaiming?: boolean;
  now?: number;
};

const quietBtn =
  "font-mono text-xs uppercase text-ink-muted underline underline-offset-2 hover:text-red disabled:opacity-50";

function BannerShell({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "pending" }) {
  return (
    <div className={cn("px-6 py-4 bg-tint", tone === "pending" ? "border-y-2 border-yellow" : "border-y border-ink")}>
      {children}
    </div>
  );
}

function Invite({ title, subtitle, href, label }: { title: string; subtitle: string; href: string; label: string }) {
  return (
    <BannerShell>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-7">
        <div className="flex-1">
          <p className="font-display text-lg font-bold uppercase text-ink">{title}</p>
          <p className="mt-1 font-sans text-[13px] text-ink-soft">{subtitle}</p>
        </div>
        <SkewCta href={href}>{label}</SkewCta>
      </div>
    </BannerShell>
  );
}

function EmoteChips({ sequence, progressIndex }: { sequence: string[]; progressIndex: number }) {
  return (
    <ol className="flex flex-wrap gap-2">
      {sequence.map((emote, i) => {
        const done = i < progressIndex;
        const current = i === progressIndex;
        return (
          <li
            key={i}
            data-done={String(done)}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 font-mono text-[12px] uppercase tracking-[.05em]",
              done && "bg-ink text-paper",
              current && "border-2 border-dashed border-ink font-bold text-ink",
              !done && !current && "border border-dashed border-dash text-ink-muted",
            )}
          >
            {done && <span aria-hidden className="text-paper">✓</span>}
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
      <BannerShell tone="pending">
        <p className="font-display text-lg font-bold uppercase text-ink">Your verification for <span>{gamertag}</span> expired</p>
        <p className="mt-1 font-sans text-[13px] text-ink-soft">The emote challenge timed out. Start a fresh one and perform the new sequence in game.</p>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <SkewCta onClick={onReclaim} disabled={reclaiming}>Start a new challenge →</SkewCta>
          <button onClick={onCancel} disabled={canceling} className={quietBtn}>Cancel claim</button>
        </div>
      </BannerShell>
    );
  }
  return (
    <BannerShell tone="pending">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="font-display text-lg font-bold uppercase text-ink">Finish verifying <span>{gamertag}</span></p>
        <span className="font-mono text-[11px] font-bold tracking-[.06em] text-ink">{challenge.progressIndex} / {challenge.sequence.length} DONE</span>
      </div>
      <p className="mt-1 font-sans text-[13px] text-ink-soft">Log in to any One Life server and perform these emotes in order — we detect them automatically.</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <EmoteChips sequence={challenge.sequence} progressIndex={challenge.progressIndex} />
        <div className="flex items-center gap-4 sm:ml-auto">
          <span className="font-mono text-xs text-ink-muted">{formatExpiry(challenge.expiresAt, now)}</span>
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

- [ ] **Step 2: Run the banner tests; update assertions**

Run: `pnpm --filter web test -- status-banner`
Expected: text/role assertions pass; any assertion on removed classes (`bg-amber/20`, `⚠`) fails. Update those assertions to the new classes (`border-yellow` for pending shell, `bg-ink` for done chips); do not weaken behavioral assertions (labels, `data-done`, callbacks).

- [ ] **Step 3: Full web suite, then commit**

Run: `pnpm --filter web test`
Expected: PASS.

```bash
git add apps/web/src/components/status-banner.tsx apps/web/src/components/status-banner.test.tsx
git commit -m "feat(web): restyle status banner to tabloid notice bar; yellow pending semantic; 3-state emote chips"
```

---

### Task 7: Front page (hero, top survivors, sign-in CTA)

**Files:**
- Create: `apps/web/src/components/front-page/hero.tsx`
- Create: `apps/web/src/components/front-page/top-survivors.tsx`
- Create: `apps/web/src/components/front-page/signin-cta.tsx`
- Test: `apps/web/src/components/front-page/front-page.test.tsx`
- Modify: `apps/web/src/app/page.tsx` (full rewrite — becomes a server component)

**Interfaces:**
- Consumes: `Kicker`, `SectionHeader`, `SkewCta` (Task 3); `getSurvivors` from `@/lib/api` (`{ sort: "time", page: 1 }` → `SurvivorsPage` with `rows: SurvivorRow[]`); `formatTimeAlive` from `@/components/survivors/format`; `mapLabel` from `@/components/player/format`; `playerSlug` from `@/lib/slug`; `useAccountStatus`.
- Produces: `Hero()` (static server component), `TopSurvivors({ rows }: { rows: SurvivorRow[] })` (presentational), `SignInCta()` (client; renders null for `loading`/`verified`). Blocks are independent so R5 can swap `Hero` for the news hero without touching the others.

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/web/src/components/front-page/front-page.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import type { SurvivorRow } from "@/lib/types";
import { Hero } from "./hero";
import { TopSurvivors } from "./top-survivors";
import { SignInCta } from "./signin-cta";

const mockStatus = vi.fn();
vi.mock("@/lib/use-account-status", () => ({ useAccountStatus: () => mockStatus() }));

const row = (over: Partial<SurvivorRow>): SurvivorRow => ({
  gamertag: "YrJustBad", map: "sakhal", slug: "sakhal", timeAliveSeconds: 82440,
  killsThisLife: 2, longestKillMeters: 25, character: null, ...over,
});

describe("Hero", () => {
  it("runs the manifesto screamer with a kicker and About link", () => {
    render(<Hero />);
    expect(screen.getByText("The paper of record")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "One life. Then the obituary." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "How it works →" })).toHaveAttribute("href", "/about");
  });
});

describe("TopSurvivors", () => {
  it("ranks rows with gamertag links, map, and time alive", () => {
    render(<TopSurvivors rows={[row({}), row({ gamertag: "Khushie", map: "chernarusplus", timeAliveSeconds: 30300 })]} />);
    expect(screen.getByRole("link", { name: "YrJustBad" })).toHaveAttribute("href", "/players/yrjustbad");
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ALL →" })).toHaveAttribute("href", "/survivors");
  });
  it("shows the quiet-coast empty state", () => {
    render(<TopSurvivors rows={[]} />);
    expect(screen.getByText(/THE COAST IS QUIET/)).toBeInTheDocument();
  });
});

describe("SignInCta", () => {
  it("renders for signed-out visitors", () => {
    mockStatus.mockReturnValue({ kind: "signedOut" });
    render(<SignInCta />);
    expect(screen.getByText("Get in the paper.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in →" })).toHaveAttribute("href", "/login");
  });
  it("renders nothing for verified users", () => {
    mockStatus.mockReturnValue({ kind: "verified", link: { gamertag: "X" } });
    const { container } = render(<SignInCta />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter web test -- front-page`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the three blocks**

```tsx
// apps/web/src/components/front-page/hero.tsx
import Link from "next/link";
import { Kicker } from "@/components/tabloid/kicker";

export function Hero() {
  return (
    <section className="border-b-[3px] border-ink px-6 py-10 md:px-10 md:py-14">
      <Kicker>The paper of record</Kicker>
      <h1 className="mt-3 font-display text-5xl font-bold uppercase leading-[.95] md:text-7xl">
        One life. Then the obituary.
      </h1>
      <p className="mt-5 max-w-3xl font-sans text-lg leading-relaxed text-ink-soft">
        Hardcore permadeath DayZ, covered like celebrity scandal. One life per server; when it
        ends, the ban is real and the write-up is forever. The living are ranked below. The
        presses are warming up.
      </p>
      <Link
        href="/about"
        className="mt-6 inline-block border-b-2 border-red font-display text-sm font-semibold uppercase tracking-[.06em] text-ink hover:text-red"
      >
        How it works →
      </Link>
    </section>
  );
}
```

```tsx
// apps/web/src/components/front-page/top-survivors.tsx
import Link from "next/link";
import type { SurvivorRow } from "@/lib/types";
import { SectionHeader } from "@/components/tabloid/section-header";
import { formatTimeAlive } from "@/components/survivors/format";
import { mapLabel } from "@/components/player/format";
import { playerSlug } from "@/lib/slug";

export function TopSurvivors({ rows }: { rows: SurvivorRow[] }) {
  return (
    <section className="px-6 py-8 md:px-10">
      <SectionHeader
        title="Still breathing"
        action={
          <Link href="/survivors" className="font-mono text-xs font-bold uppercase tracking-[.06em] text-ink hover:text-red">
            ALL →
          </Link>
        }
      />
      {rows.length === 0 ? (
        <p className="py-6 font-mono text-sm uppercase tracking-[.05em] text-ink-muted">
          THE COAST IS QUIET. NO QUALIFIED SURVIVORS ON RECORD.
        </p>
      ) : (
        <ol>
          {rows.map((r, i) => (
            <li key={`${r.gamertag}-${r.slug}`} className="flex items-baseline gap-4 border-b border-hairline py-3">
              <span aria-hidden className="w-8 font-display text-xl font-bold text-red">{i + 1}</span>
              <Link
                href={`/players/${playerSlug(r.gamertag)}`}
                className="font-display text-lg font-bold uppercase text-ink hover:text-red"
              >
                {r.gamertag}
              </Link>
              <span className="font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">{mapLabel(r.map)}</span>
              <span className="ml-auto font-mono text-sm font-bold">{formatTimeAlive(r.timeAliveSeconds)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
```

```tsx
// apps/web/src/components/front-page/signin-cta.tsx
"use client";
import { useAccountStatus } from "@/lib/use-account-status";
import { SkewCta } from "@/components/tabloid/skew-cta";

export function SignInCta() {
  const status = useAccountStatus();
  if (status.kind === "loading" || status.kind === "verified") return null;
  return (
    <section className="mx-6 my-10 flex flex-col items-start gap-5 bg-dark p-7 md:mx-10 md:flex-row md:items-center">
      <div className="flex-1">
        <p className="font-display text-3xl font-bold uppercase leading-none text-paper">Get in the paper.</p>
        <p className="mt-2 font-mono text-xs tracking-[.04em] text-cream-muted">
          SIGN IN · LINK YOUR TAG · PERFORM THE EMOTES · TRY NOT TO DIE. FAIL.
        </p>
      </div>
      <SkewCta href="/login">Sign in →</SkewCta>
    </section>
  );
}
```

(Design shows a Discord-branded button; the login page renders only *configured* providers, so the front-page CTA stays provider-neutral red and defers to `/login`.)

- [ ] **Step 4: Rewrite `apps/web/src/app/page.tsx` as a server component**

```tsx
import { getSurvivors } from "@/lib/api";
import { Hero } from "@/components/front-page/hero";
import { TopSurvivors } from "@/components/front-page/top-survivors";
import { SignInCta } from "@/components/front-page/signin-cta";

export default async function Home() {
  const data = await getSurvivors({ sort: "time", page: 1 }).catch(() => null);
  return (
    <main className="mx-auto w-full max-w-5xl">
      <Hero />
      <TopSurvivors rows={data?.rows.slice(0, 5) ?? []} />
      <SignInCta />
    </main>
  );
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm --filter web test -- front-page`
Expected: PASS (5 tests).

- [ ] **Step 6: Visual check + commit**

Run: `pnpm --filter web dev`, load `/` — hero, ranked list (or quiet-coast line if DB empty), dark CTA band.

```bash
git add apps/web/src/components/front-page apps/web/src/app/page.tsx
git commit -m "feat(web): front-page shell — manifesto hero, top survivors, sign-in CTA"
```

---

### Task 8: About page

**Files:**
- Create: `apps/web/src/lib/server-blurbs.ts`
- Test: `apps/web/src/lib/server-blurbs.test.ts`
- Create: `apps/web/src/app/about/page.tsx`

**Interfaces:**
- Consumes: `getServers` from `@/lib/api` (→ `Server[]` with `map`, `slug`, `active`), `mapLabel` from `@/components/player/format`, `Kicker`, `SignInCta` (Task 7).
- Produces: `serverTagline(slug: string): string`, `formatOrList(items: string[]): string`, `countWord(n: number): string`.

- [ ] **Step 1: Write the failing helper tests**

```ts
// apps/web/src/lib/server-blurbs.test.ts
import { describe, it, expect } from "vitest";
import { serverTagline, formatOrList, countWord } from "./server-blurbs";

describe("serverTagline", () => {
  it("knows the shipped bureaus", () => {
    expect(serverTagline("chernarus")).toBe("THE CLASSIC. 230 KM² OF POOR JUDGMENT AND WORSE WEATHER.");
    expect(serverTagline("livonia")).toBe("WET, GREEN, QUIET. THE QUIET IS BAIT. THE WOLVES ARE ORGANIZED.");
    expect(serverTagline("sakhal")).toBe("VOLCANIC AND FROZEN AT ONCE. THE ISLAND KILLS MORE THAN THE PLAYERS.");
  });
  it("falls back for unknown bureaus", () => {
    expect(serverTagline("nasdara")).toBe("NEW BUREAU. THE DESK IS STILL WRITING THE INSULT.");
  });
});

describe("formatOrList", () => {
  it.each([
    [["Chernarus"], "Chernarus"],
    [["Chernarus", "Sakhal"], "Chernarus or Sakhal"],
    [["Chernarus", "Livonia", "Sakhal"], "Chernarus, Livonia, or Sakhal"],
  ])("%j → %s", (input, expected) => {
    expect(formatOrList(input)).toBe(expected);
  });
});

describe("countWord", () => {
  it("spells small counts, passes big ones through", () => {
    expect(countWord(2)).toBe("TWO");
    expect(countWord(3)).toBe("THREE");
    expect(countWord(11)).toBe("11");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter web test -- server-blurbs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `apps/web/src/lib/server-blurbs.ts`**

```ts
const TAGLINES: Record<string, string> = {
  chernarus: "THE CLASSIC. 230 KM² OF POOR JUDGMENT AND WORSE WEATHER.",
  livonia: "WET, GREEN, QUIET. THE QUIET IS BAIT. THE WOLVES ARE ORGANIZED.",
  sakhal: "VOLCANIC AND FROZEN AT ONCE. THE ISLAND KILLS MORE THAN THE PLAYERS.",
};

export function serverTagline(slug: string): string {
  return TAGLINES[slug] ?? "NEW BUREAU. THE DESK IS STILL WRITING THE INSULT.";
}

/** "A", "A or B", "A, B, or C" */
export function formatOrList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} or ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, or ${items[items.length - 1]}`;
}

const WORDS = ["ZERO", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN"];
export function countWord(n: number): string {
  return WORDS[n] ?? String(n);
}
```

- [ ] **Step 4: Run helper tests to verify pass**

Run: `pnpm --filter web test -- server-blurbs`
Expected: PASS.

- [ ] **Step 5: Build the page**

The copy below is transcribed from design 15a and already matches the real system (5-minute grace = `QUALIFY_SECONDS = 300` with pvp/kill early qualification; 3 in-order emotes with gaps allowed = `generateSequence(rng, 3)` + `advance()`; 24h challenge TTL = `CHALLENGE_TTL_MS`; 24h ban = enforcer `BAN_DURATION_HOURS` default; verification + monthly + transfer grants per `@onelife/tokens` sweeps). Do not rewrite it.

```tsx
// apps/web/src/app/about/page.tsx
import type { Metadata } from "next";
import Link from "next/link";
import { getServers } from "@/lib/api";
import type { Server } from "@/lib/types";
import { mapLabel } from "@/components/player/format";
import { serverTagline, formatOrList, countWord } from "@/lib/server-blurbs";
import { Kicker } from "@/components/tabloid/kicker";
import { SignInCta } from "@/components/front-page/signin-cta";

export const metadata: Metadata = {
  title: "About",
  description:
    "How One Life works — one life per server, a 24-hour ban when it ends, and an obituary that stands forever.",
};

const STEPS = (maps: string) => [
  {
    n: "1",
    title: "You live",
    body: (
      <>
        Wash ashore on {maps}. Survive the five-minute grace period and your life is{" "}
        <em className="not-italic font-semibold">qualified</em> — a birth announcement runs, and every
        hour after is tracked and ranked on <Link href="/survivors" className="underline decoration-red decoration-2 underline-offset-2">Survivors</Link>.
      </>
    ),
  },
  {
    n: "2",
    title: "You die",
    body: (
      <>
        A qualified death bans you from that server for{" "}
        <em className="not-italic font-semibold">24 hours</em> and the Morgue Desk publishes the
        obituary — cause, weapon, distance, the lot. The other servers don't care. The obituary is
        permanent.
      </>
    ),
  },
  {
    n: "3",
    title: "You wait — or you pay",
    body: (
      <>
        Sit out the 24 hours, or spend one <em className="not-italic font-semibold">unban token</em>{" "}
        to walk back in immediately. Tokens are earned, sent between players, and hoarded for the day
        it's you in the dirt. The obituary still stands.
      </>
    ),
  },
];

const RULES = [
  {
    term: "Hardcore, by default",
    def: "First-person only. No crosshair. Loot cut fifty percent across the board, zombie counts nudged up two. The world is meaner than the one you know, on purpose.",
  },
  {
    term: "The five-minute grace",
    def: "Every life opens with five minutes of grace. Hate your spawn? Reset it, free — die and try again as often as you like. But throw a punch or take a shot at another survivor and the life qualifies early. Five minutes of play, or one act of violence, whichever comes first. After that, death is real.",
  },
  {
    term: "One gamertag, proven",
    def: "Sign in, then name the Xbox gamertag you already play under — we suggest tags we've seen but haven't verified. To prove it's yours, the site shows three random emotes; perform them in-game in that order (other emotes in between are fine). Anyone can attempt a tag, but only the person holding the controller finishes the sequence. Unfinished attempts expire in 24 hours. One tag per account, forever.",
  },
  {
    term: "The token economy",
    def: "Verifying earns you two tokens on the spot — one to keep, one for the current month. Another lands on the first of every month. Spend them to lift a ban, send them to any verified survivor, stockpile them, or trade them for whatever someone's willing to part with. Transfers are final.",
  },
];

export default async function AboutPage() {
  const servers = (await getServers().catch(() => [] as Server[])).filter((s) => s.active && s.slug);
  const maps = formatOrList(servers.map((s) => mapLabel(s.map)));

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10 md:px-10 md:py-14">
      {/* Manifesto header */}
      <header className="border-b-[3px] border-ink pb-8">
        <Kicker>About the paper</Kicker>
        <h1 className="mt-3 font-display text-5xl font-bold uppercase leading-[.9] md:text-7xl">
          Everyone here dies. We write it down.
        </h1>
        <p className="mt-5 max-w-3xl font-sans text-lg leading-relaxed text-ink-soft">
          One Life is a set of hardcore DayZ servers with a newsroom bolted on. You get one life per
          server. When a qualified life ends — and it will — you're banned for 24 hours and the
          obituary writes itself. The living are ranked. The dead are remembered, unkindly.
        </p>
      </header>

      {/* 1/2/3 strip */}
      <section aria-label="How it works" className="grid gap-8 py-10 md:grid-cols-3 md:gap-0 md:divide-x md:divide-hairline">
        {STEPS(maps || "the coast").map((s) => (
          <div key={s.n} className="md:px-7 md:first:pl-0 md:last:pr-0">
            <div aria-hidden className="font-display text-6xl font-bold leading-none text-red">{s.n}</div>
            <h2 className="mt-3 font-display text-2xl font-bold uppercase">{s.title}</h2>
            <p className="mt-2 font-sans text-[15px] leading-relaxed text-ink-soft">{s.body}</p>
          </div>
        ))}
      </section>

      {/* Rules of record */}
      <section aria-labelledby="rules-heading">
        <h2 id="rules-heading" className="border-b-[3px] border-ink pb-2 font-display text-2xl font-bold uppercase">
          The rules of record
        </h2>
        <dl>
          {RULES.map((r) => (
            <div key={r.term} className="grid gap-2 border-b border-hairline py-4 md:grid-cols-[190px_1fr] md:gap-6">
              <dt className="font-mono text-xs font-bold uppercase tracking-[.06em] text-red">{r.term}</dt>
              <dd className="m-0 font-sans text-[15px] leading-relaxed text-ink-soft">{r.def}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Servers */}
      {servers.length > 0 && (
        <section aria-labelledby="servers-heading" className="mt-10">
          <h2 id="servers-heading" className="border-b-[3px] border-ink pb-2 font-display text-2xl font-bold uppercase">
            {countWord(servers.length)} servers
          </h2>
          <div className="grid gap-4 py-5 md:grid-cols-3">
            {servers.map((s) => (
              <div key={s.id} className="border border-hairline bg-paper p-5">
                <h3 className="font-display text-[22px] font-bold uppercase">{mapLabel(s.map)}</h3>
                <p className="mt-2 font-mono text-[11px] uppercase leading-relaxed tracking-[.05em] text-ink-muted">
                  {serverTagline(s.slug!)}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      <SignInCta />
    </main>
  );
}
```

(The `SignInCta` block carries the design's "Get in the paper." banner on this page too; it hides itself for verified users.)

- [ ] **Step 6: Verify suite + visual, then commit**

Run: `pnpm --filter web test && pnpm turbo run typecheck --filter=web`
Expected: PASS. Load `/about` in dev — manifesto, three numbered columns, four rules, live server cards.

```bash
git add apps/web/src/lib/server-blurbs.ts apps/web/src/lib/server-blurbs.test.ts apps/web/src/app/about
git commit -m "feat(web): About page — manifesto, rules of record, live bureau cards"
```

---

### Task 9: Teaser pages (News, Obituaries, Fresh Spawns)

**Files:**
- Create: `apps/web/src/components/teaser-page.tsx`
- Test: `apps/web/src/components/teaser-page.test.tsx`
- Create: `apps/web/src/app/news/page.tsx`
- Create: `apps/web/src/app/obituaries/page.tsx`
- Create: `apps/web/src/app/fresh-spawns/page.tsx`

**Interfaces:**
- Consumes: `Kicker` (Task 3).
- Produces: `TeaserPage({ kicker, kickerColor?, title, line })`. Routes export `metadata` with `robots: { index: false }` — remove that flag when each section goes live (R5).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/components/teaser-page.test.tsx
import { render, screen } from "@testing-library/react";
import { it, expect } from "vitest";
import { TeaserPage } from "./teaser-page";

it("renders kicker, screamer, line, and the survivors escape hatch", () => {
  render(<TeaserPage kicker="Obituaries" title="The morgue desk is hiring." line="DEVELOPING." />);
  expect(screen.getByText("Obituaries")).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1, name: "The morgue desk is hiring." })).toBeInTheDocument();
  expect(screen.getByText("DEVELOPING.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Meanwhile, the living are ranked →" })).toHaveAttribute("href", "/survivors");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter web test -- teaser`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component and the three routes**

```tsx
// apps/web/src/components/teaser-page.tsx
import Link from "next/link";
import { Kicker } from "@/components/tabloid/kicker";

export function TeaserPage({
  kicker, kickerColor = "red", title, line,
}: {
  kicker: string; kickerColor?: "red" | "blue"; title: string; line: string;
}) {
  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-16 md:px-10 md:py-24">
      <Kicker color={kickerColor}>{kicker}</Kicker>
      <h1 className="mt-3 font-display text-5xl font-bold uppercase leading-[.95] md:text-6xl">{title}</h1>
      <p className="mt-6 max-w-2xl font-mono text-sm uppercase leading-relaxed tracking-[.05em] text-ink-muted">{line}</p>
      <Link
        href="/survivors"
        className="mt-10 inline-block border-b-2 border-red font-display text-sm font-semibold uppercase tracking-[.06em] text-ink hover:text-red"
      >
        Meanwhile, the living are ranked →
      </Link>
    </main>
  );
}
```

```tsx
// apps/web/src/app/news/page.tsx
import type { Metadata } from "next";
import { TeaserPage } from "@/components/teaser-page";

export const metadata: Metadata = { title: "News", robots: { index: false } };

export default function NewsPage() {
  return (
    <TeaserPage
      kicker="News"
      title="The presses are warming up."
      line="EVERY LIFE A STORY. EVERY DEATH AN EXCLUSIVE. THE DESK IS STAFFING UP. DEVELOPING."
    />
  );
}
```

```tsx
// apps/web/src/app/obituaries/page.tsx
import type { Metadata } from "next";
import { TeaserPage } from "@/components/teaser-page";

export const metadata: Metadata = { title: "Obituaries", robots: { index: false } };

export default function ObituariesPage() {
  return (
    <TeaserPage
      kicker="Obituaries"
      title="The morgue desk is hiring."
      line="EVERY QUALIFIED DEATH WILL GET ITS WRITE-UP. THE DEAD CAN WAIT. THEY'RE GOOD AT IT. DEVELOPING."
    />
  );
}
```

```tsx
// apps/web/src/app/fresh-spawns/page.tsx
import type { Metadata } from "next";
import { TeaserPage } from "@/components/teaser-page";

export const metadata: Metadata = { title: "Fresh Spawns", robots: { index: false } };

export default function FreshSpawnsPage() {
  return (
    <TeaserPage
      kicker="Birth notices"
      kickerColor="blue"
      title="New fools wash ashore daily."
      line="A NOTICE FOR EVERY QUALIFIED LIFE. WE WISH THEM LONG AND PROSPEROUS LIVES. IT WILL NOT BE. DEVELOPING."
    />
  );
}
```

- [ ] **Step 4: Run to verify pass, then commit**

Run: `pnpm --filter web test -- teaser`
Expected: PASS.

```bash
git add apps/web/src/components/teaser-page.tsx apps/web/src/components/teaser-page.test.tsx apps/web/src/app/news apps/web/src/app/obituaries apps/web/src/app/fresh-spawns
git commit -m "feat(web): in-voice teaser pages for News, Obituaries, Fresh Spawns (noindex)"
```

---

### Task 10: OG image + root metadata sync, old-asset removal

**Files:**
- Modify: `apps/web/src/app/players/[slug]/opengraph-image.tsx`
- Create: `apps/web/src/app/players/[slug]/wordmark.png`, `apps/web/src/app/players/[slug]/plex-mono-400.ttf`, `apps/web/src/app/players/[slug]/plex-mono-700.ttf`
- Delete: `apps/web/src/app/players/[slug]/logo.png`, `apps/web/src/app/players/[slug]/space-mono-400.ttf`, `apps/web/src/app/players/[slug]/space-mono-700.ttf`, `apps/web/public/one-life-horizontal.png`
- Modify: `apps/web/src/app/layout.tsx:13` (description)

**Interfaces:**
- Consumes: brand wordmark (Task 1), `heroStats`/`monthYear` (unchanged).
- Produces: nothing consumed later; OG card is a leaf.

The card keeps the dark dossier ground (Dark `#0C0C08` is the bible's tertiary dark surface, and the red-box wordmark sits on it correctly) but swaps every off-palette hex for exact brand values and Space Mono for IBM Plex Mono.

- [ ] **Step 1: Stage the new co-located assets**

```bash
cd /Users/steveharmeyer/Development/dayz-one-life/one-life
cp ../brand/assets/logo/wordmark/wordmark-primary@2x.png "apps/web/src/app/players/[slug]/wordmark.png"
curl -fsSL -o "apps/web/src/app/players/[slug]/plex-mono-400.ttf" "https://raw.githubusercontent.com/google/fonts/main/ofl/ibmplexmono/IBMPlexMono-Regular.ttf"
curl -fsSL -o "apps/web/src/app/players/[slug]/plex-mono-700.ttf" "https://raw.githubusercontent.com/google/fonts/main/ofl/ibmplexmono/IBMPlexMono-Bold.ttf"
git rm "apps/web/src/app/players/[slug]/logo.png" "apps/web/src/app/players/[slug]/space-mono-400.ttf" "apps/web/src/app/players/[slug]/space-mono-700.ttf"
```

(If the google/fonts URLs 404, fetch the same two files from https://github.com/IBM/plex releases — IBM Plex Mono, OFL.)

- [ ] **Step 2: Update `opengraph-image.tsx`**

Apply exactly these changes to the existing file:

- Asset loads: `asset("space-mono-400.ttf")` → `asset("plex-mono-400.ttf")`, `asset("space-mono-700.ttf")` → `asset("plex-mono-700.ttf")`, `asset("logo.png")` → `asset("wordmark.png")` (rename `logoBuf` → `wordmarkBuf`).
- Root div: `background: "#0C0C08"` (flat — replaces the radial olive gradient), `color: "#FBFAF2"`.
- Top accent bar: `background: "#FF1E12"`, `height: 6`.
- Wordmark img: `<img src={dataUri(wordmarkBuf)} height={46} />` (unchanged position; the asset itself is the new red-box wordmark).
- Gamertag color: `#FBFAF2`.
- "Surviving since" row: `fontFamily: "IBM Plex Mono"`, base color `#8A8878`, bold value color `#FBFAF2`.
- Stat band border: `borderTop: "1.5px solid rgba(251,250,242,.16)"`; per-stat divider `1px solid rgba(251,250,242,.1)`.
- Stat values: hot `#FF1E12`, normal `#FBFAF2`; stat labels `fontFamily: "IBM Plex Mono"`, color `#8A8878`.
- Fonts array: names `"IBM Plex Mono"` for both mono weights; Oswald unchanged.
- Skull watermark: unchanged (`opacity: 0.07`).

- [ ] **Step 3: Update the root metadata description**

In `apps/web/src/app/layout.tsx`:

```ts
  description: "All the deaths fit to print. One Life is a hardcore permadeath DayZ community — one life per server, a 24-hour ban when it ends, and an obituary that stands forever.",
```

- [ ] **Step 4: Remove the retired logo and confirm nothing references it**

```bash
git rm apps/web/public/one-life-horizontal.png
grep -rn "one-life-horizontal" apps/web/src
```

Expected: grep returns nothing (header and home were rewritten in Tasks 4 and 7).

- [ ] **Step 5: Verify the OG route renders**

Run: `pnpm --filter web dev`, then `curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/players/<any-known-slug>/opengraph-image"`
Expected: `200`. Open it in a browser: dark card, red top bar, red-box wordmark, Plex Mono labels.

- [ ] **Step 6: Commit**

```bash
git add -A apps/web
git commit -m "feat(web): OG dossier on brand palette + IBM Plex Mono; new wordmark; masthead-slogan metadata"
```

---

### Task 11: Full verification, changelog, CLAUDE.md

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Full monorepo test + typecheck**

Run: `pnpm turbo run test --concurrency=1 && pnpm turbo run typecheck`
Expected: all packages PASS (DB suites need `TEST_DATABASE_URL`; local Postgres port may be 5434 per the override).

- [ ] **Step 2: Production build of the web app**

Run: `pnpm --filter web build`
Expected: build succeeds (this exercises `next/font/google` downloads and all route compilation).

- [ ] **Step 3: Route sweep with screenshots**

With dev (or the built app) running, screenshot at 1440px and 390px widths: `/`, `/about`, `/news`, `/obituaries`, `/fresh-spawns`, `/survivors`, `/survivors/sakhal`, `/players/<any>`, `/login`, `/account`, `/account/claim`. Check: no dark-theme remnants, no illegible text, masthead active states correct, mobile menu opens/closes, status banner states (signed-out invite visible when logged out).

- [ ] **Step 4: Update CHANGELOG.md**

Under `## [Unreleased]` → `### Changed`:

```markdown
- Tabloid redesign R1 — "Clean Glossy" design system (Paper/Ink/Red tokens, Oswald + IBM Plex
  Mono), new dark masthead with the 5-section nav + mobile menu, dark mono footer, front-page
  shell (manifesto hero, top survivors, sign-in CTA), About page, in-voice teaser pages for
  News/Obituaries/Fresh Spawns, restyled status banner, brand favicon kit, and the player OG
  card on the brand palette. Legacy color tokens remap to the new palette as compat shims
  (removed in R3).
```

- [ ] **Step 5: Update CLAUDE.md**

In the One Life section, add a `Tabloid redesign` entry summarizing: the R1–R5 roadmap (spec path), R1 shipped surfaces, the token/compat-shim scheme (`tint` = brand Bone until R3 renames it; legacy tokens deleted end of R3), fonts (Oswald/IBM Plex Mono via `next/font/google`; Anton only in raster wordmarks), assets vendored from the sibling `../brand` repo, and the voice-first rule (teasers stay until the content engine writes).

- [ ] **Step 6: Commit**

```bash
git add CHANGELOG.md CLAUDE.md
git commit -m "docs: changelog + CLAUDE.md for tabloid shell (R1)"
```

Then hand off to the **finishing-a-feature** skill for the PR into `develop`.
