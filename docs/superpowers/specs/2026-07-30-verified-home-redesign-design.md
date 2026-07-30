# Verified home + profile redesign — design

**Status:** approved, not built · **Date:** 2026-07-30 · **Branch:** `feature/verified-home-redesign`

The verified user's home was the one surface with no visual impact: cold, unlinked and pending all
open with a full-bleed dark stage and a display-scale `FitLine` h1, while verified opened straight
into light `StandingGroups` cards under a 10px mono label. It also carried none of the player's
controls. This spec replaces it, and makes the same surface serve the public dossier.

Converged live with Steve in a throwaway preview route over three rounds
(`apps/web/src/app/(site)/(boxed)/design-preview/page.tsx`, **untracked, never ships**). **That file
is the visual source of truth for §2–§4** — it holds the exact markup and a ⚠️ comment on every
decision that reversed an earlier one. Read it before implementing; this spec states the rules, not
every class.

## 1. Scope

**In:** the verified home (`/`), the public dossier (`/players/{slug}`), and the referral-link
plumbing the new invite panel needs.

**Out:** the cold / unlinked / pending home branches (untouched), the obituary feed and article
pages, the life timeline, `/maps`.

### 1.1 Rejected approaches, and why they must not come back

- **Round 1 (A/B/C) — a state-driven hero with one lead standing.** Scrapped wholesale. Every
  variant picked ONE standing for the h1, which cannot describe a player alive on two servers,
  banned on a third and clear on a fourth *at the same time*. **Multiplicity is the subject.** Fleet
  size is data, never a constant — see `docs/architecture/*` on the server fleet.
- **An aggregate headline ("2 LIVES RUNNING").** Implicitly second-person, so it broke the moment
  the same stage served someone else's public page. The aggregate survives as a tally strip.
- **Controls variants G2 (yellow invite slab) and G3 (dark continuation).** Built, compared,
  dropped. G2 would have required amending the standing "yellow is the only yellow section on the
  site" rule in `join-servers.tsx`; that question is now moot.
- **"View your public page."** The public view is the same stage minus affordances, so there is
  nothing to inspect, and the `?public=1` bypass it needed would put a query-string escape on a
  session-conditional redirect.

## 2. The stage

Full-bleed dark, red 6px bottom rule, `px-6 md:px-10`. Serves both viewers; the public viewer is
the same stage with affordances removed. No new data becomes public — `StandingCard` already
publishes state, run length, ban countdown and life number.

- **The gamertag is the h1**, `FitLine`-filled, with the 112px circular avatar beside it. Always via
  the shared `Avatar` (`variant="dark"`) — never a local `rounded-full`.
- **Owner only:** a 44px pencil overlapping the avatar opens the existing `AvatarPanel` flow.
  Consequence: the dossier's `OwnerAvatar` "Update photo ↓" disclosure becomes a second edit path
  and **is retired in this change**.
- **Tally strip** under the h1: `N alive · N banned · N clear · N servers`, yellow on a non-zero
  alive count, red on a non-zero banned count. ⚠️ Each item is `whitespace-nowrap` — at 390px it
  broke *inside* a pair ("0 / clear"), which reads as a different number.
- **One ticket per server**, all equal weight, grid scaling 1..N (`sm:grid-cols-3` at three,
  `sm:grid-cols-2 lg:grid-cols-4` at four or more). Solid border = live, dashed = clear, red =
  banned. A rotated `RECORD` stamp marks a personal best.
- A ticket with no figure prints `No life`. **Never fabricate a number for a life that does not
  exist.**
- An alive ticket inside the 5-minute grace window reads **`Not yet qualified`** and must never
  render as qualified.

### 2.1 Ticket affordances

- **Every ticket carries a `Timeline →` link, in BOTH viewers**, pointing at that ticket's own life:
  the running one when alive, the one that earned the ban on a banned ticket, the last one on an
  idle ticket. A server the player has never played has no life and renders **no link**, not a
  broken one.
  ⚠️ This reverses the round-3 rule "no ticket links out", which had itself reversed an earlier
  instruction. It is settled: the link stays.
- **`Spend 1 token` is owner-only and banned-only**, stacked above the timeline link. The ticket is
  the one place that knows WHICH ban a token would lift, which is why the action lives here and not
  in the token panel.

## 3. The controls slab (owner only)

One white slab, two halves, a single shared border, directly under the stage.

- ⚠️ **The slab runs edge-to-edge of the page column, exactly like the stage** (`px-6 md:px-10`, no
  outer padding wrapper). Sections below the stage take no wrapper padding; each states its own
  gutter. A padded wrapper made the slab read narrower than the hero.
- ⚠️ **The two-column split is `lg`, NOT `md`.** At `md` each half is only ~336px of content —
  narrower than the share row and than the heading-plus-figure line, so both wrapped raggedly across
  the whole 768–1023 band. Below `lg` the halves stack full width.
