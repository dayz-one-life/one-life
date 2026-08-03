# OpenGraph Everywhere Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every user-facing page on dayzonelife.com ships complete OpenGraph/Twitter metadata and a branded 1200×630 OG card, with the existing copy-pasted card chrome extracted into one shared shell.

**Architecture:** A new `src/lib/og/` module holds the asset loader, palette, and `CardShell` component; the two shipped cards (obituary, player) migrate onto it; four new `next/og` `ImageResponse` routes (root default, life, survivors board, obituaries index) consume it. Page-level metadata gets completed (root defaults, home export, life OG block, canonicals, `summary_large_image` upgrades) and the title double-suffix bug is fixed with `title: { absolute }`.

**Tech Stack:** Next.js App Router Metadata API, `next/og` (Satori), Vitest, TypeScript/ESM.

**Spec:** `docs/superpowers/specs/2026-08-03-opengraph-everywhere-design.md`

## Global Constraints

- Branch: all work on `feature/opengraph-everywhere` (already created; spec committed on it).
- **⚠️ `import.meta.url` must be bound to a variable, never inlined as the second `new URL()` argument** — Vite's asset-URL analyzer mangles the inlined form under the vitest transform. Keep the ⚠️ comment wherever the idiom appears.
- **Satori-safe styling only** in OG cards: flex only, explicit `display: "flex"` on every multi-child container, inline styles, literal hex, no shadows, no CSS classes.
- **⚠️ Next.js metadata does NOT deep-merge nested objects**: a page that exports its own `openGraph` replaces the root layout's entirely. Every page-level `openGraph` block must spread `...OG_DEFAULTS` (Task 2) to keep `siteName`/`locale`.
- All OG cards are 1200×630 PNG. Data-reading cards must degrade: a failed fetch renders branded chrome with static fallback text, **never** an error response (a scraper that gets a 500 caches "no image").
- Palette: `DARK #0C0C08`, `PAPER #FBFAF2`, `RED #FF1E12`, `DIM #8A8878`.
- Tests run from repo root: `pnpm --filter @onelife/web test <path-fragment>` (script is `vitest run`; a positional arg filters by filename). Typecheck: `pnpm --filter @onelife/web typecheck`. None of these tests need `TEST_DATABASE_URL`. **Never source `.env` for the web suite.**
- Commit after every task. CHANGELOG entry is written last, in the final task, before the PR.
- Do not touch `/i/[slug]` (invite route), `sitemap.ts`, `robots.ts`, or any noindex page.

---

### Task 1: Shared OG module — `src/lib/og/`

**Files:**
- Create: `apps/web/src/lib/og/assets.ts`
- Create: `apps/web/src/lib/og/card-shell.tsx`
- Test: `apps/web/src/lib/og/assets.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module; reads `apps/web/src/og-assets/`).
- Produces (used by Tasks 3–9):
  - `loadCardAssets(): Promise<CardAssets>` where `CardAssets = { fonts: { name: string; data: Buffer; weight: 400 | 700; style: "normal" }[]; wordmark: string; skull: string }` (wordmark/skull are `data:` URIs)
  - `OG_SIZE = { width: 1200, height: 630 }`
  - `DARK`, `PAPER`, `RED`, `DIM` color constants
  - `CardStat = { label: string; value: string; hot: boolean }`
  - `CardShell({ assets, kicker?, stats?, children })` — chrome: red top rule, faded skull, wordmark row with optional mono kicker, middle slot, bottom stat band (or empty flex div so `justify-between` keeps the middle centered).

- [ ] **Step 1: Write the failing test**

`apps/web/src/lib/og/assets.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { loadCardAssets, OG_SIZE, DARK, PAPER, RED, DIM } from "./assets";

