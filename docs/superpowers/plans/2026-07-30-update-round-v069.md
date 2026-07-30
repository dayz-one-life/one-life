# Update Round v0.69 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the seven-part update round: referral form slim-down, invite OG unfurl + card, friends teardown, all-maps dossier, alive-only ticket links, timeline dark-stage hero, and encounters on the life timeline.

**Architecture:** One feature branch, one PR into `main`. Teardown proceeds top-down (web UI → web lib → API → notifier → package → schema) so every task typechecks on its own. The additive work (interstitial, card, encounters, hero) is independent of the teardown and can interleave. Spec: `docs/superpowers/specs/2026-07-30-update-round-v069-design.md` — read the relevant section before each task.

**Tech Stack:** pnpm + turbo monorepo, TS/ESM, Next.js App Router (`apps/web`), Fastify (`apps/api`), Postgres + Drizzle (`packages/db`), Vitest + RTL, `next/og` ImageResponse (satori).

## Global Constraints

- Test: `pnpm turbo run test --concurrency=1` (DB suites need `TEST_DATABASE_URL`). Typecheck: `pnpm turbo run typecheck`.
- To migrate the test DB: `DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @onelife/db run db:migrate` (drizzle-kit reads `DATABASE_URL` ONLY).
- Local Postgres host port may be remapped (this machine: 5434) — check `docker ps`.
- Loading, failed, empty and zero are four different renders. Never let an in-flight/failed fetch render an authoritative zero.
- Ownership/access are WHERE-clause predicates; the boundary is a **verified** `gamertag_links` row.
- ⚠️ comments are load-bearing — do not delete one except where this plan explicitly says the thing it documents is being removed.
- `REBUILD_TRUNCATE_TABLES` (`apps/projector/src/rebuild.ts`) must NOT change in this release.
- Never source `.env` for the web suite.
- Commit style: `git add` explicit paths (never `git add -A` at repo root). Every commit message ends with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- UI copy never says "friends" after this round; the map feature is "Sharing" / "People online".
- Card/interstitial copy (exact strings): title `{NAME} dares you to survive DayZ One Life`; description `One life. One death. One 24-hour ban. Earn your way back or stay in the dirt.`; kicker `{NAME} IS OUT THERE WAITING` (generic: `SOMEONE IS OUT THERE WAITING`); headline `COME DIE WITH ME.` with DIE in `#FF1E12`; baseline left `EVERY LIFE ENDS IN AN OBITUARY. YOURS IS WAITING.`, right `DAYZONELIFE.COM`; spine `ONE LIFE / No respawns`, `ONE DEATH / It counts`, `24H BAN / Then earn it back`.

---

### Task 1: Branch + commit the spec

**Files:**
- Commit: `docs/superpowers/specs/2026-07-30-update-round-v069-design.md` (already written, untracked)
- Commit: `docs/superpowers/plans/2026-07-30-update-round-v069.md` (this file)

- [ ] **Step 1:** Invoke the `keel:start-work` skill to create the feature branch `feature/update-round-v069` off up-to-date `main`.
- [ ] **Step 2:** Commit the spec and plan:

```bash
git add docs/superpowers/specs/2026-07-30-update-round-v069-design.md docs/superpowers/plans/2026-07-30-update-round-v069.md
git commit -m "docs: spec + plan for update round v0.69"
```

---

### Task 2: Share bar slim-down

**Files:**
- Modify: `apps/web/src/components/account/share-bar.tsx`
- Test: `apps/web/src/components/account/share-bar.test.tsx`

**Interfaces:**
- Produces: `ShareBar({ link }: { link: string })` — unchanged signature; renders ONLY: readonly link input (aria-label "Your invite link"), a "Copy link" button, and the `aria-live` note span.

- [ ] **Step 1:** Update `share-bar.test.tsx`: delete every test that queries a share target (`Share on X`, `Share on Reddit`, `Share on WhatsApp`, `Share by email`, `Copy for Discord`) or the native `More…` button / `navigator.share`. Add:

```tsx
it("renders no social share targets", () => {
  render(<ShareBar link="https://dayzonelife.com/i/vixxen" />);
  expect(screen.queryByLabelText(/share on/i)).toBeNull();
  expect(screen.queryByLabelText(/discord/i)).toBeNull();
  expect(screen.queryByText("More…")).toBeNull();
});
```

Keep (or add if missing) the copy-confirmation test: clicking "Copy link" writes the link to the clipboard and shows "Link copied ✓" in the `aria-live` region.

- [ ] **Step 2:** Run `pnpm --filter web test -- share-bar` — new test fails (targets still render).
- [ ] **Step 3:** Rewrite `share-bar.tsx`: delete `SHARE_TEXT`, `Target`, `TARGETS`, `enc`, the `canNative` state + effect, the icon row, the "Share to" label, and the native button. Keep the header ⚠️ only as one line noting the row was removed 2026-07-30 (v0.69 spec §1). Resulting component:

```tsx
"use client";
import { useState } from "react";
import { cn } from "@/lib/utils";

/** The invite link + copy control. The social-target row and native-share button were removed
 *  2026-07-30 (v0.69 spec §1) — they did not work as intended. */
export function ShareBar({ link }: { link: string }) {
  const [note, setNote] = useState("");
  const copy = () => {
    void navigator.clipboard?.writeText(link).catch(() => {});
    setNote("Link copied ✓");
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          readOnly
          value={link}
          aria-label="Your invite link"
          onFocus={(e) => e.currentTarget.select()}
          className={cn("min-w-0 flex-1 border-2 px-3.5 py-3 font-mono text-[15px] tracking-[.02em] outline-none", "border-hairline bg-paper text-ink")}
        />
        <button
          type="button"
          onClick={copy}
          className="min-h-[48px] flex-none bg-ink px-6 font-display text-sm font-bold uppercase tracking-[.08em] text-paper"
        >
          Copy link
        </button>
      </div>
      {/* Live region so the copy confirmation is announced, not just seen. Starts empty. */}
      <span aria-live="polite" className="font-mono text-[10px] uppercase tracking-[.1em] text-ink">
        {note}
      </span>
    </div>
  );
}
```

- [ ] **Step 4:** Run `pnpm --filter web test -- share-bar` — PASS.
- [ ] **Step 5:** Commit: `git add apps/web/src/components/account/share-bar.tsx apps/web/src/components/account/share-bar.test.tsx && git commit -m "feat(web): slim share bar to link + copy"`

---

### Task 3: Controls slab rhythm

**Files:**
- Modify: `apps/web/src/components/account/controls-slab.tsx`
- Test: `apps/web/src/components/account/controls-slab.test.tsx`

**Interfaces:**
- Consumes: `ShareBar` from Task 2.
- Produces: `ControlsSlab()` — both halves render exactly one control row (field + button) over their hint.

- [ ] **Step 1:** In `controls-slab.test.tsx`, delete assertions on the "Earn by" chips (`+1 on the 1st`, `+1 per invite`). Add:

```tsx
it("renders no earn-by chips — both halves are field + button + hint", () => {
  renderSlab(); // use the file's existing render helper with verified status
  expect(screen.queryByText("+1 on the 1st")).toBeNull();
  expect(screen.queryByText("+1 per invite")).toBeNull();
});
```

