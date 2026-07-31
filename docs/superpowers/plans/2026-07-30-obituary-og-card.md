# Obituary OpenGraph Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `/obituaries/[slug]` a 1200×630 OG share image (headline-led tabloid card) so Discord/X unfurls carry a picture.

**Architecture:** A Next `opengraph-image.tsx` file-convention route beside the obituary page, rendering with satori `ImageResponse` in the exact visual grammar of the existing player dossier card. Data via `getObituary`; graceful generic fallback on any fetch failure. The absolute `og:image` URL is derived by Next from `metadataBase` (already `SITE_URL`), so no request-origin derivation exists anywhere in the path.

**Tech Stack:** Next.js App Router (`next/og` `ImageResponse`), vitest, existing helpers `rapSheetFacts` / `formatDuration` / `verdictPhrase`, shared `apps/web/src/og-assets/`.

**Spec:** `docs/superpowers/specs/2026-07-30-obituary-og-card-design.md`

## Global Constraints

- Work happens on branch `feature/obituary-og-card` (already created; spec committed on it).
- Run web tests from `apps/web`: `pnpm vitest run <file>`; typecheck: `pnpm typecheck`. **Never source `.env` for the web suite.**
- ⚠️ Asset loading MUST use the two-step shape `const here = import.meta.url;` then `new URL("../<rel>/og-assets/<name>", here)` — inlining `import.meta.url` as the second argument 500s in the prod webpack build. Copy the shape from `players/[slug]/opengraph-image.tsx` verbatim.
- Card palette/typography (from the shipped cards, do not restyle): stage `#0C0C08`, paper `#FBFAF2`, red `#FF1E12`, muted `#8A8878`; Oswald 700 display; IBM Plex Mono 400/700 utility.
- The card must never 500 for an unknown slug or a down API — it renders the generic fallback.
- Every code comment must state a constraint, not narrate the change.

---

### Task 1: `monthDayYear` date helper

**Files:**
- Modify: `apps/web/src/components/player/format.ts` (add beside `monthYear`, which is at the `const MONTHS` block)
- Test: `apps/web/src/components/player/format.test.ts` (exists — append)

**Interfaces:**
- Produces: `monthDayYear(iso: string): string` — `"Jul 30, 2026"`, UTC-based like `monthYear`.

- [ ] **Step 1: Write the failing test** (append to the existing describe block or file tail)

```ts
describe("monthDayYear", () => {
  it("formats an ISO instant as Mon D, YYYY in UTC", () => {
    expect(monthDayYear("2026-07-30T22:27:32.000Z")).toBe("Jul 30, 2026");
  });
  it("does not shift the day across the UTC midnight boundary", () => {
    expect(monthDayYear("2026-01-01T00:00:01.000Z")).toBe("Jan 1, 2026");
  });
});
```

