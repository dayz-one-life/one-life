# Home polish + Discord-direct login — design

**Date:** 2026-07-28
**Status:** Approved

## 1. What this is

Seven follow-ups to the cold-home relaunch (v0.55.0) and avatar pass (v0.56.0): US-English copy;
the pitch extended to signed-in-but-unverified visitors with claim-focused CTAs; the rules and
obituary sections swapped; the page's closing restructured so no light sliver sits between dark
blocks; a two-column hero deck/CTA; `/login` forwarding straight to Discord when Discord is the
only method; and an honest fix for the avatar-sync 502. Web + one small API error-mapping change —
no migration, no new table, no env var: plain `./deploy/deploy.sh`, **no `--rebuild`**.

## 2. US English (item 1)

`HowToConnect`: "Favourite them…" → "Favorite them…". One word; pinned wherever the copy is
already asserted.

## 3. The pitch for unverified visitors (item 2)

`unlinked` and `pending` visitors see the same four-beat pitch as signed-out visitors, with the
ask redirected at what THEY need to do:

- Hero CTA and slab CTA read **`Link your gamertag →`** and link to the claim ladder ON the page
  (anchor `#claim` on the `AccountPanels` container) instead of `/login`.
- Slab headline stays `You get one life. Claim it`; the mono sub-line becomes
  `You're signed in · Link your gamertag · Your life shows up here` for these states.
- The claim ladder (AccountPanels) remains exactly where it is, now the CTA's target.

**Rendering/data mechanics (no verified flash, no per-load cost):**

- Stats + obituaries move from cookie-forwarding `apiGet` (gated on the signed-out cookie) to
  **`apiGetCached` with `revalidate: 60`** — both payloads are public and cookie-independent, so
  they are fetched UNCONDITIONALLY on every home render and served from the shared fetch cache.
  This also implements the cold-home review's caching recommendation and deletes the
  fetch-gating machinery (the "signed-in never fetches stats/obits" tests are retired
  deliberately — the cost argument they pinned is void once the fetch is cached and cookie-free;
  do not port them forward).
- Signed-out (no cookie): the pitch renders server-side exactly as today.
- Cookie present: the page passes the SAME pitch data to a client gate (`UnverifiedPitch`) that
  renders the four beats only once `accountStatus` resolves to `unlinked`/`pending`. SSR and the
  verified path render nothing there — a verified player NEVER sees a pitch flash; an unverified
  player sees the ladder immediately and the pitch appear once identity resolves (acceptable:
  content appearing beats content vanishing).
- The CTA variant (login vs anchor) is a prop (`audience: "cold" | "unverified"`) on the hero
  and slab, not a fork of either component.

## 4. Section order (item 3)

The pitch order becomes **hero → rules → fallen → CTA slab** (rules and fallen swap). Both
audiences.

## 5. The page's closing (item 4 — option A, agreed)

- The dark CTA slab keeps the headline, sub-line and button, and **loses the connect box**.
- **`HowToConnect` becomes its own light full-width closing section** (paper background, the
  page's last content block), directly after the slab — so the document ends light-content →
  dark footer like every other page.
- The account-panels wrapper (`div.px-6.py-8`) **does not render for signed-out visitors** —
  `AccountPanels` renders nothing meaningful there and its padded container was the light sliver
  between the dark slab and the dark footer. For signed-in states it renders as today (it is the
  ladder/standing surface, and the `#claim` anchor target).

## 6. Two-column hero deck + CTA (item 7)

In the hero, the deck paragraph and the claim button sit **side by side at `md+`** (stacked
below): deck left (keeps its measure), button right, with the button scaled to **fill its
column** — full width and height of the column, display-type label, the skew retained. One
`ClaimCta` keeps serving both hero and slab; the hero passes a fill variant
(`fill` prop → `flex h-full w-full items-center justify-center` + larger type) rather than a
second component.

## 7. Discord-direct login (item 5)

`/login` auto-forwards to Discord OAuth **when Discord is the only enabled auth method** (from
`GET /api/auth/providers`, which the login page already consults server-side): instead of
rendering the button page, the page renders a minimal "Redirecting to Discord…" interstitial
whose client effect immediately calls the existing Better Auth social sign-in for `discord`
(same `callbackURL` the button uses today — `/welcome`). Any other configuration (multiple
providers, magic-link enabled, nothing configured — i.e. dev environments) renders the existing
login panel unchanged. No backend change; `enabledAuthMethods()` stays the source of truth.
The interstitial carries a plain fallback link ("Continue to Discord →") in case the redirect
is blocked, and never renders a dead end.

## 8. Avatar-sync 502 (item 6)

`POST /me/avatar/sync` currently maps EVERY `fetchProviderImage` failure to `502 fetch_failed`.
In production the common failure is a **stale provider URL**: Discord rotates avatar CDN URLs,
and the copy stored on the auth account at sign-in eventually 404s (reporter saw it as
"non-verified users get a 502" — verification is coincidental).

- `fetchProviderImage` distinguishes an upstream **HTTP non-200** (the URL is live but the image
  is gone/moved — stale) from network/timeout/allowlist failures.
- The route maps stale → **`409 provider_image_stale`**; everything else keeps `502
  fetch_failed`. (409 matches the existing `no_provider_image` family: "your account state can't
  satisfy this," not "our infrastructure failed.")
- `AvatarPanel` maps both codes to honest copy: stale → "Discord has rotated your photo's link —
  sign out and back in to refresh it, or upload a photo directly."; `fetch_failed` → "Couldn't
  reach your login provider just now — try again in a minute." Announced via the existing
  `SrStatus` on settle.

## 9. Testing

- Copy: Favorite assertion updated.
- Pitch audiences: cold SSR unchanged (existing tests); `UnverifiedPitch` renders beats for
  unlinked/pending only (nothing for loading/verified — no flash, pinned); CTA hrefs by audience
  (cold → `/login`, unverified → `#claim`); slab sub-line variant; anchor id present on the
  panels container in signed-in renders.
- Fetch mechanics: home uses `apiGetCached` for stats + obits (no cookie forwarding — pinned by
  asserting the cached fetchers are called, not the cookie-forwarding ones); failed cached fetch
  still degrades per feed (hero evergreen, fallen absent).
- Order: rules before fallen in the rendered pitch.
- Closing: slab has no connect box; light `HowToConnect` section renders after it for both pitch
  audiences; account-panels wrapper absent from the signed-out DOM (and present, with `#claim`,
  for signed-in).
- Hero columns: deck + CTA in one `md:` two-column row; `ClaimCta fill` fills its container.
- Login: providers=[discord] → interstitial + auto-invoke of the discord social sign-in
  (mocked) + fallback link; providers=[discord, magicLink] (or any other set) → existing panel;
  providers fetch failure → existing panel (never a dead interstitial).
- Sync: route test — upstream 404 → 409 `provider_image_stale`; network refusal → 502; panel
  test — each code renders its message.
- Browser checklist (pre-release): unverified account sees the pitch with anchor CTAs that
  scroll to the ladder; Discord redirect round trip on the deployed site; hero columns at
  phone/desktop widths; page ends with no light sliver above the footer.