- **Both halves share one skeleton**, stated once: `h2 + inline figure → one sentence → [mt-auto]
  control → hint`. They align at the top on the shared heading row and at the bottom because
  `mt-auto` pushes the control group down. Do not reintroduce a per-half rhythm.
- ⚠️ **Figures are inline and small** (~20px numeral beside the heading). Display-scale numerals
  balanced the columns but cost ~90px per half and pushed the send field and share bar below the
  fold.
- `justify-between` on the heading row applies from `lg` only; below it the figure sits beside its
  heading rather than stranded at the page edge.

**Left half — Your tokens.** Balance inline (`3 in hand`), one sentence, the existing send-a-token
field, an `Earn by` chip row (`+1 on the 1st`, `+1 per invite`), hint `A token you send cannot come
back`.

**Right half — Invite a survivor.** Join count inline (`2 joined so far`), one sentence, the share
bar (§5.4), hint `+1 token when someone you invite verifies their gamertag`.

Row labels (`Share to`, `Earn by`) are `sr-only` below `sm` — their ~60px pushed the native-share
button onto a second row at 390px, and every target is individually labelled.

## 4. The morgue

Replaces the `PastLifeCard` grid on both viewers. Heading `Your obituaries` / `Obituaries` with an
inline count, then one entry per filed obituary: bureau dateline, the **headline linked to
`/obituaries/{slug}`**, the lede, the rap-sheet fact row, and a `Timeline →` button on the right.
Reuse `obituaryHref`, `dateline` and `rapSheetFacts` from `lib/obituary-format`; the entry is a
scoped variant of `ObituaryCard` with the gamertag line dropped (it is this player's page) and the
timeline button added.

⚠️ **This section lists FILED OBITUARIES ONLY** (explicitly chosen after the alternative was put to
Steve). `apps/newsdesk` files one only for a **qualified** death, only past the forward-only
`NEWSDESK_SINCE` cutoff, and can fail permanently at `NEWSDESK_MAX_ATTEMPTS`. The list is therefore
a strict **subset** of the player's lives, and unfiled lives appear nowhere on this page. **That is
intended — do not "restore" the missing lives.**

⚠️ Its consequence: **zero is a real and currently common state.** A player with eleven dead lives
and no filed obituary must get an explicit empty render, never a bare heading over nothing.
Loading, failed, empty and zero stay four different renders (`PageHeader`'s `count` union is the
pattern). The count reads *obituaries filed*, never *lives* — "11 lives filed" over two rows was
ambiguous.

## 5. Referral links (new)

### 5.1 What exists today

`referrals` (PK = referee `user_id`, so one referrer each, ever), `POST /me/referrer` taking a
**gamertag**, and `grantReferral` in `packages/tokens/src/sweeps.ts`. Nothing mints or resolves a
LINK. The invite panel in the preview is a mock, including its join count.

### 5.2 The link

`/i/{playerSlug}` — no new identifier, no new column: the slug is already public at
`/players/{slug}`. The route sets an httpOnly, `SameSite=Lax`, 30-day cookie naming the referrer and
`307`s to `/`. It must be **cheap and side-effect-free beyond the cookie**: it may not create a
`referrals` row, because the visitor has no account yet.

⚠️ The cookie, not the OAuth `state` parameter, carries the referrer. The gap between clicking an
invite link and verifying a gamertag spans a Discord round trip **and** an emote verification that
can happen days later; `state` does not survive that.

### 5.3 Consumption

⚠️ **The claim is recorded at SIGN-IN, not at verification, and this is forced.** Verification is
performed by `apps/verifier` — a background worker folding ADM events, with no HTTP request and
therefore **no cookie to read**. `PgVerifierStore.verifyLink` is the only place a link becomes
`verified`, and it cannot know who referred anyone.

What makes that safe is that **payout is already gated on the referee being verified**:
`grantReferral` inner-joins `gamertag_links` on `status = 'verified'`. So a `referrals` row for a
not-yet-verified referee is inert — it pays nothing until they verify, and pays automatically once
they do. The claim is a record of intent; the sweep decides when it counts.

Flow:

1. `/i/{slug}` (a **Route Handler** — only those and server actions may set cookies) sets `ol_ref`
   and `307`s to `/`.
2. A tiny client island `<ReferralClaim/>`, mounted on `/welcome` and on signed-in `/`, fires one
   fire-and-forget `POST` to a same-origin Route Handler, `app/api/referral/claim/route.ts`.
   Same-origin is what makes the httpOnly cookie arrive at all, and a Route Handler is what can
   clear it afterwards.
3. That handler resolves the slug, writes the claim, and clears the cookie **whatever the outcome**
   — a cookie that survives a failed claim would retry forever.

New `claimReferrer(db, { userId, referrerUserId })` in `packages/tokens`, distinct from the existing
`setReferrer`:

- **The referrer must be verified; the referee need not be.** This is the whole difference from
  `setReferrer`, which requires both and is kept as-is for the existing gamertag endpoint.
- **Self-referral is rejected.**
- **A referral is never overwritten** — insert-on-conflict-do-nothing against the PK, not an upsert.
  A second link click must not reassign an existing referrer, and `claimReferrer` therefore does
  **not** throw `already_set`: a repeat claim is a silent success, because the island may fire more
  than once.
- An unresolvable or unverified referrer slug is a **silent no-op**. The visitor did nothing wrong,
  and nothing about their session may fail because of it.

### 5.4 The share bar

Read-only link field + `Copy link`, then targets: **Discord · X · Reddit · WhatsApp · Email**, each
filling with its brand color on hover, at 44px.

- ⚠️ **Discord has no web share intent.** There is no URL that opens a Discord compose box with
  text in it. The Discord target is an honest copy-to-clipboard whose confirmation says so ("Copied
  — paste it in Discord"). **Do not invent a `discord.com/share` URL.**
- `navigator.share` is offered as an **extra** button, mounted only after a client-side capability
  check — it is absent on desktop Chrome and Firefox, so it can never be the only path.
- The copy confirmation is an `aria-live` region rendered **inside** the target row. As its own row
  it added ~20px and knocked this half's fields out of line with the tokens half opposite.

### 5.5 Payout is a one-time bounty

⚠️ `grantReferral` currently grants the referrer one token per verified referee **every month,
forever** — its idempotency key is `referral:{referrer}:{referee}:{yyyymm}`. Against a 1/month base
grant, ten referees would mint 11 tokens a month and make a ban-lifting currency worthless.

**Change it to one-time**: drop `yyyymm` from the key so each referee pays out once, ever.

⚠️ **This re-grants once to every existing referrer** — the new key `referral:{a}:{b}` matches no
existing row, so the next sweep grants again. With today's referral count that is a rounding error
and is accepted; note it in the changelog rather than writing a backfill.

### 5.6 The join count

Count of `referrals` rows for the signed-in user as referrer whose **referee holds a verified
`gamertag_links` row**. Ownership is a WHERE-clause predicate, never a post-filter, and the boundary
is `verified` — never `pending`.

## 6. Rendering model

This is the bulk of the real work, and the reason this is not a CSS change.

`/players/[slug]` is a server component (metadata, JSON-LD, OG image, sitemap). The verified home is
client-rendered off `useControls` / `useAccountStatus`. The shared stage must therefore become an
**RSC shell with client islands**: the stage, tickets and morgue render on the server from
`getPlayerPage`; the pencil, the send field, the share bar and `Spend 1 token` are the islands.

- **`/players/{me}` `307`s to `/`** — temporary, **never 308**. A permanent redirect would be cached
  by browsers and crawlers against a session-dependent decision, and would follow the user after
  sign-out. `/players/{slug}` stays public, canonical and crawlable.
- The redirect stays cache-safe only because `getPlayerPage` awaits `cookies()` and sets
  `cache: "no-store"`, forcing the route dynamic. Preserve both.
- The existing rename redirect (`shouldRedirectSlug` → **308**) is unrelated and stays permanent.
- ⚠️ A `/me` route takes no subject parameter: the session is the only input.

## 7. Test plan

RTL asserts the DOM, not contrast or layout. Required coverage:

1. **Ticket affordances** — timeline link present in both viewers; **absent** when the server has no
   life; `Spend` present only for owner + banned.
2. **The morgue** — entries render; **the empty state renders its own copy**, distinct from loading
   and from failed; count says "obituaries filed".
3. **Referral capture** — cookie set by `/i/{slug}`; claim written for a **not-yet-verified**
   referee; self-referral rejected; existing referrer **not** overwritten by a second claim; unknown
   slug is a silent no-op; the cookie is cleared even when the claim fails.
4. **`grantReferral` pays once**, proven by running the sweep for two different months and asserting
   one grant.
5. **The redirect** — `/players/{me}` 307s to `/` for the owner and does **not** redirect for anyone
   else.
6. **Independent degradation** — the standing feed failing must not blank the morgue, and vice
   versa. One shared try/catch around two feeds passes the tests and silently guts half the page.

⚠️ Any new env var a suite reads must be added to `turbo.json`'s `test` task `env` list, or the
suite gains the ability to report a cached PASS it did not earn.

Layout claims (the `lg` split, the 390px share row, the 320px floor) cannot be proven by RTL. Verify
with CDP `Emulation.setDeviceMetricsOverride` — `resize_window` and `--window-size` both lie on
macOS Chrome; `innerWidth` stayed 1504 through every attempt during this design.

## 8. Deploy

No projection-table change, so **no `--rebuild`**. The `referrals` table already exists; if any
migration is added, it must not name a newly-created table in `REBUILD_TRUNCATE_TABLES`.