- [ ] **Step 2:** Run `pnpm --filter web test -- controls-slab` — new test fails.
- [ ] **Step 3:** In `controls-slab.tsx`: delete `EarnChips` and `EARN_RULES`. In the "Your tokens" half, the `control` prop becomes just `<SendField own={gamertag} />` (drop the wrapping `div.flex.flex-col.gap-3`). Update the `Half` skeleton comment: the shared shape is now `h2 + inline figure → one sentence → [mt-auto] field+button → hint`, and note the chips left with the share row (v0.69 spec §1+2) — the halves square because each control is exactly one row.
- [ ] **Step 4:** Run `pnpm --filter web test -- controls-slab share-bar verified-home` — PASS.
- [ ] **Step 5:** Commit: `git add apps/web/src/components/account/controls-slab.tsx apps/web/src/components/account/controls-slab.test.tsx && git commit -m "feat(web): re-square controls slab after share-row removal"`

---

### Task 4: Invite interstitial (`/i/{slug}` returns 200 HTML)

**Files:**
- Modify: `apps/web/src/app/i/[slug]/route.ts`
- Test: `apps/web/src/app/i/[slug]/route.test.ts`

**Interfaces:**
- Consumes: `REFERRAL_COOKIE`, `REFERRAL_COOKIE_MAX_AGE`, `isStorableSlug` from `@/lib/referral-cookie` (unchanged).
- Produces: `GET /i/{slug}` → 200 `text/html` with OG tags + bounce; still sets the referral cookie for storable slugs. `og:image` points at `/i/{slug}/card` (Task 5).

- [ ] **Step 1:** Rewrite `route.test.ts`. The existing cookie tests carry over (storable slug sets cookie, junk slug doesn't); the 307 assertions become 200 assertions. Cover:

```ts
it("returns 200 HTML with OG tags and a bounce to /", async () => {
  const res = await GET(new Request("https://dayzonelife.com/i/vixxen_84"), { params: Promise.resolve({ slug: "vixxen_84" }) });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/html");
  const html = await res.text();
  expect(html).toContain('property="og:title" content="VIXXEN_84 dares you to survive DayZ One Life"');
  expect(html).toContain('property="og:image" content="https://dayzonelife.com/i/vixxen_84/card"');
  expect(html).toContain('name="twitter:card" content="summary_large_image"');
  expect(html).toContain('name="robots" content="noindex"');
  expect(html).toContain('location.replace("/")');
  expect(html).toContain("http-equiv=\"refresh\"");
});

it("escapes HTML in the slug", async () => {
  const res = await GET(new Request("https://x.test/i/a%22b"), { params: Promise.resolve({ slug: 'a"b' }) });
  const html = await res.text();
  expect(html).not.toContain('a"b dares'); // raw quote must not survive into an attribute
  expect(html).toContain("&quot;");
});

it("renders generic copy and sets no cookie for a non-storable slug", async () => {
  // reuse the file's existing non-storable fixture value
  // assert: no set-cookie header, and og:title contains "Someone dares you"
});
```

- [ ] **Step 2:** Run `pnpm --filter web test -- "i/\[slug\]/route"` — FAIL (still a 307).
- [ ] **Step 3:** Rewrite the handler:

```ts
import { NextResponse } from "next/server";
import { REFERRAL_COOKIE, REFERRAL_COOKIE_MAX_AGE, isStorableSlug } from "@/lib/referral-cookie";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The invite link — an HTML interstitial, not a redirect (v0.69 spec §3).
 *
 * ⚠️ 200 + OG tags + client bounce, for EVERY caller. Unfurlers need HTML and never follow a
 * redirect to render a preview; humans bounce via script (or meta refresh without JS). No UA
 * sniffing — one shape for everyone.
 *
 * ⚠️ Still a Route Handler: only Route Handlers and server actions may set cookies. It creates
 * NO `referrals` row — the claim is made after sign-in by `app/api/referral/claim/route.ts`.
 */
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const storable = isStorableSlug(slug);
  const origin = new URL(req.url).origin;
  const name = storable ? esc(slug.toUpperCase()) : null;
  const title = name ? `${name} dares you to survive DayZ One Life` : "Someone dares you to survive DayZ One Life";
  const desc = "One life. One death. One 24-hour ban. Earn your way back or stay in the dirt.";
  const self = `${origin}/i/${encodeURIComponent(slug)}`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<meta name="robots" content="noindex">
<meta property="og:site_name" content="DayZ One Life">
<meta property="og:type" content="website">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${self}">
<meta property="og:image" content="${self}/card">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${self}/card">
</head><body>
<script>location.replace("/")</script>
<noscript><meta http-equiv="refresh" content="0;url=/"><a href="/">Continue to DayZ One Life</a></noscript>
</body></html>`;
  const res = new NextResponse(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  if (storable) {
    res.cookies.set(REFERRAL_COOKIE, slug, {
      httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: REFERRAL_COOKIE_MAX_AGE,
    });
  }
  return res;
}
```

- [ ] **Step 4:** Run the route tests — PASS.
- [ ] **Step 5:** Commit: `git add "apps/web/src/app/i/[slug]/route.ts" "apps/web/src/app/i/[slug]/route.test.ts" && git commit -m "feat(web): invite interstitial serves OG tags"`

---

### Task 5: Invite OG card (`/i/{slug}/card`)

**Files:**
- Create: `apps/web/src/og-assets/` — MOVE `oswald-700.ttf`, `plex-mono-400.ttf`, `plex-mono-700.ttf`, `wordmark.png`, `skull.png` here from `apps/web/src/app/(site)/(boxed)/players/[slug]/` (`git mv`), so both OG renderers share one copy.
- Modify: `apps/web/src/app/(site)/(boxed)/players/[slug]/opengraph-image.tsx` — its `asset()` helper reads `new URL("../../../../og-assets/" + name, import.meta.url)`; verify the relative depth compiles by running the web typecheck.
- Create: `apps/web/src/app/i/[slug]/card/route.tsx`
- Test: `apps/web/src/app/i/[slug]/card/route.test.ts`

**Interfaces:**
- Produces: `GET /i/{slug}/card` → 200 `image/png`, 1200×630. Design locked 2026-07-30 (artifact a3b + K5).

- [ ] **Step 1:** Write `route.test.ts` (ImageResponse renders in the node test runtime; assert transport, not pixels):

```ts
import { GET } from "./route";

it("returns a 1200x630 png", async () => {
  const res = await GET(new Request("https://x.test/i/vixxen_84/card"), { params: Promise.resolve({ slug: "vixxen_84" }) });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("image/png");
});

it("does not throw on a non-storable slug (generic card)", async () => {
  const res = await GET(new Request("https://x.test/i/%00/card"), { params: Promise.resolve({ slug: " " }) });
  expect(res.status).toBe(200);
});
```

- [ ] **Step 2:** Run it — FAIL (module not found).
- [ ] **Step 3:** Implement `route.tsx`:

```tsx
import { readFile } from "node:fs/promises";
import { ImageResponse } from "next/og";
import { isStorableSlug } from "@/lib/referral-cookie";

export const runtime = "nodejs";

const asset = (name: string) => readFile(new URL(`../../../og-assets/${name}`, import.meta.url));
const dataUri = (buf: Buffer) => `data:image/png;base64,${buf.toString("base64")}`;

const DARK = "#0C0C08", PAPER = "#FBFAF2", RED = "#FF1E12", DIM = "#8A8878";

/** The invite unfurl card (v0.69 spec §3, design a3b/K5). Satori-safe: flex only, no shadows. */
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const [oswald, mono, monoBold, wordmarkBuf, skullBuf] = await Promise.all([
    asset("oswald-700.ttf"), asset("plex-mono-400.ttf"), asset("plex-mono-700.ttf"),
    asset("wordmark.png"), asset("skull.png"),
  ]);
  const name = isStorableSlug(slug) ? slug.toUpperCase() : null;
  const kicker = name ? `${name} IS OUT THERE WAITING` : "SOMEONE IS OUT THERE WAITING";
  // Long gamertags drop the kicker a step instead of wrapping — same trick as the dossier card.
  const kickerSize = kicker.length > 34 ? 18 : 22;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: DARK, color: PAPER, fontFamily: "Oswald" }}>
        {/* left column */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "60px 56px 60px 74px", position: "relative" }}>
          <img src={dataUri(skullBuf)} width={470} height={582} style={{ position: "absolute", left: -120, bottom: -160, opacity: 0.06 }} />
          <img src={dataUri(wordmarkBuf)} height={46} style={{ alignSelf: "flex-start" }} />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontFamily: "IBM Plex Mono", fontSize: kickerSize, fontWeight: 700, letterSpacing: 3, color: DIM, textTransform: "uppercase" }}>{kicker}</div>
            <div style={{ fontSize: 126, fontWeight: 700, lineHeight: 0.94, letterSpacing: -1, textTransform: "uppercase", marginTop: 18, display: "flex", flexDirection: "column" }}>
              <span style={{ display: "flex" }}>Come&nbsp;<span style={{ color: RED }}>die</span></span>
              <span>with me.</span>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontFamily: "IBM Plex Mono", fontSize: 17, color: DIM, letterSpacing: 0.5, textTransform: "uppercase" }}>Every life ends in an obituary. Yours is waiting.</span>
            <span style={{ fontFamily: "IBM Plex Mono", fontSize: 17, fontWeight: 700, letterSpacing: 1.5, color: PAPER, textTransform: "uppercase", marginLeft: 24 }}>dayzonelife.com</span>
          </div>
        </div>
        {/* red spine: three equal thirds */}
        <div style={{ width: 300, background: RED, color: PAPER, display: "flex", flexDirection: "column", padding: "36px 44px" }}>
          {[
            ["One life", "No respawns", false],
            ["One death", "It counts", true],
            ["24h ban", "Then earn it back", true],
          ].map(([label, sub, divider]) => (
            <div key={label as string} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", borderTop: divider ? "2px solid rgba(251,250,242,.35)" : "none" }}>
              <span style={{ fontSize: 44, fontWeight: 700, lineHeight: 1, textTransform: "uppercase", whiteSpace: "nowrap" }}>{label}</span>
              <span style={{ fontFamily: "IBM Plex Mono", fontSize: 15, letterSpacing: 2, textTransform: "uppercase", opacity: 0.75, marginTop: 8 }}>{sub}</span>
            </div>
          ))}
        </div>
      </div>
    ),
    {
      width: 1200, height: 630,
      fonts: [
        { name: "Oswald", data: oswald, weight: 700, style: "normal" },
        { name: "IBM Plex Mono", data: mono, weight: 400, style: "normal" },
        { name: "IBM Plex Mono", data: monoBold, weight: 700, style: "normal" },
      ],
    },
  );
}
```

- [ ] **Step 4:** Run the card tests and the existing `players/[slug]` page tests (asset move must not break the dossier card): `pnpm --filter web test -- card players` — PASS. Run `pnpm --filter web run typecheck`.
- [ ] **Step 5:** Visual spot-check: `curl -s http://localhost:3000/i/vixxen_84/card -o /tmp/card.png` against a running dev server if one is up; otherwise note it for the browser-check list.
- [ ] **Step 6:** Commit: `git add -A apps/web/src/og-assets "apps/web/src/app/i/[slug]/card" "apps/web/src/app/(site)/(boxed)/players/[slug]" && git commit -m "feat(web): invite OG card route"`