Add `monthDayYear` to the existing `import ... from "./format"` line.

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/web`): `pnpm vitest run src/components/player/format.test.ts`
Expected: FAIL — `monthDayYear` is not exported.

- [ ] **Step 3: Write minimal implementation** — in `format.ts`, directly under `monthYear`:

```ts
export function monthDayYear(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/player/format.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/player/format.ts apps/web/src/components/player/format.test.ts
git commit -m "feat(web): monthDayYear date helper for the obituary OG card"
```

---

### Task 2: `obituaryHeadlineSize` stepper

**Files:**
- Modify: `apps/web/src/lib/obituary-format.ts`
- Test: `apps/web/src/lib/obituary-format.test.ts` (exists — append; create with the standard vitest header if absent)

**Interfaces:**
- Produces: `obituaryHeadlineSize(headline: string): number` — `76` for length ≤ 45, `62` for ≤ 75, else `52`.

- [ ] **Step 1: Write the failing test**

```ts
describe("obituaryHeadlineSize", () => {
  it("steps down at the 45- and 75-char boundaries", () => {
    expect(obituaryHeadlineSize("a".repeat(45))).toBe(76);
    expect(obituaryHeadlineSize("a".repeat(46))).toBe(62);
    expect(obituaryHeadlineSize("a".repeat(75))).toBe(62);
    expect(obituaryHeadlineSize("a".repeat(76))).toBe(52);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/obituary-format.test.ts` — Expected: FAIL, not exported.

- [ ] **Step 3: Write minimal implementation** — in `obituary-format.ts`:

```ts
/** OG-card headline size: stepped, not fluid — satori has no clamp()/container queries. */
export function obituaryHeadlineSize(headline: string): number {
  return headline.length <= 45 ? 76 : headline.length <= 75 ? 62 : 52;
}
```

- [ ] **Step 4: Run test to verify it passes** — same command, PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/obituary-format.ts apps/web/src/lib/obituary-format.test.ts
git commit -m "feat(web): headline size stepper for the obituary OG card"
```

---

### Task 3: the `opengraph-image.tsx` renderer

**Files:**
- Create: `apps/web/src/app/(site)/(boxed)/obituaries/[slug]/opengraph-image.tsx`
- Test: `apps/web/src/app/(site)/(boxed)/obituaries/[slug]/opengraph-image.test.tsx`
- Reference (read, do not modify): `apps/web/src/app/(site)/(boxed)/players/[slug]/opengraph-image.tsx`

**Interfaces:**
- Consumes: `getObituary(slug)` from `@/lib/api` (returns `ObituaryArticle | null`); `rapSheetFacts` from `@/lib/obituary-format` (returns `RapFact[]`, ≤ 4 entries, cause is `hot`); `obituaryHeadlineSize` (Task 2); `monthDayYear` (Task 1).
- Produces: default async component + `export const size/contentType/alt` per Next convention.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import OgImage, { size, contentType, alt } from "./opengraph-image";
import type { ObituaryArticle } from "@/lib/types";

vi.mock("@/lib/api", () => ({ getObituary: vi.fn() }));
import { getObituary } from "@/lib/api";

const article: ObituaryArticle = {
  slug: "s", gamertag: "RonaldRaygun552", map: "sakhal", mapSlug: "sakhal", lifeNumber: 7,
  headline: "RonaldRaygun552's Seventh Sakhal File Closes With No Cause Given",
  lede: "l", tags: [], timeAliveSeconds: 3532, kills: 0, longestKillMeters: 412.3,
  cause: "died", deathAt: "2026-07-30T22:27:32.000Z",
  body: "", bodyBlocks: null, pullQuote: null, sessions: 4, killerGamertag: null, weapon: null, verdict: null,
};

describe("obituary opengraph-image", () => {
  it("declares the OG image contract", () => {
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe("image/png");
    expect(typeof alt).toBe("string");
  });

  it("renders a PNG for a real obituary", async () => {
    vi.mocked(getObituary).mockResolvedValue(article);
    const res = await OgImage({ params: Promise.resolve({ slug: "s" }) });
    expect(res.headers.get("content-type")).toContain("image/png");
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  it("renders the generic fallback PNG when the obituary cannot be fetched", async () => {
    vi.mocked(getObituary).mockRejectedValue(new Error("api down"));
    const res = await OgImage({ params: Promise.resolve({ slug: "missing" }) });
    expect(res.headers.get("content-type")).toContain("image/png");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run "src/app/(site)/(boxed)/obituaries/[slug]/opengraph-image.test.tsx"`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the implementation**

```tsx
import { readFile } from "node:fs/promises";
import { ImageResponse } from "next/og";
import { getObituary } from "@/lib/api";
import { rapSheetFacts, obituaryHeadlineSize } from "@/lib/obituary-format";
import { monthDayYear } from "@/components/player/format";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "One Life obituary";

// ⚠️ Keep `import.meta.url` bound to a variable rather than inlined as the second `new URL()`
// argument — see the matching comment in `app/i/[slug]/card/route.tsx` for why.
const here = import.meta.url;
const asset = (name: string) => readFile(new URL(`../../../../../og-assets/${name}`, here));
const dataUri = (buf: Buffer) => `data:image/png;base64,${buf.toString("base64")}`;

export default async function OgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [a, oswald, mono, monoBold, wordmarkBuf, skullBuf] = await Promise.all([
    getObituary(slug).catch(() => null),
    asset("oswald-700.ttf"), asset("plex-mono-400.ttf"), asset("plex-mono-700.ttf"),
    asset("wordmark.png"), asset("skull.png"),
  ]);
  const headline = a?.headline ?? "An obituary from DayZ One Life";
  const facts = a ? rapSheetFacts(a) : [];

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "66px 74px", background: "#0C0C08", color: "#FBFAF2", fontFamily: "Oswald", position: "relative" }}>
        <div style={{ position: "absolute", top: 0, left: 0, width: "34%", height: 6, background: "#FF1E12" }} />
        <img src={dataUri(skullBuf)} width={470} height={582} style={{ position: "absolute", right: -70, top: 24, opacity: 0.07 }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <img src={dataUri(wordmarkBuf)} height={46} />
          <div style={{ display: "flex", fontFamily: "IBM Plex Mono", fontWeight: 700, fontSize: 22, letterSpacing: 2, textTransform: "uppercase", color: "#8A8878" }}>
            <span style={{ color: "#FF1E12" }}>Obituary</span>
            {a && <span>&nbsp;· {a.gamertag} · {monthDayYear(a.deathAt)}</span>}
          </div>
        </div>
        <div style={{ fontSize: obituaryHeadlineSize(headline), fontWeight: 700, lineHeight: 1.04, letterSpacing: -1, textTransform: "uppercase", maxWidth: 1000 }}>
          {headline}
        </div>
        {facts.length > 0 ? (
          <div style={{ display: "flex", borderTop: "1.5px solid rgba(251,250,242,.16)", paddingTop: 26 }}>
            {facts.map((f, i) => (
              <div key={f.label} style={{ flex: 1, display: "flex", flexDirection: "column", borderLeft: i > 0 ? "1px solid rgba(251,250,242,.1)" : "none", paddingLeft: i > 0 ? 24 : 0 }}>
                <span style={{ fontSize: 60, fontWeight: 700, lineHeight: 1, color: f.hot ? "#FF1E12" : "#FBFAF2" }}>{f.value}</span>
                <span style={{ fontFamily: "IBM Plex Mono", fontSize: 16, letterSpacing: 2, textTransform: "uppercase", color: "#8A8878", marginTop: 9 }}>{f.label}</span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: "flex" }} />
        )}
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Oswald", data: oswald, weight: 700, style: "normal" },
        { name: "IBM Plex Mono", data: mono, weight: 400, style: "normal" },
        { name: "IBM Plex Mono", data: monoBold, weight: 700, style: "normal" },
      ],
    },
  );
}
```

Note the asset path depth: this file sits at `app/(site)/(boxed)/obituaries/[slug]/`, the same depth as `app/(site)/(boxed)/players/[slug]/`, so the relative prefix `../../../../../og-assets/` is copied unchanged from the player card. Verify by counting: `[slug]` → `obituaries` → `(boxed)` → `(site)` → `app` → `src`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run "src/app/(site)/(boxed)/obituaries/[slug]/opengraph-image.test.tsx"`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck` — Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/(site)/(boxed)/obituaries/[slug]/opengraph-image.tsx" "apps/web/src/app/(site)/(boxed)/obituaries/[slug]/opengraph-image.test.tsx"
git commit -m "feat(web): obituary OG share card (headline-led)"
```

---

### Task 4: `publishedTime` on the article OG metadata

**Files:**
- Modify: `apps/web/src/app/(site)/(boxed)/obituaries/[slug]/page.tsx:21` (the `openGraph` line in `generateMetadata`)
- Test: `apps/web/src/app/(site)/(boxed)/obituaries/[slug]/page.metadata.test.ts` (create; if a metadata test for this page already exists elsewhere, append there instead)

**Interfaces:**
- Consumes: the page's existing `generateMetadata`; `getObituary` mock.
- Produces: `openGraph.publishedTime === article.deathAt` on the obituary page metadata.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { generateMetadata } from "./page";

vi.mock("@/lib/api", () => ({
  getObituary: vi.fn().mockResolvedValue({
    slug: "s", gamertag: "G", map: "sakhal", mapSlug: "sakhal", lifeNumber: 1,
    headline: "H", lede: "L", tags: [], timeAliveSeconds: 1, kills: 0, longestKillMeters: null,
    cause: null, deathAt: "2026-07-30T22:27:32.000Z",
    body: "", bodyBlocks: null, pullQuote: null, sessions: 1, killerGamertag: null, weapon: null, verdict: null,
  }),
  getObituariesFeed: vi.fn(),
  getPlayerLife: vi.fn(),
}));

describe("obituary page metadata", () => {
  it("stamps the death instant as the article's publishedTime", async () => {
    const md = await generateMetadata({ params: Promise.resolve({ slug: "s" }) });
    expect(md.openGraph).toMatchObject({ type: "article", publishedTime: "2026-07-30T22:27:32.000Z" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run "src/app/(site)/(boxed)/obituaries/[slug]/page.metadata.test.ts"`
Expected: FAIL — `publishedTime` undefined.

- [ ] **Step 3: Implement** — in `generateMetadata`, change the `openGraph` line to:

```ts
openGraph: { title, description: a.lede, url: absoluteUrl(obituaryHref(slug)), type: "article", publishedTime: a.deathAt },
```

- [ ] **Step 4: Run test to verify it passes** — same command, PASS. Then run the page's sibling tests to catch regressions: `pnpm vitest run "src/app/(site)/(boxed)/obituaries"`.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(site)/(boxed)/obituaries/[slug]/page.tsx" "apps/web/src/app/(site)/(boxed)/obituaries/[slug]/page.metadata.test.ts"
git commit -m "feat(web): stamp publishedTime on obituary article OG metadata"
```

---

### Task 5: empirical build + curl verification, changelog, PR

**Files:**
- Modify: `CHANGELOG.md` (Unreleased entry)
- No source changes expected; fixes go back through the task that owns the file.

- [ ] **Step 1: Full web suite and typecheck**

From `apps/web`: `pnpm vitest run` and `pnpm typecheck` — both clean.

- [ ] **Step 2: Production build**

From `apps/web`: `pnpm build` (do NOT source `.env`). Expected: build succeeds; the route list includes `/obituaries/[slug]/opengraph-image`.

- [ ] **Step 3: Boot and curl**

Start the built server on a spare port: `PORT=3110 pnpm start &`. Then:

```bash
curl -sI http://localhost:3110/obituaries/any-slug/opengraph-image | head -3   # expect 200, image/png
curl -s http://localhost:3110/obituaries/any-slug/opengraph-image -o /tmp/obit-og.png && file /tmp/obit-og.png  # expect PNG 1200 x 630
curl -s http://localhost:3110/obituaries/any-slug | grep -o '<meta property="og:image"[^>]*>'  # expect SITE_URL-absolute /opengraph-image URL
```

Without the local API running this exercises the fallback card — that is fine for the mechanism check. If the local stack is up (`docker ps` shows postgres; API running), repeat with a real slug from `curl -s localhost:3110/api/...` or the prod feed and **eyeball the PNG against the approved mockup** (headline wrap, kicker, red cause stat). Kill the server afterwards.

- [ ] **Step 4: Changelog entry** — under `## [Unreleased]`:

```markdown
### Added

- Obituaries now unfurl with a share image on Discord and X: a 1200×630 card carrying the
  tabloid headline, the gamertag and date of death, and the rap sheet (time survived, kills,
  longest kill, cause). Obituary pages also stamp the death instant as the article's
  published time.
```

- [ ] **Step 5: Commit changelog, then finish**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog for obituary OG card"
```

Then use `keel:finish-work` to open the PR (base `main`, squash). PR body: what changed, the curl evidence from Step 3, and the post-deploy check (fresh Discord unfurl of a new obituary URL; cached URLs stay imageless until Discord re-scrapes).

- [ ] **Step 6: Record the post-deploy check**

Add to the memory/outstanding list (not CLAUDE.md unless asked): a real Discord unfurl of a freshly-shared obituary after the next deploy.
