# Live-data honesty — design

**Date:** 2026-07-21
**Status:** Approved
**Scope:** `apps/web` + `packages/read-models` + `packages/tokens` (the honesty of a value is fixed
where it is derived, not only where it renders). Sub-project 3 of 4 from the 2026-07-20 full-site
UX review. **Unlike SP1/SP2 this pass deliberately changes displayed values — the change is the
point.**

## 1. Problem

An empirical audit of every live/derived/polled surface (2026-07-21) confirmed 15 defects (1
refuted) where the UI presents state as current/confirmed/live when the truth is stale, phantom,
or fabricated. They cluster into five real problems plus small wording/cache fixes:

1. **Phantom dry-run bans (the flagship).** Under `ENFORCER_DRY_RUN` a ban row exists as
   `status='pending'` with `dry_run=true` but was **never placed on the game server** — the player
   is not actually banned. The web renders it as a real "Banned" standing with a live countdown and
   a "Spend 1 token — skip the wait" CTA, and `redeem()` will burn a real token to "lift" a ban that
   never existed. This is the known-open notifier-dry-run-phantom-bans issue.
2. **Time-alive keeps climbing while a player is offline.** The life-timeline "Time alive" and the
   "Still drawing breath — Xh Ym **and counting**" row accrue an open session to request-time `now`
   with **no cap at `lastSeenAt`**, while the survivor board and the dossier standing card both cap
   at `lastSeen`. A crashed/ghosted player shows "9h and counting" on one page and "5h" on two
   others.
3. **Ban countdowns floor at "0h 0m / Banned" forever.** `banCountdown` clamps a past-expiry ban to
   the truthy string "0h 0m" instead of a terminal signal, so an expired ban renders "Ban lifts in
   0h 0m" next to a hard "Banned" chip indefinitely.
4. **Loading/error states fabricate certainty.** Three surfaces turn "we don't know yet / the fetch
   failed" into an authoritative fact: the self-unban button shows **0 tokens** while the balance
   query is loading/errored; the controls standing defaults to **idle** while the player query is
   unresolved; and the home page swallows a feed-fetch failure (`.catch(() => null) ?? []`) and
   renders the "nothing published yet" empty state as if the desk is simply quiet.
5. **Birth-notice alive/dead status is frozen at publish.** The Fresh Spawns interior derives its
   "still drawing breath" line from a `death_at` captured when the article was written, never
   recomputed — so a subject who has since died still reads as alive (the News vertical already
   recomputes this at request time via `getNewsSubjectStatus`).

Plus: the OG card labels first-ever-seen as "Surviving since {MON YYYY}" (implies continuous
survival); and `saveArticleImage`'s regenerate path replaces the bytes without bumping
`article_images.created_at`, so the `?v=<created_at>` cache-buster doesn't change and a regenerated
hero serves stale (dormant today — images retired — but a real correctness bug).

## 2. Phantom-ban policy (display + spend guard)

**Policy: a ban is only real if it was actually placed — `dry_run = false`.** Only real bans render
as "Banned" and only real bans can be lifted with a token.

- **Read-model (`packages/read-models/src/player-page.ts`):** the `activeBans` query (line 53) adds
  `eq(bans.dryRun, false)`. A dry-run ban is invisible to the standing derivation — the card falls
  through to `alive`/`idle` as if no ban row existed. `ACTIVE_BAN_STATUSES` is unchanged (a real
  `pending` ban — queued under live enforcement, about to hit Nitrado — is legitimately "banned").
- **Spend guard (`packages/tokens/src/redeem.ts`):** the candidate query (line ~19) adds
  `eq(bans.dryRun, false)`, so `redeem()` refuses to spend a token on a phantom ban
  (`no_active_ban`/`not_owner` as appropriate). Defense in depth for a stale client that still shows
  the CTA.
- **Not in scope (backlog, noted):** the enforcer's expire arm only touches `status='applied'`, so a
  dry-run `pending` ban never expires — but with the display + spend filters it is now invisible and
  unspendable, so the display honesty is complete. Fixing the enforcer's expiry and migrating any
  already-spent phantom redemptions are separate backend follow-ups.

## 3. Time-alive cap

**Policy: a duration that implies presence must stop at the last moment we actually saw the player.**

- `getLifeTimeline` (`packages/read-models/src/life-timeline.ts`) already fetches `players.lastSeenAt`
  (line ~35) for `lifeQualifiedAt` but drops it. Add `lastSeenAt` to `LifeTimelineData`
  (`apps/web/src/lib/types.ts`) and cap the open-session accrual in `liveTimeAlive` (line ~39) at
  `lastSeenAt ?? connectedAt ?? now` — matching `livePlaytime` in `survivors.ts` and the dossier's
  cap in `player-page`/`queries.ts` EXACTLY, with **no clamp to `now`** (a clamp would diverge from
  those two under clock skew, when `lastSeenAt` lands a few seconds ahead of `now`). `LifeHero`
  (`life/hero.tsx`) and the timeline NOW row inherit the capped value.