---

### Task 6: Web friends UI teardown

**Files:**
- Delete: `apps/web/src/app/(site)/(boxed)/friends/` (page + loading), `apps/web/src/components/friends/` (all 10 files), `apps/web/src/components/player/friend-button.tsx` + `.test.tsx`
- Modify: `apps/web/src/components/shell/nav-menu.tsx` (drop the Friends block, lines ~126–137), `apps/web/src/components/shell/nav-menu.test.tsx`, `apps/web/src/lib/nav.test.ts` (drop `/friends` rows), `apps/web/src/components/account/account-panels.tsx` (drop `OnlineFriendsContainer` import + mount + its ⚠️), `apps/web/src/components/player/player-profile.tsx` (drop `FriendButton` import + render), `apps/web/src/components/player/player-profile.test.tsx`, `apps/web/src/content/legal/privacy.tsx` (lines ~103, ~109, ~212)
- Modify: `apps/web/src/components/notifications/row.tsx` — remove any friend kinds from the `RED`/`BLUE` accent sets (unknown kinds already fall back to ink; rows render from stored title/body, so retired kinds keep rendering).

**Interfaces:**
- Consumes: nothing new. Task 7 removes the lib functions these components called — this task must land first so nothing references them.

- [ ] **Step 1:** Delete the files/directories listed above (`git rm -r`).
- [ ] **Step 2:** Fix each modify-site: remove imports and render sites; in `privacy.tsx` replace the friendship bullets with session-grant wording (e.g. `<li>Your session location-sharing grants.</li>`; the data-deletion list at ~212 drops "your friendships"); in `nav.test.ts` remove `/friends` expectations.
- [ ] **Step 3:** Run `pnpm --filter web test` and `pnpm --filter web run typecheck`. Expected: type errors ONLY in `lib/api.ts` / `lib/types.ts` / `use-friends.ts` are NOT acceptable — those files still define the friend functions until Task 7, so this task must leave web green. Fix any missed reference.
- [ ] **Step 4:** Commit: `git add -A apps/web/src && git commit -m "feat(web): remove friends UI"` (`-A` scoped to `apps/web/src` is fine — the deletions must be staged).

---

### Task 7: Web lib friends teardown

**Files:**
- Delete: `apps/web/src/lib/use-friends.ts`
- Modify: `apps/web/src/lib/api.ts` — delete `getFriends`, `getOnlineFriends`, `getFriendStatus`, `sendFriendRequest`, `acceptFriendRequest`, `declineFriendRequest`, `deleteFriendship`, `patchFriendPresence`, `patchPreferences`, and their type imports. KEEP `getServers`, `getFriendMap`, `shareLocationWith`, `stopSharingWith`, `stopSharingAll` (renamed in Task 11).
- Modify: `apps/web/src/lib/types.ts` — delete `OnlineFriend`, `FriendStatusValue`, `FriendEntryDto`, `FriendsFeed`, `FriendStatusDto`. KEEP `FriendPositionDto`, `FriendMap`, `MapServerDto` (renamed in Task 11); drop `friendCount` from `MapServerDto` now (no UI renders it).
- Modify: `apps/web/src/type-floor-guard.test.ts` if it pins any deleted type.

- [ ] **Step 1:** Make the deletions.
- [ ] **Step 2:** `pnpm --filter web test && pnpm --filter web run typecheck` — green (Task 6 removed all consumers).
- [ ] **Step 3:** Commit: `git add -A apps/web/src/lib apps/web/src/type-floor-guard.test.ts && git commit -m "feat(web): remove friends client lib"`

