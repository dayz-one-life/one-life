# Avatar & account pass — design

**Date:** 2026-07-28
**Status:** Approved

## 1. What this is

Five related account/avatar changes in one branch: the masthead's inner row gets width-contained;
the masthead avatar becomes a dropdown menu; `/you` is deleted; the player dossier gains the
player's avatar with an owner-only update flow; and the survivors board shows avatars on every
row in three size tiers. Presentation + one read-model field — no migration, no new table, no env
var: plain `./deploy/deploy.sh`, **no `--rebuild`**.

## 2. Masthead width containment

On an ultrawide monitor the wordmark hugs the viewport edge while content stops at the `(boxed)`
layout's 1440px box. Fix: the masthead's inner flex row gains
`mx-auto w-full max-w-[1440px] xl:px-10` (keeping `px-4 md:px-6` below xl), so the wordmark and
right cluster align with the content edge at every width. The dark bar itself stays full-bleed.
The LAYER LEGEND and z-altitudes are untouched. Pinned in `header.test.tsx` alongside the
existing altitude assertions.

## 3. Masthead avatar dropdown

`AccountAffordance`'s signed-in disc becomes a **button** (`aria-haspopup="menu"`,
`aria-expanded`, `aria-controls`) opening an anchored dark popover — the `MastheadBell` pattern:
owned open-state, popover `z-50` INSIDE the `z-40` masthead's stacking context (no new altitude),
`useModalBehavior` for Escape/outside-click/focus (⚠️ the panel needs `tabIndex={-1}` or the
focus move is a silent no-op), and it closes on route change.

Menu items by state:
- **verified:** `Your profile →` (`/players/{playerSlug(gamertag)}`) and `Sign out`.
- **unlinked / pending:** `Claim your gamertag →` (`/`) and `Sign out`.
- Sign-out calls `signOutAndTeardownPush` (the push-teardown-before-signOut rule rides along).
- **signedOut:** the existing "Sign in" chip, unchanged. **loading:** nothing, unchanged.

Dark-surface tokens only (two-surface token rule; the popover is dark like the bell's).

## 4. `/you` is deleted

The route directory and `YouPanel` are removed — `/you` 404s (pinned by a test). Its jobs
disperse: sign-out → the dropdown (every signed-in state); profile link → the dropdown; avatar
management → the dossier owner view (§5); identity display → the dossier already is that; the
claim pointer → the ladder on Home already owns onboarding. **Avatar management is verified-only
by design** (agreed): every public avatar surface joins through a verified link, so an unverified
user's upload would show nowhere but their own masthead disc — those users belong in the claim
ladder instead. No nav/tab-bar references to `/you` remain (the obituaries-nav release already
swapped the You tab for the masthead avatar; verify by grep and update `robots`/sitemap only if a
reference exists — none is expected).

## 5. Dossier avatar + owner update

**Read-model:** `getPlayerPage` gains `avatarHash: string | null` — resolved via a `verified`
`gamertagLinks` row on `lower(gamertag)` inner-joined to `avatars` with `image IS NOT NULL`
(the tombstone rule), exactly the board's clause pair. Unverified gamertag or tombstoned avatar
→ `null`. Served through `GET /players/:gamertag` and the web `PlayerPage` type.

**Hero:** the dossier hero renders the portrait as a disc beside the callsign when `avatarHash`
is present; **no image → no disc** (the hero keeps today's avatar-free layout rather than showing
a placeholder). Decorative: `alt=""`. This deliberately reverses the standing "the player dossier
stays avatar-free" note — CLAUDE.md is amended in the same branch.

**Owner update:** when the signed-in session holds a *verified* link whose gamertag matches the
page (case-insensitive — the `SelfUnbanButton` ownership gate, client-side), an
`Update photo` control renders below the hero and toggles the existing `AvatarPanel`
(upload / pull-from-provider / remove — the four `/me/avatar` routes, unchanged: session-only,
no subject parameter). On any change it invalidates `["avatar"]` AND `["player-page"]` so the
hero, the masthead disc and the board agree. Pending/stranger/signed-out visitors never see the
control (gate skips the fetch, not just the render — no flash). The OG share image stays
avatar-free.

## 6. Survivors board avatar tiers

`tierFor` (`@/components/survivors/format`) re-cuts from hero=1 / podium=2–3 / compact=4+ to:

- **Rank 1 — hero:** portrait grows 76px → **96px**; everything else about the hero row stays.
- **Ranks 2–5 — mid:** the podium treatment extends to four rows, portrait **60px** (unchanged
  size, wider membership).
- **Ranks 6+ and ALL rows on pages 2+ — compact:** keep compact text styling but gain a **28px**
  avatar disc.

Every row now renders an avatar slot: rows with `avatarHash` show the image; rows without show
an initial disc (first character of the gamertag) rather than nothing, so the column keeps its
rhythm. Portraits stay decorative (`alt=""`, no img role). `avatarHash` is already fetched
per visible row by `getAliveSurvivors` — no read-model change.

## 7. Testing

- Header: container classes pinned next to the altitude assertions.
- Dropdown: per-state items (verified/unlinked/pending/signedOut/loading), Escape + outside
  click close, focus lands in the panel on open, route-change close; sign-out calls the teardown
  wrapper.
- `/you`: request/render test proving 404 (Next `notFound` or absent route — assert via the app's
  established pattern for removed routes) and a grep-style check that nothing links to `/you`.
- Read-model: `avatarHash` on `getPlayerPage` — verified-only and tombstone-excluded, each
  mutation-proven (dropping the status clause or the `image IS NOT NULL` clause fails a named
  test); route test for the API field.
- Dossier: hero shows the disc with a hash and no disc without; owner sees `Update photo`,
  pending/stranger/signed-out do not.
- Board: tier boundaries at ranks 1, 2, 5, 6 and page 2 (all compact); fallback initial disc on
  a hash-less row.
- Browser checklist (pre-release): masthead alignment on an ultrawide; dropdown at phone + desktop
  widths; tier sizes at real widths; dossier update round trip (upload → hero + masthead + board
  all show it) — the round trip the login-avatars feature left outstanding.