- The "and counting" phrasing on the NOW row is a **server-baked snapshot that never ticks** — soften
  it (e.g. "Still drawing breath — Xh Ym" without "and counting", or "as of last seen"), so the page
  doesn't claim a live counter it doesn't have.

## 4. Ban countdown terminal state

`banCountdown` (`apps/web/src/components/player/format.ts`) returns **null** when `expiresAt - now <=
0` instead of clamping to "0h 0m". Every render site — `standing-card.tsx`, `controls/server-cards.tsx`,
`controls/sheet.tsx` — flips honestly on null: show a terminal "Lifting…" / "Ban lifted" (or drop the
countdown line) rather than "Ban lifts in 0h 0m" beside a "Banned" chip. (With §2's filter the dry-run
"permanent 0h 0m" case disappears entirely; this handles the real-ban lag window between expiry and the
enforcer's expire tick.)

## 5. Loading/error ≠ empty/zero

**Policy: never render an unresolved or failed fetch as an authoritative zero/empty.**

- `self-unban-button.tsx` — don't render "0 tokens" (or a misleading CTA state) while
  `tokens.isLoading`/`isError`; gate on resolved data (a loading affordance, or hide the balance line
  until known). The `?? 0` fallback stays only for a genuinely-resolved zero balance.
- `controls/use-controls.ts` — distinguish "player query unresolved" from "idle standing." A card
  should not assert "idle" from `player.data?.standing ?? []` while loading/errored; surface the
  loading/unknown state (the rail already has skeleton affordances — route through them).
- `app/page.tsx` — a feed-fetch failure must not render the "nothing published yet" empty state as if
  authoritative. On error, render an honest fallback (the manifesto/empty-newsroom path is acceptable
  as a NEUTRAL default, but an actual fetch error should not be indistinguishable from "the desk hasn't
  published" — at minimum log/annotate; prefer surfacing a soft error state). Keep the byte-identical
  empty-newsroom fallback for the genuine no-news case.

## 6. Birth-notice status recompute

The Fresh Spawns interior (`apps/web/src/components/birth-notices/birth-notice-article.tsx`, fed by
`getBirthNoticeBySlug`) recomputes the subject's current alive/dead at request time, mirroring the News
vertical's `getNewsSubjectStatus` (`getBirthNoticeSubjectStatus`, or reuse the shared predicate). A
subject who has died since publication reads as dead, not "still drawing breath." The prose is never
regenerated (frozen) — only the status line is live.

## 7. Small honesty fixes

- OG card (`app/players/[slug]/opengraph-image.tsx`): "Surviving since {MON YYYY}" → a phrase that
  doesn't assert continuous survival from first-seen (e.g. "First seen {MON YYYY}"), matching what
  `firstSeenAt` actually means.
- `apps/newsdesk/src/image-pg-store.ts` `saveArticleImage`: on the regenerate `onConflictDoUpdate`,
  bump `created_at` (or a version column) so `?v=<created_at>` changes and the CDN/browser drop the
  stale hero. Dormant (images retired) but correct.

## 8. Error handling

The new states fail toward honesty: unknown/loading over a fabricated zero; a null countdown over a
lying timer; a capped duration over an inflated one. No new user-facing error surfaces beyond making
existing failures visible instead of silent.

## 9. Testing

- **The change IS the assertion.** Pin the new honest behavior: `redeem()` throws on a dry-run ban;
  `getPlayerPage` omits a dry-run ban from the standing (card is alive/idle, not banned); `liveTimeAlive`
  caps at `lastSeenAt` (a fixture with `lastSeenAt < now` yields the capped duration, and the NOW row
  drops "and counting"); `banCountdown` returns null at/after expiry and each render site shows the
  terminal state; the loading/error surfaces render a non-zero/non-idle affordance when the query is
  unresolved (RTL with a loading/error query state); the birth-notice status recomputes for a
  since-died subject.
- Cross-package: read-models + tokens suites need `TEST_DATABASE_URL` (see dev-env notes). Web suite +
  typecheck green.

## 10. Non-goals

- No enforcer expiry rewrite; no migration of already-spent phantom redemptions (backlog).
- No conversion of server-rendered dossier countdowns into live client tickers (the terminal-state fix
  covers the misleading case; coarse "Xh Ym" staleness within the request is acceptable).
- No change to the legitimate derived definition of "alive" (open qualified life) — only to
  presentation that implies live presence.
- Sub-project 4 (pill re-homing) is a separate spec.