---

### Task 8: API + notifier friends teardown

**Files:**
- Delete: `apps/api/src/routes/friends.ts`, `apps/api/test/friends-routes.test.ts`, `apps/api/src/routes/preferences.ts` (the `user_preferences` table only ever held `sharePresence` — the whole route goes), `apps/notifier/src/generators/presence.ts`, `apps/notifier/test/presence.test.ts`
- Modify: `apps/api/src/app.ts` — drop `registerFriendRoutes` + `registerPreferenceRoutes` imports/calls (keep `registerFriendMapRoutes` until Task 11)
- Modify: `apps/api/src/routes/friend-map.ts` — delete the `GET /me/friends/online` route (line ~98) and its `getOnlinePlayers`-based friend listing if used only there (check: the map payload's own online list lives in `GET /me/maps/:mapSlug` — keep that)
- Modify: `apps/api/test/friend-map-routes.test.ts` — drop `/me/friends/online` tests
- Modify: `apps/notifier/src/main.ts` — drop `presenceGenerator` import + registry entry

- [ ] **Step 1:** Make the deletions/edits.
- [ ] **Step 2:** `pnpm --filter @onelife/api test && pnpm --filter @onelife/notifier test` (use actual package names from each `package.json`), plus typecheck both. Green.
- [ ] **Step 3:** Commit: `git add -A apps/api apps/notifier && git commit -m "feat(api,notifier): remove friends routes and presence pushes"`

---

### Task 9: Slim + rename `packages/friends` → `packages/location-sharing`

**Files:**
- Rename: `packages/friends` → `packages/location-sharing` (`git mv`); `package.json` name → `@onelife/location-sharing`
- Delete inside it: `src/pair.ts`, `src/mutations.ts`, `src/queries.ts`, `src/presence.ts`, `src/errors.ts`, `test/pair.test.ts`, `test/mutations.test.ts`, `test/presence.test.ts`
- Modify: `src/notify.ts` — keep ONLY `writeNotification`, `locationSharedNotification`, `playerSlug`, and the `FriendNotificationDraft` type (rename to `NotificationDraft`); delete `requestNotification`, `acceptedNotification`
- Modify: `src/index.ts` — exports become exactly: `writeNotification`, `locationSharedNotification`, `playerSlug`, `NotificationDraft`, `currentSessionStart`, `grantLocation`, `revokeLocation`, `revokeAllLocation`, `clearLocationSharesFor`, `isShareEffective`, `activeGrantees` (keep location.ts's ⚠️ header intact)
- Modify importers: `apps/api/src/routes/friend-map.ts`, `apps/verifier/src/pg-store.ts`, `apps/projector/src/pg-store.ts` (check each — some hits are comments), any `"@onelife/friends"` in `package.json` dependency lists (`grep -rn "@onelife/friends" --include=package.json`) → `@onelife/location-sharing` with `pnpm install` to refresh the lockfile

- [ ] **Step 1:** `grep -rln "@onelife/friends" --include="*.ts" --include="*.json" apps packages` — enumerate every importer before touching anything.
- [ ] **Step 2:** Make the rename + deletions + import updates. `pnpm install`.
- [ ] **Step 3:** `pnpm turbo run typecheck` (whole repo) and `pnpm --filter @onelife/location-sharing test`. Green.
- [ ] **Step 4:** Commit: `git add -A packages apps pnpm-lock.yaml && git commit -m "refactor: slim friends package to @onelife/location-sharing"`

---

### Task 10: Drop migration

**Files:**
- Create: `packages/db/drizzle/0032_drop_friendships.sql`
- Modify: `packages/db/drizzle/meta/_journal.json` (append an entry with `tag: "0032_drop_friendships"`, mirroring the shape of the `0031` entry exactly — copy its `version`, bump `idx`, fresh `when`)
- Modify: `packages/db/src/schema.ts` — delete the `friendships` and `userPreferences` table definitions and their comment blocks (lines ~477–508); `grep -n "friendships\|userPreferences" packages/db/src` afterward must return nothing

**Interfaces:**
- Produces: a database without `friendships`/`user_preferences`; `location_shares` and `session_location_shares` untouched.

- [ ] **Step 1:** Write the migration:

```sql
-- v0.69: friends feature removed (spec 2026-07-30). Durable-table drop — deliberate and
-- irreversible. location_shares / session_location_shares are NOT touched: map sharing
-- runs on session-scoped grants, which survive the friends teardown.
DROP TABLE IF EXISTS "friendships";
--> statement-breakpoint
DROP TABLE IF EXISTS "user_preferences";
```

- [ ] **Step 2:** Append the journal entry; delete the schema definitions.
- [ ] **Step 3:** Migrate the test DB: `DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @onelife/db run db:migrate` (check `docker ps` for the port; NEVER rely on a `DATABASE_URL` fallback).
- [ ] **Step 4:** `pnpm turbo run test --concurrency=1` — full suite against the migrated DB. Any suite still selecting from `friendships` is a missed teardown; fix it, don't restore the table.
- [ ] **Step 5:** Commit: `git add packages/db && git commit -m "feat(db): drop friendships and user_preferences"`

---

### Task 11: Map surface rename — "friends" → "sharing"

**Files:**
- Rename: `apps/api/src/routes/friend-map.ts` → `map-share.ts` (`registerFriendMapRoutes` → `registerMapShareRoutes`; update `apps/api/src/app.ts`); `apps/api/test/friend-map-routes.test.ts` → `map-share-routes.test.ts`
- Modify: route payload — drop `friendCount` from the `/me/maps` server list (nothing renders it; its comment in `map-switcher.tsx` says so)
- Rename: `packages/read-models/src/friend-positions.ts` → `shared-positions.ts`; `getFriendPositions` → `getSharedPositions`, `FriendPosition` → `SharedPosition` (update `packages/read-models/src/index.ts` + the API importer)
- Rename: `apps/web/src/components/map/shell/friends-panel.tsx` → `share-panel.tsx` (`FriendsPanel` → `SharePanel`) + its test; `apps/web/src/components/map/friends-map.tsx` → `positions-map.tsx` (`FriendsMap` → `PositionsMap`) + tests
- Modify: `apps/web/src/lib/api.ts` (`getFriendMap` → `getMapShare`), `apps/web/src/lib/types.ts` (`FriendMap` → `MapShare`, `FriendPositionDto` → `SharedPositionDto`, `friend: boolean` field → keep the wire name if the API still sends it — ONLY rename wire fields the API renames in this same task; the `friend` flag on positions derives from friendships and is now always meaningless, so DELETE it from the API payload and the web type together), `apps/web/src/components/map/map-page.tsx` (imports, `friendsError` prop → `shareError`, and copy: "to see where your friends are." → "to see who's sharing with you."; "Verify your gamertag to see your friends here." → "Verify your gamertag to see shared positions.")
- Modify: any remaining user-visible "friend" copy: `grep -rin "friend" apps/web/src --include="*.tsx" -l` after the renames and sweep what's left (comments referencing history may stay; UI strings may not)

- [ ] **Step 1:** API side first: rename file/function/route paths `/me/friends/…` → none remain (deleted in Task 8); `/me/maps/:mapSlug/shares` paths are already share-shaped — keep. Drop `friendCount` + `friend` from payloads. Update tests. `pnpm --filter <api-pkg> test` green.
- [ ] **Step 2:** Read-model rename + `pnpm --filter @onelife/read-models test` green.
- [ ] **Step 3:** Web side renames + copy sweep. `pnpm --filter web test && pnpm --filter web run typecheck` green.
- [ ] **Step 4:** Commit: `git add -A apps/api apps/web packages/read-models && git commit -m "refactor: map sharing surfaces drop the friends vocabulary"`

---

### Task 12: All maps on the dossier

**Files:**
- Modify: `packages/read-models/src/player-page.ts` (the `continue` at ~line 140)
- Test: `packages/read-models/test/player-page.test.ts`

**Interfaces:**
- Produces: `getPlayerPage` returns one `ServerStanding` per active server, always; unknown gamertags still return `null`.

- [ ] **Step 1:** Add failing tests (use the suite's existing seed helpers):

```ts
it("emits a never-played idle card for an active server the player has no history on", async () => {
  // seed two active servers; give the player one life on server A only
  const page = await getPlayerPage(db, "Sasha", now, { page: 1 });
  expect(page!.standing).toHaveLength(2);
  const b = page!.standing.find((s) => s.serverId === serverB.id)!;
  expect(b).toMatchObject({ state: "idle", lastLifeNumber: null, lastEndedAt: null, alive: null, ban: null });
});

it("still returns null for a gamertag with no history anywhere", async () => {
  expect(await getPlayerPage(db, "NeverSeen", now, { page: 1 })).toBeNull();
});
```

- [ ] **Step 2:** Run — first test FAILS (standing has length 1).
- [ ] **Step 3:** Implement. Replace the skip:

```ts
if (livesRows.length === 0 && !serverBan && !anyOpenLife) {
  // v0.69: every active server gets a ticket. A never-played card is idle with no life to
  // name — it contributes nothing to totals and cannot make the page exist on its own
  // (see the guard below), so unknown gamertags still 404.
  standing.push({ serverId: s.id, map: s.map, slug: s.slug, state: "idle", alive: null, ban: null, lastLifeNumber: null, lastEndedAt: null });
  continue;
}
```

and replace the existence guard `if (standing.length === 0 && total === 0) return null;` with:

```ts
const anyHistory = standing.some((c) => c.state !== "idle" || c.lastLifeNumber != null);
if (!anyHistory && total === 0) return null;
```

- [ ] **Step 4:** `pnpm --filter @onelife/read-models test` — PASS (including every pre-existing player-page test).
- [ ] **Step 5:** Commit: `git add packages/read-models && git commit -m "feat(read-models): dossier standings cover every active server"`

---

### Task 13: Ticket links — alive only

**Files:**
- Modify: `apps/web/src/components/player/ticket-stage.tsx` (the `linkable` const and the ⚠️ TIMELINE LINKS comment)
- Test: `apps/web/src/components/player/ticket-stage.test.tsx` (or wherever the existing link-rule tests live — find with `grep -rn "Timeline" apps/web/src/components/player --include="*.test.tsx"`)

- [ ] **Step 1:** Update tests: a banned ticket renders NO `Timeline →` link (owner and public); an alive ticket does; idle/never-played don't. Run — the banned case FAILS (link still renders).
- [ ] **Step 2:** Change `const linkable = r.life != null && r.state !== "idle";` to `const linkable = r.life != null && r.state === "alive";`. Extend the ⚠️ comment with the fourth flip: *(Steve, 2026-07-30, v0.69): banned dropped too — only a card about a currently-RUNNING life links to a live record; the ban card still names its life in the sub-line, and past lives are reachable from the morgue.* The spend control's condition is unchanged (`owner && r.state === "banned" && r.ban`) — verify a banned owner still sees the spend button in the tests.
- [ ] **Step 3:** `pnpm --filter web test -- ticket-stage` — PASS.
- [ ] **Step 4:** Commit: `git add apps/web/src/components/player && git commit -m "feat(web): timeline links on alive tickets only"`

---

### Task 14: Entity classifier in `@onelife/domain`

**Files:**
- Create: `packages/domain/src/entities.ts`
- Modify: `packages/domain/src/index.ts` (export it)
- Modify: `packages/adm-parser/src/death.ts` (consume it; add `@onelife/domain` to `packages/adm-parser/package.json` workspace deps if absent — check first)
- Test: `packages/domain/test/entities.test.ts`

**Interfaces:**
- Produces: `classifyEntityLabel(label: string | null): "wolf" | "bear" | "animal" | null` — first-match-wins over the DayZ class-name dict. Used by Task 15 for hit labels and by `death.ts` for death entities.

- [ ] **Step 1:** Test first:

```ts
import { classifyEntityLabel } from "../src/entities.js";

it("classifies DayZ entity class names", () => {
  expect(classifyEntityLabel("Animal_CanisLupus")).toBe("wolf");
  expect(classifyEntityLabel("Animal_UrsusArctos")).toBe("bear");
  expect(classifyEntityLabel("Animal_CapreolusCapreolus")).toBe("animal");
  expect(classifyEntityLabel("Transport_CivilianSedan")).toBeNull();
  expect(classifyEntityLabel(null)).toBeNull();
});
```

- [ ] **Step 2:** Run — FAIL. Implement:

```ts
// Ordered entity dict (first match wins) — moved verbatim from adm-parser's death.ts so hit
// labels and death entities classify with the SAME rules. Only class-name patterns
// confirmable from DayZ conventions ship; anything else returns null.
const ENTITY_CLASSES: readonly [RegExp, "wolf" | "bear" | "animal"][] = [
  [/^Animal_CanisLupus/, "wolf"],
  [/^Animal_UrsusArctos/, "bear"],
  [/^Animal_/, "animal"],
];

export function classifyEntityLabel(label: string | null): "wolf" | "bear" | "animal" | null {
  if (!label) return null;
  return ENTITY_CLASSES.find(([re]) => re.test(label))?.[1] ?? null;
}
```

- [ ] **Step 3:** Refactor `death.ts`: replace its `ENTITY_CAUSES` wolf/bear/animal rows with a call to `classifyEntityLabel` (the other entity rows, if any, stay). Run `pnpm --filter @onelife/adm-parser test` — the existing death-classification tests are the regression net; they must all pass unchanged.
- [ ] **Step 4:** Commit: `git add packages/domain packages/adm-parser pnpm-lock.yaml && git commit -m "refactor(domain): shared entity classifier"`

---

### Task 15: `encountersForLife` + timeline wiring (read-model + API)

**Files:**
- Modify: `packages/read-models/src/life-dossier.ts` (new export beside `summarizeEncounters`)
- Modify: `packages/read-models/src/life-timeline.ts` (fetch encounters for open AND ended lives; add to `LifeTimeline`)
- Test: `packages/read-models/test/life-dossier.test.ts`, `packages/read-models/test/life-timeline.test.ts`

**Interfaces:**
- Produces (used verbatim by Task 16's web types):

```ts
export interface LifeEncounter {
  category: "wolf" | "bear" | "animal" | "infected" | "player" | "fire" | "environment";
  attackerGamertag: string | null;   // set only for category "player"
  startedAt: Date;
  durationSeconds: number;           // last tick − first tick, whole seconds
  hits: number;
  hpLow: number | null;              // min victimHp across the encounter's ticks; null if all null
}
export async function encountersForLife(db: Database, gamertag: string, life: DossierLife, lastSeenAt: Date | null): Promise<LifeEncounter[]>
```
- `LifeTimeline` gains `encounters: LifeEncounter[]` (always present; `[]` when no hits).

- [ ] **Step 1:** Failing tests in `life-dossier.test.ts` (reuse the suite's hit-seeding helpers):

```ts
it("groups hit ticks into per-category encounters with the 120s gap rule", async () => {
  // seed: 3 infected ticks at t+10s/t+40s/t+70s, then 2 infected ticks at t+400s/t+420s,
  // 1 wolf tick (attackerType environment, attackerLabel Animal_CanisLupus) at t+50s,
  // 2 player ticks from "Raider" at t+200s/t+230s, on an ENDED life with endedAt = t+2000s
  const enc = await encountersForLife(db, "Sasha", life, null);
  expect(enc).toHaveLength(4);
  const infected = enc.filter((e) => e.category === "infected");
  expect(infected[0]).toMatchObject({ hits: 3, durationSeconds: 60 });
  expect(infected[1]).toMatchObject({ hits: 2 });
  expect(enc.find((e) => e.category === "wolf")).toMatchObject({ hits: 1 });
  expect(enc.find((e) => e.category === "player")).toMatchObject({ attackerGamertag: "Raider", hits: 2 });
});

it("splits simultaneous PvP by attacker and fire outranks category", async () => { /* two attackers same window -> two encounters; a FireplaceBase-labelled environment tick -> category fire */ });

it("suppresses the death-adjacent encounter", async () => {
  // ticks at endedAt−30s: inside RECENT_HIT_WINDOW_S (120) of endedAt → not emitted
});

it("covers an OPEN life through lastSeenAt", async () => {
  // life.endedAt null, hits after startedAt, lastSeenAt after the hits → encounters returned
});
```

- [ ] **Step 2:** Run — FAIL (no export). Implement in `life-dossier.ts`:

```ts
import { classifyEntityLabel } from "@onelife/domain";
// (RECENT_HIT_WINDOW_S is already imported at the top of this file)

export interface LifeEncounter { /* exactly as in Interfaces above */ }

const isFireLabel = (label: string | null) => (label ?? "").toLowerCase().includes("fire");

function encounterKey(h: { attackerType: string; attackerGamertag: string | null; attackerLabel: string | null }): string {
  if (isFireLabel(h.attackerLabel)) return "fire";
  if (h.attackerType === "infected") return "infected";
  if (h.attackerType === "player") return `player:${(h.attackerGamertag ?? "").toLowerCase()}`;
  const animal = classifyEntityLabel(h.attackerLabel);
  return animal ?? "environment";
}

/**
 * Per-encounter spans for the timeline (v0.69 spec §7). Same 120s gap rule as the ordeal
 * summaries; PvP groups per attacker; fire is checked before category (a fire tick is
 * attackerType "environment" but its own story).
 *
 * ⚠️ Window end for an OPEN life is `lastSeenAt ?? now` — `endedAt ?? startedAt` (the dossier's
 * rule) would give an open life a zero-width window and silently hide every fight.
 *
 * ⚠️ An encounter whose last tick lands within RECENT_HIT_WINDOW_S of the death is suppressed —
 * the death row already tells that story, and printing it twice reads as two fights.
 */
export async function encountersForLife(db: Database, gamertag: string, life: DossierLife, lastSeenAt: Date | null): Promise<LifeEncounter[]> {
  const windowEnd = life.endedAt ?? lastSeenAt ?? new Date();
  const p = (await db.select({ id: players.id }).from(players).where(eq(players.gamertag, gamertag)))[0];
  if (!p) return [];
  const ticks = await db.select({
    attackerType: hitEvents.attackerType, attackerGamertag: hitEvents.attackerGamertag,
    attackerLabel: hitEvents.attackerLabel, victimHp: hitEvents.victimHp, occurredAt: hitEvents.occurredAt,
  }).from(hitEvents).where(and(
    eq(hitEvents.serverId, life.serverId), eq(hitEvents.victimPlayerId, p.id),
    gte(hitEvents.occurredAt, life.startedAt), lte(hitEvents.occurredAt, windowEnd),
  ));
  const byKey = new Map<string, typeof ticks>();
  for (const t of ticks) {
    const k = encounterKey(t);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(t);
  }
  const out: LifeEncounter[] = [];
  for (const [key, group] of byKey) {
    const sorted = [...group].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    let span: typeof sorted = [];
    const flush = () => {
      if (span.length === 0) return;
      const last = span[span.length - 1]!.occurredAt;
      // death-adjacent suppression
      if (life.endedAt && (life.endedAt.getTime() - last.getTime()) / 1000 <= RECENT_HIT_WINDOW_S) { span = []; return; }
      const hps = span.map((t) => t.victimHp).filter((n): n is number => n != null);
      const category = key.startsWith("player:") ? "player" : (key as LifeEncounter["category"]);
      out.push({
        category,
        attackerGamertag: category === "player" ? span[0]!.attackerGamertag : null,
        startedAt: span[0]!.occurredAt,
        durationSeconds: Math.round((last.getTime() - span[0]!.occurredAt.getTime()) / 1000),
        hits: span.length,
        hpLow: hps.length ? Math.min(...hps) : null,
      });
      span = [];
    };
    for (const t of sorted) {
      if (span.length && (t.occurredAt.getTime() - span[span.length - 1]!.occurredAt.getTime()) / 1000 > ENCOUNTER_GAP_S) flush();
      span.push(t);
    }
    flush();
  }
  return out.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
}
```

- [ ] **Step 3:** Run the dossier tests — PASS.
- [ ] **Step 4:** Wire into `life-timeline.ts`: add `encounters: LifeEncounter[]` to the `LifeTimeline` interface (comment: *always present; `[]` when the life took no hits — fetched for open lives too, unlike the dossier*), add `encountersForLife(db, gamertag, life, playerRow[0]?.lastSeenAt ?? null)` to the existing `Promise.all`, and return it. NOTE the ordering hazard: `playerRow` resolves inside the same `Promise.all` — fetch the player row FIRST (hoist the `players.lastSeenAt` select above the `Promise.all`) so `lastSeenAt` can be passed in; keep the rest of the `Promise.all` as is and delete the now-duplicate select from it. Update `life-timeline.test.ts`: the "carries verdict/ordeals" test adds `expect(t!.encounters.length).toBeGreaterThan(0)`; the open-life test asserts `encounters` is present (not null) while verdict/ordeals stay null.
- [ ] **Step 5:** `pnpm --filter @onelife/read-models test` — PASS. The API route (`apps/api/src/routes/player-aggregate.ts`) spreads `...data`, so `encounters` rides the payload with no route change — confirm with the existing route test or add one assertion there.
- [ ] **Step 6:** Commit: `git add packages/read-models apps/api && git commit -m "feat(read-models): per-encounter spans on the life timeline"`

---

### Task 16: Encounters in the web timeline

**Files:**
- Modify: `apps/web/src/lib/types.ts` (add `EncounterDto`; `LifeTimelineData` gains `encounters: EncounterDto[]`)
- Modify: `apps/web/src/lib/life-timeline.ts` (`TimelineEvent` union + `buildTimeline`)
- Modify: `apps/web/src/components/life/timeline.tsx` (`DOT` gains yellow; `EventRow` renders the encounter branch)
- Test: `apps/web/src/lib/life-timeline.test.ts` (or the co-located test file — find it), `apps/web/src/components/life/timeline.test.tsx`

**Interfaces:**
- Consumes Task 15's wire shape (dates serialize to ISO strings over JSON):

```ts
export type EncounterDto = {
  category: "wolf" | "bear" | "animal" | "infected" | "player" | "fire" | "environment";
  attackerGamertag: string | null;
  startedAt: string;
  durationSeconds: number;
  hits: number;
  hpLow: number | null;
};
```
- Produces the event variant:

```ts
| { kind: "encounter"; at: Date; marker: "yellow"; timeLabel: string; title: string; line: string; attackerGamertag: string | null }
```

- [ ] **Step 1:** Failing `buildTimeline` tests:

```ts
it("interleaves encounters with the exact copy per category", () => {
  const data = fixture({ encounters: [
    { category: "wolf", attackerGamertag: null, startedAt: iso(t + 60_000), durationSeconds: 120, hits: 7, hpLow: 34 },
    { category: "infected", attackerGamertag: null, startedAt: iso(t + 300_000), durationSeconds: 240, hits: 12, hpLow: 21 },
    { category: "infected", attackerGamertag: null, startedAt: iso(t + 900_000), durationSeconds: 0, hits: 2, hpLow: null },
    { category: "player", attackerGamertag: "Raider", startedAt: iso(t + 600_000), durationSeconds: 30, hits: 3, hpLow: 58 },
  ]});
  const view = buildTimeline(data, now);
  const enc = view.events.filter((e) => e.kind === "encounter");
  expect(enc.map((e) => e.title)).toEqual(expect.arrayContaining([
    "Wolves — fought off",
    "Horde — 12 blows over 4m",
    "Infected — 2 blows",
    "Firefight",
  ]));
  const wolf = enc.find((e) => e.title.startsWith("Wolves"))!;
  expect(wolf.line).toBe("7 blows over 2m · HP down to 34");
  const two = enc.find((e) => e.title === "Infected — 2 blows")!;
  expect(two.line).toBe("2 blows"); // no HP → never fabricated
  const pvp = enc.find((e) => e.title === "Firefight")!;
  expect(pvp.attackerGamertag).toBe("Raider");
  expect(pvp.line).toBe("3 hits taken · HP 58");
});

it("renders no encounter rows for an encounter-free life", () => {
  const view = buildTimeline(fixture({ encounters: [] }), now);
  expect(view.events.some((e) => e.kind === "encounter")).toBe(false);
});
```

- [ ] **Step 2:** Run — FAIL. Implement in `life-timeline.ts` (title/line builders; exact copy):

```ts
function durLabel(seconds: number): string {
  return `${Math.max(1, Math.round(seconds / 60))}m`;
}

/** Exact copy per spec §7. HP appears only when a tick reported one — never fabricated. */
function encounterText(e: EncounterDto): { title: string; line: string } {
  const hp = e.hpLow == null ? null : `HP down to ${Math.round(e.hpLow)}`;
  const blows = `${e.hits} blow${e.hits === 1 ? "" : "s"}`;
  switch (e.category) {
    case "wolf":
      return { title: e.hits >= 3 ? "Wolves — fought off" : "A wolf — fought off", line: [`${blows} over ${durLabel(e.durationSeconds)}`, hp].filter(Boolean).join(" · ") };
    case "bear":
      return { title: "A bear — fought off", line: [`${blows} over ${durLabel(e.durationSeconds)}`, hp].filter(Boolean).join(" · ") };
    case "animal":
      return { title: "Wild animal — fought off", line: [blows, hp].filter(Boolean).join(" · ") };
    case "infected":
      return e.hits >= 3
        ? { title: `Horde — ${e.hits} blows over ${durLabel(e.durationSeconds)}`, line: hp ?? "Fought clear" }
        : { title: `Infected — ${blows}`, line: [blows, hp].filter(Boolean).join(" · ").replace(`${blows} · `, "").length ? [hp].filter(Boolean).join(" · ") || blows : blows };
    case "player":
      return { title: "Firefight", line: [`${e.hits} hit${e.hits === 1 ? "" : "s"} taken`, e.hpLow == null ? null : `HP ${Math.round(e.hpLow)}`].filter(Boolean).join(" · ") };
    case "fire":
      return { title: `Burned — ${blows}`, line: hp ?? "Got clear of the flames" };
    default:
      return { title: `Took a beating — ${e.hits} hit${e.hits === 1 ? "" : "s"}`, line: hp ?? "Walked it off" };
  }
}
```

NOTE the infected 1–2-hit line: simplify the implementation to `line: hp ?? blows` — the test above expects `"2 blows"` when hp is null; if hp exists the line is the hp. Do not ship the convoluted expression sketched above — write it as `{ title: `Infected — ${blows}`, line: hp ?? blows }` and make the ≥3 branch `{ title: `Horde — ${e.hits} blows over ${durLabel(e.durationSeconds)}`, line: hp ?? "Fought clear" }`.

In `buildTimeline`, after the kills loop:

```ts
for (const e of data.encounters) {
  const at = new Date(e.startedAt);
  const { title, line } = encounterText(e);
  events.push({ kind: "encounter", at, marker: "yellow", timeLabel: label(at), title, line, attackerGamertag: e.attackerGamertag });
}
```

- [ ] **Step 3:** Run `buildTimeline` tests — PASS.
- [ ] **Step 4:** `timeline.tsx`: `DOT` gains `yellow: "bg-yellow"`; update its `Record` key type to include `"yellow"`. Add the encounter branch to `EventRow` (before the generic fallback):

```tsx
) : e.kind === "encounter" ? (
  <>
    <p className="font-display text-xl font-bold uppercase leading-none text-ink">
      {e.title}
      {e.attackerGamertag && (
        <> — hit by <GamertagLink gamertag={e.attackerGamertag} /></>
      )}
    </p>
    <p className="mt-1.5 font-mono text-xs leading-relaxed text-ink-soft">{e.line}</p>
  </>
```

RTL test: an encounter event renders its title, its line, a yellow dot (`bg-yellow` class on the marker), and — for a player encounter — a link to the attacker's dossier.

- [ ] **Step 5:** Every existing timeline/page test that builds a `LifeTimelineData` fixture needs `encounters: []` added — sweep with `grep -rln "LifeTimelineData" apps/web/src --include="*.test.*"`.
- [ ] **Step 6:** `pnpm --filter web test && pnpm --filter web run typecheck` — PASS.
- [ ] **Step 7:** Commit: `git add apps/web/src && git commit -m "feat(web): encounters on the life timeline"`

---

### Task 17: Life timeline hero → dark stage

**Files:**
- Modify: `apps/web/src/components/life/hero.tsx` (full rewrite), `apps/web/src/components/life/hero.test.tsx`
- Modify: `apps/web/src/app/(site)/(boxed)/players/[slug]/[map]/lives/[n]/page.tsx` (wrapper restructure)

**Interfaces:**
- Consumes: `FitLine` from `@/components/front-page/fit-line`, `Avatar` from `@/components/shared/avatar`, existing `LifeTimelineView`/`LifeTimelineData` props (signature unchanged: `LifeHero({ data, view })`).

- [ ] **Step 1:** Update `hero.test.tsx` first. Pin: the h1 text `Life {n} · {map}`; the kicker `A life of {gamertag}`; the Alive/Died badge; the five stats; the obituary link when `obituarySlug` set; AND the dark-token swap (house rule — a component moving to a dark surface pins its tokens):

```tsx
it("uses dark-stage tokens", () => {
  const { container } = render(<LifeHero data={dead()} view={view(dead())} />);
  const section = container.querySelector("section")!;
  expect(section.className).toContain("bg-dark");
  expect(section.className).toContain("border-red");
});
```

- [ ] **Step 2:** Run — FAIL. Rewrite `hero.tsx`:

```tsx
import Link from "next/link";
import type { LifeTimelineData } from "@/lib/types";
import type { LifeTimelineView } from "@/lib/life-timeline";
import { Avatar } from "@/components/shared/avatar";
import { GamertagLink } from "@/components/gamertag-link";
import { FitLine } from "@/components/front-page/fit-line";
import { mapLabel, formatDuration, formatMeters } from "@/components/player/format";
import { playerSlug } from "@/lib/slug";

const KICKER = "font-mono text-xs uppercase tracking-[.28em] text-cream-dim";

/** Light-on-dark stat — the dossier stage's vocabulary, not the old boxed hero's. */
function Stat({ value, label, blue = false, srLabel }: { value: string; label: string; blue?: boolean; srLabel?: string }) {
  return (
    <div>
      <div className={`font-display text-[28px] font-bold leading-none ${blue ? "text-blue" : "text-paper"}`} aria-label={srLabel}>
        {srLabel ? (<><span aria-hidden="true">{value}</span><span className="sr-only">{srLabel}</span></>) : value}
      </div>
      <div className="mt-[3px] font-mono text-[11px] uppercase tracking-[.07em] text-cream-muted">{label}</div>
    </div>
  );
}

/**
 * The life page's dark stage (v0.69 spec §6) — the dossier hero's treatment applied to one life.
 * Full-bleed: the PAGE owns no horizontal padding; this section states its own px, exactly like
 * `TicketStage`. The back-link strip above is part of the same dark band.
 */
export function LifeHero({ data, view }: { data: LifeTimelineData; view: LifeTimelineView }) {
  const map = mapLabel(data.map);
  const dossier = `/players/${playerSlug(data.gamertag)}`;
  const h = view.hero;
  return (
    <>
      <div className="bg-dark px-6 pb-3 pt-6 md:px-10">
        <Link href={dossier} className="font-mono text-[11px] uppercase tracking-[.06em] text-cream-muted hover:text-paper">
          <span aria-hidden>← </span>{data.gamertag}&apos;s dossier
        </Link>
      </div>
      <section className="border-b-[6px] border-red bg-dark px-6 py-10 text-paper md:px-10 md:py-14">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-5 sm:flex-nowrap">
          {data.avatarHash != null && (
            <div className="flex-none"><Avatar hash={data.avatarHash} size={132} dim={!view.alive} /></div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <p className={KICKER}>A life of <GamertagLink gamertag={data.gamertag} className="font-bold text-paper underline" /> · {map}</p>
              {view.alive ? (
                <span className="bg-blue px-2 pb-0.5 pt-1 font-display text-[11px] font-bold uppercase tracking-[.1em] text-white">Alive</span>
              ) : (
                <span className="bg-red px-2 pb-0.5 pt-1 font-display text-[11px] font-bold uppercase tracking-[.1em] text-white">Died</span>
              )}
            </div>
            <h1 className="mt-2 font-display font-bold uppercase leading-[.9]">
              <FitLine finalText={`Life ${data.life.lifeNumber} · ${map}`} lineClassName="text-[clamp(2rem,6vw,5rem)]">
                {`Life ${data.life.lifeNumber} · ${map}`}
              </FitLine>
            </h1>
          </div>
        </div>
        <div className="mt-7 flex flex-wrap gap-x-7 gap-y-3">
          <Stat value={formatDuration(h.timeAliveSeconds)} label="Time alive" />
          <Stat value={String(h.kills)} label="Kills" />
          <Stat value={h.longestKillMeters == null ? "—" : formatMeters(h.longestKillMeters)} label="Longest kill" />
          <Stat value={String(h.sessions)} label="Sessions" />
          <Stat value={h.qualified ? "✓" : "—"} label="Qualified" blue={h.qualified} srLabel={h.qualified ? "Qualified" : "Not qualified"} />
        </div>
        {data.obituarySlug && (
          <Link href={`/obituaries/${data.obituarySlug}`} className="mt-5 inline-block font-mono text-[11px] font-bold uppercase tracking-[.06em] text-paper underline hover:text-red">
            Read the obituary →
          </Link>
        )}
      </section>
    </>
  );
}
```

Check `FitLine`'s actual props signature before use (`grep -n "export function FitLine" -A 6 apps/web/src/components/front-page/fit-line.tsx`) and match it — `TicketStage` is the reference call site.

- [ ] **Step 3:** Restructure the page wrapper in `page.tsx`: `<main className="w-full pb-10">` (no horizontal padding — the ⚠️ from `PlayerProfile` applies: sections state their own `px-6 md:px-10`); the hero mounts first; the timeline block becomes `<div className="mt-6 px-6 md:px-10">`.
- [ ] **Step 4:** `pnpm --filter web test -- hero life && pnpm --filter web run typecheck` — PASS.
- [ ] **Step 5:** Commit: `git add apps/web/src/components/life "apps/web/src/app/(site)/(boxed)/players/[slug]/[map]" && git commit -m "feat(web): dark-stage hero on the life timeline"`

---

### Task 18: Docs, changelog, PR

**Files:**
- Modify: `CLAUDE.md` (outstanding browser checks), `CHANGELOG.md` (last, via keel)

- [ ] **Step 1:** Append to CLAUDE.md's "Outstanding, un-verified work": the life-page dark hero on a phone and at 1024; a real Discord/X unfurl of `/i/{slug}` + the card's actual render once deployed; the controls slab at 390px after the share-row removal; encounter rows on a real life with hits.
- [ ] **Step 2:** Full verification: `pnpm turbo run test --concurrency=1 && pnpm turbo run typecheck` — all green, output read, not assumed.
- [ ] **Step 3:** Sweep for stragglers: `grep -rin "friend" apps packages --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -viv "location\|share\|history"` — every remaining hit must be a deliberate keep (justify each).
- [ ] **Step 4:** Invoke `keel:finish-work` — it runs checks, writes the CHANGELOG entry last, and opens the PR against `main`.

---

## Self-Review Notes

- Spec §1+2 → Tasks 2–3; §3 → Tasks 4–5; §4 → Tasks 6–11; §5 → Tasks 12–13; §6 → Task 17; §7 → Tasks 14–16; testing/deploy notes → Task 18 and the migration task. No gaps found.
- Teardown ordering (6→7→8→9→10) keeps every intermediate commit typechecking: UI before lib before API before package before schema.
- Type names used across tasks were cross-checked: `LifeEncounter` (15) ↔ `EncounterDto` (16, wire shape with ISO dates); `SharePanel`/`getMapShare`/`MapShare` (11); `classifyEntityLabel` (14→15).
- Known judgment calls left to the implementer WITH bounds stated in-task: exact test-helper names in existing suites (find, don't invent), `FitLine` props (read before use), package filter names (read `package.json`).