describe("og assets", () => {
  it("declares the shared card contract", () => {
    expect(OG_SIZE).toEqual({ width: 1200, height: 630 });
    expect([DARK, PAPER, RED, DIM]).toEqual(["#0C0C08", "#FBFAF2", "#FF1E12", "#8A8878"]);
  });

  it("loads fonts and images from og-assets", async () => {
    const assets = await loadCardAssets();
    expect(assets.fonts.map((f) => f.name)).toEqual(["Oswald", "IBM Plex Mono", "IBM Plex Mono"]);
    for (const f of assets.fonts) expect(f.data.byteLength).toBeGreaterThan(0);
    expect(assets.wordmark).toMatch(/^data:image\/png;base64,/);
    expect(assets.skull).toMatch(/^data:image\/png;base64,/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @onelife/web test src/lib/og/assets.test.ts`
Expected: FAIL — cannot resolve `./assets`.

- [ ] **Step 3: Implement `assets.ts`**

```ts
import { readFile } from "node:fs/promises";

// ⚠️ Keep `import.meta.url` bound to a variable rather than inlined as the second `new URL()`
// argument — Vite's asset-URL analyzer rewrites an inlined `import.meta.url` under the vitest
// transform and the path breaks. See the matching comment in `app/i/[slug]/card/route.tsx`.
const here = import.meta.url;
const asset = (name: string) => readFile(new URL(`../../og-assets/${name}`, here));

export const DARK = "#0C0C08";
export const PAPER = "#FBFAF2";
export const RED = "#FF1E12";
export const DIM = "#8A8878";

export const OG_SIZE = { width: 1200, height: 630 };

const dataUri = (buf: Buffer) => `data:image/png;base64,${buf.toString("base64")}`;

export type CardAssets = {
  fonts: { name: string; data: Buffer; weight: 400 | 700; style: "normal" }[];
  wordmark: string;
  skull: string;
};

/** One await for everything a card needs: the three fonts (ready to spread into
 *  `ImageResponse`'s `fonts` option) plus the wordmark and skull as data URIs. */
export async function loadCardAssets(): Promise<CardAssets> {
  const [oswald, mono, monoBold, wordmarkBuf, skullBuf] = await Promise.all([
    asset("oswald-700.ttf"), asset("plex-mono-400.ttf"), asset("plex-mono-700.ttf"),
    asset("wordmark.png"), asset("skull.png"),
  ]);
  return {
    fonts: [
      { name: "Oswald", data: oswald, weight: 700, style: "normal" },
      { name: "IBM Plex Mono", data: mono, weight: 400, style: "normal" },
      { name: "IBM Plex Mono", data: monoBold, weight: 700, style: "normal" },
    ],
    wordmark: dataUri(wordmarkBuf),
    skull: dataUri(skullBuf),
  };
}
```

- [ ] **Step 4: Implement `card-shell.tsx`**

```tsx
import type { ReactNode } from "react";
import type { CardAssets } from "./assets";
import { DARK, PAPER, RED, DIM } from "./assets";

export type CardStat = { label: string; value: string; hot: boolean };

/**
 * Shared chrome for every 1200×630 OG card: red 34% top rule, faded skull, wordmark row with
 * an optional mono kicker, a middle slot, and a bottom stat band. Satori-safe: flex only,
 * inline styles, explicit `display:"flex"` on every multi-child container, no shadows.
 * When `stats` is empty/absent an empty flex div keeps `justify-between` spacing intact.
 */
export function CardShell({ assets, kicker, stats, children }: {
  assets: Pick<CardAssets, "wordmark" | "skull">;
  kicker?: ReactNode;
  stats?: CardStat[];
  children: ReactNode;
}) {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "66px 74px", background: DARK, color: PAPER, fontFamily: "Oswald", position: "relative" }}>
      <div style={{ position: "absolute", top: 0, left: 0, width: "34%", height: 6, background: RED }} />
      <img src={assets.skull} width={470} height={582} style={{ position: "absolute", right: -70, top: 24, opacity: 0.07 }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <img src={assets.wordmark} height={46} />
        {kicker ? (
          <div style={{ display: "flex", fontFamily: "IBM Plex Mono", fontWeight: 700, fontSize: 22, letterSpacing: 2, textTransform: "uppercase", color: DIM }}>
            {kicker}
          </div>
        ) : null}
      </div>
      {children}
      {stats && stats.length > 0 ? (
        <div style={{ display: "flex", borderTop: "1.5px solid rgba(251,250,242,.16)", paddingTop: 26 }}>
          {stats.map((f, i) => (
            <div key={f.label} style={{ flex: 1, display: "flex", flexDirection: "column", borderLeft: i > 0 ? "1px solid rgba(251,250,242,.1)" : "none", paddingLeft: i > 0 ? 24 : 0 }}>
              <span style={{ fontSize: 60, fontWeight: 700, lineHeight: 1, color: f.hot ? RED : PAPER }}>{f.value}</span>
              <span style={{ fontFamily: "IBM Plex Mono", fontSize: 16, letterSpacing: 2, textTransform: "uppercase", color: DIM, marginTop: 9 }}>{f.label}</span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: "flex" }} />
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @onelife/web test src/lib/og/assets.test.ts`
Expected: PASS (both tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/og
git commit -m "feat(web): shared OG card shell and asset loader"
```

---

### Task 2: Metadata foundations — `OG_DEFAULTS`, `SITE_DESCRIPTION`, root layout OG/Twitter blocks

**Files:**
- Modify: `apps/web/src/lib/seo.ts`
- Modify: `apps/web/src/app/layout.tsx:7-12`
- Test: `apps/web/src/lib/seo.test.ts` (extend existing file)

**Interfaces:**
- Consumes: nothing new.
- Produces (used by Tasks 5–9):
  - `OG_DEFAULTS = { siteName: "One Life", locale: "en_US" } as const` — spread into every page-level `openGraph`.
  - `SITE_DESCRIPTION: string` — the root description, single-sourced.

- [ ] **Step 1: Write the failing test** — append to `apps/web/src/lib/seo.test.ts`:

```ts
import { OG_DEFAULTS, SITE_DESCRIPTION } from "./seo";

describe("OG defaults", () => {
  it("carries siteName and locale for page-level openGraph spreads", () => {
    expect(OG_DEFAULTS).toEqual({ siteName: "One Life", locale: "en_US" });
  });
  it("single-sources the site description", () => {
    expect(SITE_DESCRIPTION).toContain("permadeath");
  });
});
```

(Match the existing file's import style — if it already imports from `./seo`, extend that import instead of adding a duplicate.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @onelife/web test src/lib/seo.test.ts`
Expected: FAIL — `OG_DEFAULTS` not exported.

- [ ] **Step 3: Implement.** In `seo.ts`, below `absoluteUrl`:

```ts
export const SITE_DESCRIPTION =
  "One Life is a hardcore permadeath DayZ community — one life per server, a 24-hour ban when it ends, and a record that stands forever.";

/**
 * ⚠️ Spread into EVERY page-level `openGraph` block. Next.js replaces — does not deep-merge —
 * nested metadata objects, so a page that defines `openGraph` at all wipes the root layout's
 * `siteName`/`locale` and must restate them.
 */
export const OG_DEFAULTS = { siteName: "One Life", locale: "en_US" } as const;
```

In `layout.tsx`, replace the `metadata` export:

```ts
import { SITE_URL, SITE_DESCRIPTION, OG_DEFAULTS } from "@/lib/seo";

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "One Life", template: "%s · One Life" },
  description: SITE_DESCRIPTION,
  openGraph: { ...OG_DEFAULTS, type: "website" },
  twitter: { card: "summary_large_image" },
  manifest: "/manifest.json",
};
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @onelife/web test src/lib/seo.test.ts` then `pnpm --filter @onelife/web typecheck`
Expected: PASS / clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/seo.ts apps/web/src/lib/seo.test.ts apps/web/src/app/layout.tsx
git commit -m "feat(web): root OpenGraph/Twitter defaults and OG_DEFAULTS helper"
```

---

### Task 3: Migrate the obituary OG card onto the shell

**Files:**
- Modify: `apps/web/src/app/(site)/(boxed)/obituaries/[slug]/opengraph-image.tsx`
- Test: existing `apps/web/src/app/(site)/(boxed)/obituaries/[slug]/opengraph-image.test.tsx` (unchanged — it pins the contract)

**Interfaces:**
- Consumes: `loadCardAssets`, `OG_SIZE`, `RED`, `CardShell`, `CardStat` from Task 1.
- Produces: nothing new; route contract (`size`, `contentType`, `alt`, default export) unchanged.

- [ ] **Step 1: Rewrite the route on the shell.** Full new file content:

```tsx
import { ImageResponse } from "next/og";
import { getObituary } from "@/lib/api";
import { rapSheetFacts, obituaryHeadlineSize } from "@/lib/obituary-format";
import { monthDayYear } from "@/components/player/format";
import { loadCardAssets, OG_SIZE, RED } from "@/lib/og/assets";
import { CardShell, type CardStat } from "@/lib/og/card-shell";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "One Life obituary";

export default async function OgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [a, assets] = await Promise.all([getObituary(slug).catch(() => null), loadCardAssets()]);
  const headline = a?.headline ?? "An obituary from DayZ One Life";
  const stats: CardStat[] = a ? rapSheetFacts(a) : [];

  return new ImageResponse(
    (
      <CardShell
        assets={assets}
        stats={stats}
        kicker={
          <>
            <span style={{ color: RED }}>Obituary</span>
            {a && <span>&nbsp;· {a.gamertag} · {monthDayYear(a.deathAt)}</span>}
          </>
        }
      >
        <div style={{ fontSize: obituaryHeadlineSize(headline), fontWeight: 700, lineHeight: 1.04, letterSpacing: -1, textTransform: "uppercase", maxWidth: 1000 }}>
          {headline}
        </div>
      </CardShell>
    ),
    { ...size, fonts: assets.fonts },
  );
}
```

Note: `rapSheetFacts` returns `{ label, value, hot }` objects — check its return type in `apps/web/src/lib/obituary-format.ts`; if `hot` is optional there, map to `CardStat` with `hot: Boolean(f.hot)` instead of the cast-by-annotation shown above.

- [ ] **Step 2: Run the existing test to verify no regression**

Run: `pnpm --filter @onelife/web test "obituaries/\[slug\]/opengraph-image"`
Expected: PASS — all three existing tests (contract, real PNG, fallback PNG).

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/(site)/(boxed)/obituaries/[slug]/opengraph-image.tsx"
git commit -m "refactor(web): obituary OG card onto shared CardShell"
```

---

### Task 4: Migrate the player OG card onto the shell (and give it the test it never had)

**Files:**
- Modify: `apps/web/src/app/(site)/(boxed)/players/[slug]/opengraph-image.tsx`
- Test: Create `apps/web/src/app/(site)/(boxed)/players/[slug]/opengraph-image.test.tsx`

**Interfaces:**
- Consumes: `loadCardAssets`, `OG_SIZE`, `PAPER`, `DIM`, `CardShell` from Task 1.
- Produces: nothing new; route contract unchanged.

- [ ] **Step 1: Write the test first** (pins the contract before the refactor). Model on the obituary card's test; mock `getPlayerPage`:

```tsx
import { describe, it, expect, vi } from "vitest";
import OgImage, { size, contentType, alt } from "./opengraph-image";

vi.mock("@/lib/api", () => ({ getPlayerPage: vi.fn() }));
import { getPlayerPage } from "@/lib/api";

const page = {
  gamertag: "RonaldRaygun552",
  firstSeenAt: "2026-05-01T00:00:00.000Z",
  totals: { kills: 3, lives: 7, deaths: 6, longestLifeSeconds: 3600 },
} as never;

describe("player opengraph-image", () => {
  it("declares the OG image contract", () => {
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe("image/png");
    expect(typeof alt).toBe("string");
  });

  it("renders a PNG for a real player", async () => {
    vi.mocked(getPlayerPage).mockResolvedValue(page);
    const res = await OgImage({ params: Promise.resolve({ slug: "ronaldraygun552" }) });
    expect(res.headers.get("content-type")).toContain("image/png");
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  it("renders the generic fallback PNG when the player cannot be fetched", async () => {
    vi.mocked(getPlayerPage).mockRejectedValue(new Error("api down"));
    const res = await OgImage({ params: Promise.resolve({ slug: "missing" }) });
    expect(res.headers.get("content-type")).toContain("image/png");
  });
});
```

If `getPlayerPage`'s `PlayerPage` type demands more fields than the card reads, keep the `as never` cast — the card only touches `gamertag`, `firstSeenAt`, `totals`.

- [ ] **Step 2: Run test to verify it passes against the CURRENT implementation**

Run: `pnpm --filter @onelife/web test "players/\[slug\]/opengraph-image"`
Expected: PASS (this is a pin, not a red-first test — the route already exists).

- [ ] **Step 3: Rewrite the route on the shell.** Full new file content:

```tsx
import { ImageResponse } from "next/og";
import { getPlayerPage } from "@/lib/api";
import { heroStats, monthYear } from "@/components/player/format";
import { loadCardAssets, OG_SIZE, PAPER, DIM } from "@/lib/og/assets";
import { CardShell } from "@/lib/og/card-shell";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "One Life survivor profile";

export default async function OgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [page, assets] = await Promise.all([getPlayerPage(slug).catch(() => null), loadCardAssets()]);
  const gamertag = page?.gamertag ?? "Unknown survivor";
  const stats = page ? heroStats(page.totals) : [];
  const since = page?.firstSeenAt ? monthYear(page.firstSeenAt) : null;
  const gtSize = gamertag.length > 12 ? 84 : gamertag.length > 9 ? 104 : 124;

  return new ImageResponse(
    (
      <CardShell assets={assets} stats={stats}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: gtSize, fontWeight: 700, lineHeight: 1, letterSpacing: -1, color: PAPER }}>{gamertag}</div>
          {since && (
            <div style={{ display: "flex", fontFamily: "IBM Plex Mono", fontSize: 22, color: DIM, marginTop: 26 }}>
              First seen&nbsp;<span style={{ fontWeight: 700, color: PAPER, textTransform: "uppercase" }}>{since}</span>
            </div>
          )}
        </div>
      </CardShell>
    ),
    { ...size, fonts: assets.fonts },
  );
}
```

- [ ] **Step 4: Run test to verify it still passes**

Run: `pnpm --filter @onelife/web test "players/\[slug\]/opengraph-image"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(site)/(boxed)/players/[slug]"
git commit -m "refactor(web): player OG card onto shared CardShell, add contract test"
```

---

### Task 5: Root default OG card + home page metadata

**Files:**
- Create: `apps/web/src/app/opengraph-image.tsx`
- Test: Create: `apps/web/src/app/opengraph-image.test.tsx`
- Modify: `apps/web/src/app/(site)/(boxed)/page.tsx` (add `metadata` export above the `Home` component)

**Interfaces:**
- Consumes: Task 1 (`loadCardAssets`, `OG_SIZE`, `CardShell`), Task 2 (`OG_DEFAULTS`, `SITE_DESCRIPTION`, `absoluteUrl`).
- Produces: the site-wide fallback OG image. In the App Router, file-based metadata images inherit downward — this root card covers `/`, `/about`, `/terms`, `/privacy`, and any future route without its own `opengraph-image`; deeper segments that define their own (obituary, player, and Tasks 6–8) win.

- [ ] **Step 1: Write the failing test** — `apps/web/src/app/opengraph-image.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import OgImage, { size, contentType, alt } from "./opengraph-image";

describe("root opengraph-image", () => {
  it("declares the OG image contract", () => {
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe("image/png");
    expect(typeof alt).toBe("string");
  });

  it("renders the static brand PNG", async () => {
    const res = await OgImage();
    expect(res.headers.get("content-type")).toContain("image/png");
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @onelife/web test src/app/opengraph-image.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the root card** — `apps/web/src/app/opengraph-image.tsx`. Fully static, no DB reads:

```tsx
import { ImageResponse } from "next/og";
import { loadCardAssets, OG_SIZE } from "@/lib/og/assets";
import { CardShell } from "@/lib/og/card-shell";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "One Life — hardcore permadeath DayZ";

export default async function OgImage() {
  const assets = await loadCardAssets();
  return new ImageResponse(
    (
      <CardShell
        assets={assets}
        kicker={<span>dayzonelife.com</span>}
        stats={[
          { label: "life per server", value: "1", hot: true },
          { label: "ban when it ends", value: "24H", hot: false },
          { label: "second chances", value: "0", hot: false },
        ]}
      >
        <div style={{ fontSize: 96, fontWeight: 700, lineHeight: 1.04, letterSpacing: -1, textTransform: "uppercase", maxWidth: 1000 }}>
          One life. One death. The record stands.
        </div>
      </CardShell>
    ),
    { ...size, fonts: assets.fonts },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @onelife/web test src/app/opengraph-image.test.tsx`
Expected: PASS.

- [ ] **Step 5: Add the home page's metadata export.** In `apps/web/src/app/(site)/(boxed)/page.tsx`, add below the imports (before the big doc comment):

```ts
import type { Metadata } from "next";
import { absoluteUrl, OG_DEFAULTS, SITE_DESCRIPTION } from "@/lib/seo";

const HOME_TITLE = "One Life — hardcore permadeath DayZ";
export const metadata: Metadata = {
  title: { absolute: HOME_TITLE },
  description: SITE_DESCRIPTION,
  alternates: { canonical: absoluteUrl("/") },
  openGraph: { ...OG_DEFAULTS, title: HOME_TITLE, description: SITE_DESCRIPTION, url: absoluteUrl("/"), type: "website" },
};
```

(`title: { absolute }` so the tab reads the full brand line, not "One Life — hardcore permadeath DayZ · One Life".)

- [ ] **Step 6: Typecheck + run the web suite for the touched area**

Run: `pnpm --filter @onelife/web typecheck` then `pnpm --filter @onelife/web test src/app`
Expected: clean / PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/opengraph-image.tsx apps/web/src/app/opengraph-image.test.tsx "apps/web/src/app/(site)/(boxed)/page.tsx"
git commit -m "feat(web): site-wide default OG card and home page metadata"
```

---

### Task 6: Title double-suffix fix + player not-found noindex + OG_DEFAULTS spreads

**Files:**
- Modify: `apps/web/src/app/(site)/(boxed)/players/[slug]/page.tsx:22-32`
- Modify: `apps/web/src/app/(site)/(boxed)/players/[slug]/[map]/lives/[n]/page.tsx:22-31` (title only here; the OG block lands in Task 7)
- Modify: `apps/web/src/app/(site)/(boxed)/obituaries/[slug]/page.tsx:15-23`

**Interfaces:**
- Consumes: `OG_DEFAULTS` from Task 2.
- Produces: nothing downstream; fixes the shipped `… — One Life · One Life` double suffix by wrapping hand-suffixed titles in `title: { absolute }`.

- [ ] **Step 1: Apply the three edits.**

`players/[slug]/page.tsx` — in `generateMetadata`:

```ts
if (!page) return { title: { absolute: "Survivor not found — One Life" }, robots: { index: false } };
```

and in the returned object:

```ts
title: { absolute: `${page.gamertag} — One Life DayZ survivor` },
```

plus spread defaults into the existing OG block:

```ts
openGraph: { ...OG_DEFAULTS, title: page.gamertag, description: desc, url, type: "profile" },
```

(add `OG_DEFAULTS` to the existing `@/lib/seo` import).

`[map]/lives/[n]/page.tsx` — both early returns become
`return { title: { absolute: "Life — One Life" } };` and the happy-path `title,` becomes `title: { absolute: title },`.

`obituaries/[slug]/page.tsx` — not-found becomes
`return { title: { absolute: "Obituary — One Life" } };`; the happy path's `title,` becomes `title: { absolute: title },`; the OG block gains the spread:

```ts
openGraph: { ...OG_DEFAULTS, title, description: a.lede, url: absoluteUrl(obituaryHref(slug)), type: "article", publishedTime: a.deathAt },
```

Keep each page's `twitter.title` as the plain string it already is (Twitter cards don't take the template).

- [ ] **Step 2: Update any existing page metadata tests.** Search: `grep -rn "One Life · One Life\|— One Life" apps/web/src --include="*.test.*"`. Any test asserting the old plain-string titles must now assert `{ absolute: … }`. If a page has a `page.test.tsx` exercising `generateMetadata`, extend it to assert `robots.index === false` on the player not-found branch.

- [ ] **Step 3: Run the affected tests + typecheck**

Run: `pnpm --filter @onelife/web test src/app` then `pnpm --filter @onelife/web typecheck`
Expected: PASS / clean.

- [ ] **Step 4: Commit**

```bash
git add -A apps/web/src/app
git commit -m "fix(web): stop double 'One Life' title suffix; noindex unknown survivors"
```

---

### Task 7: Life page — full OG block + bespoke life card

**Files:**
- Modify: `apps/web/src/app/(site)/(boxed)/players/[slug]/[map]/lives/[n]/page.tsx` (`generateMetadata`)
- Create: `apps/web/src/app/(site)/(boxed)/players/[slug]/[map]/lives/[n]/opengraph-image.tsx`
- Test: Create: `apps/web/src/app/(site)/(boxed)/players/[slug]/[map]/lives/[n]/opengraph-image.test.tsx`

**Interfaces:**
- Consumes: Task 1 shell; Task 2 `OG_DEFAULTS`; `getPlayerLife(slug, map, n)` → `LifeTimelineData | null` (`{ life: { lifeNumber, endedAt, deathCause, playtimeSeconds }, sessions, kills, gamertag, map }`); `mapLabel`/`formatDuration` from `@/components/player/format`; `causeLabel` from `@/lib/cause-format`; `parseLifeNumber` from wherever the page already imports it.
- Produces: nothing downstream.

- [ ] **Step 1: Complete the page's `generateMetadata`.** Replace the happy-path return with:

```ts
const title = `Life ${data.life.lifeNumber} · ${label} — ${data.gamertag} — One Life`;
const description = `The record of ${data.gamertag}'s life ${data.life.lifeNumber} on ${label} — every session, kill, and the death that ended it.`;
const canonical = absoluteUrl(`/players/${slug}/${map}/lives/${num}`);
return {
  title: { absolute: title },
  description,
  alternates: { canonical },
  openGraph: { ...OG_DEFAULTS, title, description, url: canonical, type: "profile" },
  twitter: { card: "summary_large_image", title, description },
};
```

(add `OG_DEFAULTS` to the `@/lib/seo` import).

- [ ] **Step 2: Write the failing card test** — same shape as the player card's (Task 4 Step 1): mock `@/lib/api`'s `getPlayerLife`; contract test; "renders a PNG for a dead life" with
`{ life: { lifeNumber: 3, endedAt: "2026-07-01T00:00:00.000Z", deathCause: "gunshot", playtimeSeconds: 5400, startedAt: "2026-06-30T00:00:00.000Z" }, sessions: [{}, {}], kills: [{}], gamertag: "RonaldRaygun552", map: "livonia" } as never`; "renders for a live life" with `endedAt: null, deathCause: null`; and the api-down fallback test. Params: `Promise.resolve({ slug: "ronaldraygun552", map: "livonia", n: "3" })`.

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @onelife/web test "lives/\[n\]/opengraph-image"`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the card**:

```tsx
import { ImageResponse } from "next/og";
import { getPlayerLife } from "@/lib/api";
import { mapLabel, formatDuration } from "@/components/player/format";
import { causeLabel } from "@/lib/cause-format";
import { loadCardAssets, OG_SIZE, PAPER, DIM, RED } from "@/lib/og/assets";
import { CardShell, type CardStat } from "@/lib/og/card-shell";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "One Life life record";

export default async function OgImage({ params }: { params: Promise<{ slug: string; map: string; n: string }> }) {
  const { slug, map, n } = await params;
  const num = Number.parseInt(n, 10);
  const [data, assets] = await Promise.all([
    Number.isFinite(num) ? getPlayerLife(slug, map, num).catch(() => null) : Promise.resolve(null),
    loadCardAssets(),
  ]);

  const gamertag = data?.gamertag ?? "A One Life record";
  const gtSize = gamertag.length > 12 ? 84 : gamertag.length > 9 ? 104 : 124;
  const alive = data ? data.life.endedAt === null : false;
  const stats: CardStat[] = data
    ? [
        { label: "time alive", value: formatDuration(data.life.playtimeSeconds), hot: false },
        { label: "kills", value: String(data.kills.length), hot: data.kills.length > 0 },
        { label: "sessions", value: String(data.sessions.length), hot: false },
        { label: "status", value: alive ? "ALIVE" : "DEAD", hot: !alive },
      ]
    : [];

  return new ImageResponse(
    (
      <CardShell
        assets={assets}
        stats={stats}
        kicker={
          data ? (
            <>
              <span style={{ color: RED }}>Life {data.life.lifeNumber}</span>
              <span>&nbsp;· {mapLabel(data.map)}</span>
            </>
          ) : undefined
        }
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: gtSize, fontWeight: 700, lineHeight: 1, letterSpacing: -1, color: PAPER }}>{gamertag}</div>
          {data && !alive && data.life.deathCause && (
            <div style={{ display: "flex", fontFamily: "IBM Plex Mono", fontSize: 22, color: DIM, marginTop: 26, textTransform: "uppercase" }}>
              {causeLabel(data.life.deathCause)}
            </div>
          )}
        </div>
      </CardShell>
    ),
    { ...size, fonts: assets.fonts },
  );
}
```

If the page's own `parseLifeNumber` (see its imports, `@/lib/…`) is importable, use it instead of the inline `Number.parseInt` so the two agree on what a valid `n` is.

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @onelife/web test "lives/\[n\]"` then `pnpm --filter @onelife/web typecheck`
Expected: PASS / clean.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/(site)/(boxed)/players/[slug]/[map]/lives/[n]"
git commit -m "feat(web): life page OG metadata and bespoke life card"
```

---

### Task 8: Survivors board — `summary_large_image` + board card

**Files:**
- Modify: `apps/web/src/lib/survivor-metadata.ts`
- Modify: `apps/web/src/lib/survivor-metadata.test.ts`
- Create: `apps/web/src/app/(site)/(boxed)/survivors/[map]/opengraph-image.tsx`
- Test: Create: `apps/web/src/app/(site)/(boxed)/survivors/[map]/opengraph-image.test.tsx`

**Interfaces:**
- Consumes: Task 1 shell; Task 2 `OG_DEFAULTS`; `getSurvivors({ slug, page })` → `SurvivorsPage` (`{ rows, total, page, pageSize }`, `rows[0]?.gamertag` is the leader).
- Produces: nothing downstream.

- [ ] **Step 1: Update `buildSurvivorMetadata`.** In the return: `twitter: { card: "summary" … }` → `twitter: { card: "summary_large_image", title, description }`, and `openGraph: { title, … }` → `openGraph: { ...OG_DEFAULTS, title, description, url: canonical, type: "website" }` (import `OG_DEFAULTS` from `./seo`).

- [ ] **Step 2: Update its test.** In `survivor-metadata.test.ts`, change any `card: "summary"` expectation to `card: "summary_large_image"` and add `siteName: "One Life"` to any full-object `openGraph` expectation.

- [ ] **Step 3: Run the metadata test**

Run: `pnpm --filter @onelife/web test src/lib/survivor-metadata.test.ts`
Expected: PASS.

- [ ] **Step 4: Write the failing card test** — mock `@/lib/api`'s `getSurvivors`; contract test; "renders a PNG for a board" with `{ rows: [{ gamertag: "RonaldRaygun552" }], total: 41, page: 1, pageSize: 25 } as never` and params `Promise.resolve({ map: "chernarus" })`; api-down fallback test.

Run: `pnpm --filter @onelife/web test "survivors/\[map\]/opengraph-image"` — expected FAIL (module not found).

- [ ] **Step 5: Implement the card.** Copy ages gracefully: name the board, not "right now".

```tsx
import { ImageResponse } from "next/og";
import { getSurvivors } from "@/lib/api";
import { loadCardAssets, OG_SIZE, PAPER, DIM, RED } from "@/lib/og/assets";
import { CardShell, type CardStat } from "@/lib/og/card-shell";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "One Life survivors board";

const titleCase = (slug: string) => slug.replace(/\b\w/g, (c) => c.toUpperCase());

export default async function OgImage({ params }: { params: Promise<{ map: string }> }) {
  const { map } = await params;
  const [data, assets] = await Promise.all([
    getSurvivors({ slug: map, page: 1 }).catch(() => null),
    loadCardAssets(),
  ]);
  const label = titleCase(map);
  const leader = data?.rows[0]?.gamertag ?? null;
  const stats: CardStat[] = data
    ? [
        { label: "on the board", value: String(data.total), hot: true },
        { label: "ranking", value: "TIME ALIVE", hot: false },
        { label: "lives each", value: "1", hot: false },
      ]
    : [];

  return new ImageResponse(
    (
      <CardShell assets={assets} stats={stats} kicker={<span style={{ color: RED }}>Survivors</span>}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 96, fontWeight: 700, lineHeight: 1.04, letterSpacing: -1, textTransform: "uppercase", maxWidth: 1000, color: PAPER }}>
            Top {label} survivors
          </div>
          {leader && (
            <div style={{ display: "flex", fontFamily: "IBM Plex Mono", fontSize: 22, color: DIM, marginTop: 26 }}>
              <span style={{ fontWeight: 700, color: PAPER }}>{leader}</span>&nbsp;leads the pack
            </div>
          )}
        </div>
      </CardShell>
    ),
    { ...size, fonts: assets.fonts },
  );
}
```

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm --filter @onelife/web test "survivors/\[map\]"` then `pnpm --filter @onelife/web typecheck`
Expected: PASS / clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/survivor-metadata.ts apps/web/src/lib/survivor-metadata.test.ts "apps/web/src/app/(site)/(boxed)/survivors/[map]"
git commit -m "feat(web): survivors board OG card and summary_large_image upgrade"
```

---

### Task 9: Obituaries index — `summary_large_image` + morgue card; legal/about metadata

**Files:**
- Modify: `apps/web/src/app/(site)/(boxed)/obituaries/page.tsx` (`generateMetadata`)
- Create: `apps/web/src/app/(site)/(boxed)/obituaries/opengraph-image.tsx`
- Test: Create: `apps/web/src/app/(site)/(boxed)/obituaries/opengraph-image.test.tsx`
- Modify: `apps/web/src/app/(site)/(boxed)/about/page.tsx`, `.../terms/page.tsx`, `.../privacy/page.tsx` (metadata objects only)

**Interfaces:**
- Consumes: Task 1 shell; Task 2 `OG_DEFAULTS`; `getSiteStatsCached()` → `{ deaths, alive }`.
- Produces: nothing downstream.

- [ ] **Step 1: Upgrade the obituaries index metadata.** In its `generateMetadata` return: `openGraph: { ...OG_DEFAULTS, title, description, url: canonical, type: "website" }` and `twitter: { card: "summary_large_image", title, description }` (import `OG_DEFAULTS` from `@/lib/seo`).

- [ ] **Step 2: Write the failing card test** — mock `@/lib/api`'s `getSiteStatsCached`; contract test; "renders a PNG" with `mockResolvedValue({ deaths: 128, alive: 41 })`; api-down fallback. Note this default export takes **no arguments** (index route, no params).

Run: `pnpm --filter @onelife/web test "obituaries/opengraph-image"` — expected FAIL.

- [ ] **Step 3: Implement the card**:

```tsx
import { ImageResponse } from "next/og";
import { getSiteStatsCached } from "@/lib/api";
import { loadCardAssets, OG_SIZE, DIM, RED } from "@/lib/og/assets";
import { CardShell, type CardStat } from "@/lib/og/card-shell";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "One Life obituaries";

export default async function OgImage() {
  const [stats, assets] = await Promise.all([
    getSiteStatsCached().catch(() => null),
    loadCardAssets(),
  ]);
  const band: CardStat[] = stats
    ? [
        { label: "deaths on record", value: String(stats.deaths), hot: true },
        { label: "obituary each", value: "1", hot: false },
        { label: "retractions", value: "0", hot: false },
      ]
    : [];

  return new ImageResponse(
    (
      <CardShell assets={assets} stats={band} kicker={<span style={{ color: RED }}>The Morgue</span>}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 110, fontWeight: 700, lineHeight: 1.04, letterSpacing: -1, textTransform: "uppercase" }}>
            The obituaries
          </div>
          <div style={{ display: "flex", fontFamily: "IBM Plex Mono", fontSize: 22, color: DIM, marginTop: 26, textTransform: "uppercase" }}>
            Every qualified death gets its write-up
          </div>
        </div>
      </CardShell>
    ),
    { ...size, fonts: assets.fonts },
  );
}
```

- [ ] **Step 4: Run the card tests**

Run: `pnpm --filter @onelife/web test "obituaries/opengraph-image"`
Expected: PASS.

- [ ] **Step 5: Complete about/terms/privacy metadata.** Each already exports `metadata: Metadata` with `title` + `description`. Extend each object with canonical + OG (root default card covers the image). Pattern, shown for `/about` — repeat with the right path and existing strings for `/terms` and `/privacy`:

```ts
import { absoluteUrl, OG_DEFAULTS } from "@/lib/seo";

export const metadata: Metadata = {
  title: "About",
  description: "How One Life works — one life per server, a 24-hour ban when it ends, and a record that stands forever.",
  alternates: { canonical: absoluteUrl("/about") },
  openGraph: {
    ...OG_DEFAULTS,
    title: "About",
    description: "How One Life works — one life per server, a 24-hour ban when it ends, and a record that stands forever.",
    url: absoluteUrl("/about"),
    type: "website",
  },
};
```

(Keep each page's existing `description` string verbatim; only add the new fields.)

- [ ] **Step 6: Typecheck + full web suite**

Run: `pnpm --filter @onelife/web typecheck` then `pnpm --filter @onelife/web test`
Expected: clean / PASS.

- [ ] **Step 7: Commit**

```bash
git add "apps/web/src/app/(site)/(boxed)/obituaries" "apps/web/src/app/(site)/(boxed)/about/page.tsx" "apps/web/src/app/(site)/(boxed)/terms/page.tsx" "apps/web/src/app/(site)/(boxed)/privacy/page.tsx"
git commit -m "feat(web): obituaries index OG card; canonical+OG for about/terms/privacy"
```

---

### Task 10: Full verification, changelog, PR

**Files:**
- Modify: `CHANGELOG.md` (Unreleased entry — written last, per house rules)
- Modify: `CLAUDE.md` "Outstanding, un-verified work" (append the browser checks this work leaves open)

**Interfaces:**
- Consumes: everything above.
- Produces: the PR.

- [ ] **Step 1: Full monorepo verification**

Run from repo root: `pnpm turbo run typecheck` and `pnpm turbo run test --concurrency=1` (DB suites need `TEST_DATABASE_URL` exported; web suite must NOT have `.env` sourced).
Expected: all green. Fix anything red before proceeding.

- [ ] **Step 2: Record the outstanding browser checks.** Append to CLAUDE.md's "Outstanding, un-verified work" list:

```markdown
- The OpenGraph pass's browser-only claims: each new card eyeballed at its real URL on the
  deployed build (`/opengraph-image`, a life page's, a survivors board's, `/obituaries/`'s),
  a fresh Discord/X unfurl of home + a life + a board + the obituaries index, and the two
  migrated cards (obituary, player) confirmed pixel-equivalent after the CardShell refactor.
```

- [ ] **Step 3: Changelog + PR.** Add the Unreleased entry (e.g. "OpenGraph metadata and branded share cards on every page — site-wide default card, life/survivors/obituaries cards, canonical URLs, and a fix for doubled 'One Life' title suffixes"), commit it, then invoke the `keel:finish-work` skill to run checks and open the squash-PR against `main`. **Never chain `git commit && gh pr create`** — the changelog gate fires before the chain runs.
