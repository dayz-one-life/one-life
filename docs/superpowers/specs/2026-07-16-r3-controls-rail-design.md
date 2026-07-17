# R3 — Controls rail design (2026-07-16)

Third slice of the tabloid redesign (roadmap:
`docs/superpowers/specs/2026-07-16-tabloid-redesign-design.md`). Replaces the whole
account surface — `/account`, `/account/claim`, the status banner, and the masthead
slot — with the design canvas's controls rail (desktop, round 10a) and floating
pill + bottom sheet (mobile, rounds 10b–c), with the in-rail link/verify states from
round 10d. Also ships the R3 cleanup the roadmap assigned here: legacy-token shim
deletion, the `tint`→`bone` rename, the serverId fix redo, the login restyle, and the
R1/R2 carried-forward consolidation pass.

Decisions made during brainstorming:

- **Approach A — root-layout grid slot.** The root layout owns the two-column wrap;
  pages are untouched children of the main column. No per-page opt-in.
- **Rail on all pages** at desktop width; pill/sheet on all pages below it.
- **Signed-out:** desktop rail shows a dark sign-in CTA panel; mobile shows **no pill**.
- **Old URLs deleted → 404.** No redirects for `/account` or `/account/claim`.
- **Transfer + referrer become gamertag-based** (small API-route change, no ledger change).
- **Referrer UI survives** as a quiet one-line input in the tokens panel.
- **Login gets a full tabloid restyle** (interpolated from 15a's CTA style — no canvas round).
- **Copy states real mechanics**, correcting the canvas where it drifted: verification
  earns **1** token (canvas said 2), challenge is 3 emotes / 24h expiry, monthly grant
  +1, five-minute grace.

## 1. Layout shell

Root layout (`apps/web/src/app/layout.tsx`) changes from
`Masthead → StatusBannerContainer → content → Footer` to:

```
Masthead                      ← MastheadSlot removed; wordmark + nav only
<div id="content" class="mx-auto w-full max-w-[1440px] flex-1 xl:grid
     xl:grid-cols-[minmax(0,1fr)_380px] xl:px-10">
  <div class="min-w-0 xl:border-r xl:border-ink xl:pr-8 pb-24 xl:pb-0">{children}</div>
  <ControlsRail />            ← hidden xl:block; sticky top-0 self-start pl-7
</div>
<ControlsPill /> + <ControlsSheet />   ← xl:hidden
Footer
```

- Below `xl` (1280px) pages render exactly as today, minus the status banner.
- The main column keeps the canvas's 1px ink divider against the rail at `xl+`.
- `pb-24 xl:pb-0` reserves space under content so the floating pill never covers it.
  (Accepted simplification: the padding is static, present even when no pill renders —
  signed-out mobile pages carry harmless extra bottom padding.)
- Pages do not change their own containers; `max-w-*` blocks center within the main
  column.

**Deleted with the old surfaces:** `status-banner.tsx`, `status-banner-container.tsx`,
`masthead-slot.tsx`, `app/account/**` (both pages + layout), `links-list.tsx`,
`token-wallet.tsx`, `claim-form.tsx`, `claim-status.tsx`, `emote-sequence.tsx`, and all
their tests. `/account` and `/account/claim` 404 via the existing not-found page.

`/welcome` resolver: verified → `/players/{slug}` (unchanged); pending and unlinked →
`/` (the rail/pill carries the next action).

## 2. State machine and data

`accountStatus` (existing union `loading | signedOut | unlinked | pending | verified`
from `@/lib/account-status`, read via `useAccountStatus()`) stays the single source of
truth for all three surfaces:

| status | Desktop rail | Mobile pill |
|---|---|---|
| `loading` | skeleton bars (`aria-busy`) | nothing |
| `signedOut` | sign-in CTA panel | nothing |
| `unlinked` | identity row + link-tag panel (10d) | pill, sub-line `LINK YOUR GAMERTAG →` |
| `pending` | identity row + prove-it panel (10d) | pill, sub-line `VERIFY: {n}/3 DONE` |
| `verified` | identity + tokens + servers + footer | full pill |

One client hook `useControls()` (`apps/web/src/lib/use-controls.ts`) wraps:

- `useAccountStatus()` — session + gamertag links (the existing 5s pending poll in
  `useGamertagLinks` keeps emote progress live; no polling when nothing is pending).
- `GET /me` — provider list for the `VIA {PROVIDER}` line (first account's providerId).
- `GET /me/tokens` — balance. Enabled while signed in.
- `GET /servers` — active server list (public; cached, no auth gating).
- `GET /players/{gamertag}` — per-server standing + ban countdowns, enabled only when
  verified (same payload the dossier uses; `standing: ServerStanding[]`).

Server cards merge `GET /servers` × `standing` by slug: an active server with no
standing entry renders as **No life** — never-played servers are an invitation, not an
omission.

Presentational components take props and are unit-tested; hook wrappers stay thin and
untested, per repo convention. All components live in
`apps/web/src/components/controls/`.

## 3. Desktop rail modules (canvas 10a + 10d)

**Identity row.** 40px round disc in Discord blurple (`--discord`) with the gamertag's
(or handle's) first letter in Oswald — there are no avatar images; the lettered disc is
the design. Beside it: gamertag Oswald 19px uppercase ink over `VIA {PROVIDER}` mono
11px `ink-muted`. Far right: the R2 rubber-stamp **Verified** mark (`-rotate-6`, 2px red
border) — verified only. Unlinked: `@{name} · VIA {PROVIDER} · NO GAMERTAG`. Pending:
the pending gamertag, no stamp.

**Tokens panel** — dark (`bg-dark`) block:

- Header: `UNBAN TOKENS` Oswald 15px paper + balance Oswald 26px paper, right-aligned.
- Send row under a `dark-line` rule: mono input placeholder `SEND TO VERIFIED PLAYER…`
  (dark input: `bg-[#111] border` in `dark-line`, paper text) + skewed paper **Send**
  button (`skewX(-5deg)`, ink text). Disabled while balance < 1 or input empty.
- Errors as a `red-soft` mono line mapped from API codes: `not_verified` → `NOT A
  VERIFIED PLAYER`, `insufficient_tokens` → `NOT ENOUGH TOKENS`, `self_transfer` →
  `THAT'S YOU`. Success refetches the balance and clears the input.
- Footnote mono 10px `cream-muted`: `+1 EVERY 1ST OF THE MONTH · TRANSFERS ARE FINAL`.
- Referrer line: quiet mono input `REFERRED BY…` + small set action; hidden after a
  successful set for the session; `409 already_set` → `ALREADY SET`. Same gamertag
  resolution as transfer.

**Your servers.** `YOUR SERVERS` Oswald 13px uppercase header over a 3px ink rule, then
one card per active server (white bg, `hairline` border, 13/15px padding):

- **Alive** — server name Oswald 16px uppercase + solid blue `Alive` chip; mono
  sub-line `QUALIFIED · {6H 22M} THIS LIFE · {N} KILLS` ({N} kills always shown here,
  including 0 — this is your own dashboard, not a public board).
- **No life** — dashed `dash` border chip `No life`, `ink-muted` text; sub-line
  `SPAWN IN ANY TIME. FIRST 5 MINUTES ARE FREE.`
- **Banned** — `border-l-4` red; solid red `Banned` chip; mono sub-line
  `DIED {HH:MM}` (UTC-local time from `ban.bannedAt`) `· OBITUARY →` linking to the
  player's own dossier (`/players/{slug}` — where the funeral card actually lives; no
  fake obituaries page). Then the `BAN LIFTS IN` box (paper bg, `hairline-2` border,
  mono label + Oswald 18px countdown from `ban.expiresAt`) and the red skewed
  **Spend 1 token — skip the wait** CTA.

The spend CTA reuses `SelfUnbanButton`'s mutation + state logic (ready / no-tokens
`YOU HAVE 0 TOKENS.` in `red-deep` / pending `lift_pending` mono notice). The rail is
by construction the verified owner, so the dossier's owner guard is satisfied. The
shared logic moves to `apps/web/src/components/controls/` and the dossier imports it
from there (or a shared hook — implementation's choice; one source of truth, no copy).

**Rail footer.** Mono 11px row over a `hairline` top rule: `YOUR PROFILE →` (ink,
bold, to `/players/{slug}`) · `SIGN OUT` (`ink-muted`; existing `signOut()` then
redirect `/`).

**Unlinked — link-tag panel (10d).** Dark block: Oswald 26px paper headline
`Link your gamertag.`, mono strapline `THE XBOX GAMERTAG YOU PLAY UNDER. ONE PER
ACCOUNT.`, autocomplete input over the existing `GET /players/search`
(`searchClaimableGamertags`; debounced hook survives the claim page's deletion —
moves/stays in `@/lib`), dark suggestion list (selected row `bg-[#1A1A12]` paper,
rest `cream-dim`). Submitting claims the tag (`POST /me/gamertag-links`); errors via
the existing `claimErrorMessage` mapping, shown as a `red-soft` mono line. Footnote
mono 10px: `WE SUGGEST TAGS SEEN ON OUR SERVERS. VERIFYING EARNS 1 TOKEN.`

**Pending — prove-it panel (10d).** Dark block with 2px `yellow` border:

- Kicker row: `PROVE IT'S YOU` Oswald 12px yellow tracking-wide + right-aligned mono
  `EXPIRES IN {22H 10M}` yellow (existing `formatExpiry`).
- `{GAMERTAG} — perform, in order:` Oswald 24px paper.
- Three equal-width emote boxes, mono 12px: done = paper bg, ink text, `{n} {EMOTE} ✓`;
  current = `bg-[#1A1A12]`, dashed `#6A6852` border, yellow text, trailing `←`;
  upcoming = dashed `dark-line` border, `cream-muted`.
- Footnote mono 10px `cream-muted`: `ON ANY ONE LIFE SERVER. OTHER EMOTES BETWEEN ARE
  FINE — ORDER IS WHAT COUNTS. ONLY WHOEVER CONTROLS THE TAG CAN FINISH THIS.`
- Quiet mono `CANCEL CLAIM` underneath (existing cancel mutation).
- Expired variant (same yellow-border block): `Your verification for {GAMERTAG}
  expired` + skewed `Start a new challenge →` CTA + quiet cancel.

**Signed-out — CTA panel.** Dark block: Oswald `Get in the paper.` headline, mono
strapline `SIGN IN, CLAIM YOUR GAMERTAG, AND YOUR DEATHS MAKE THE PAPER.`, skewed
sign-in button → `/login`.

## 4. Mobile pill + bottom sheet (canvas 10b–c)

**Pill** (`xl:hidden`; renders only when signed in): fixed bar `inset-x-3.5 bottom-3.5
z-40`, dark bg, 2px red border, heavy shadow, 11/16px padding. Left→right: 30px avatar
disc · stacked `PLAYER CONTROLS` Oswald 14px paper over a one-line truncated mono
status · per-server dots (9px: solid blue alive / dashed `cream-muted` outline no-life
/ solid red banned; verified only) · `{n} TOK` Oswald 15px paper behind a `dark-line`
left divider (verified only). The whole pill is one `<button aria-expanded
aria-controls>` opening the sheet.

**Status line priority** — pure helper `pillStatus(status, standing[], now)` in
`apps/web/src/components/controls/format.ts`, unit-tested:

1. any banned server → `{MAP} BAN LIFTS IN {13H 58M}` (`red-soft`)
2. pending → `VERIFY: {n}/3 DONE` (`yellow`)
3. unlinked → `LINK YOUR GAMERTAG →` (`cream-dim`)
4. any alive server → `{MAP} · {6H 22M} THIS LIFE` (`cream-dim`; longest-lived if several)
5. else → `NO ACTIVE LIFE` (`cream-muted`)

Map names via the existing `mapLabel` helper, uppercased.

**Sheet:** overlay `bg-dark/55` + panel sliding from the bottom: dark bg, 3px red top
border, centered drag-handle bar (44×4 `#4A4838`), shadow. Header row: 34px avatar
disc + gamertag Oswald 16px + `VIA {PROVIDER} · VERIFIED` mono 10px (`VERIFIED` in
`red-soft` when verified) + × close button (44px hit area). Body (14/18px padding,
11px gaps) reuses the rail modules in dark-compact variants:

- tokens panel: `dark-line` border box, header + send row (no footnote/referrer — the
  sheet is the compact surface; referrer setting is rail/desktop-only).
- compact server rows: name Oswald 14px + mono fact + chip right-aligned
  (`QUALIFIED · 6H 22M` / `FIRST 5 MIN FREE` / banned block with `DIED {HH:MM} ·
  OBIT →`, dark countdown box, spend CTA).
- footer: `YOUR PROFILE →` (`cream-dim`) · `SIGN OUT` (`cream-muted`).
- unlinked/pending: the same 10d dark panels the rail uses, dropped in unchanged.

**Sheet behavior** — `role="dialog" aria-modal="true"`, focus moves to the sheet on
open and returns to the pill on close, Escape and overlay-click close, body scroll
locked while open. Implemented as a shared `useModalBehavior` hook
(`apps/web/src/lib/use-modal-behavior.ts`) and **retrofitted onto the R1 mobile nav
menu** (closing that R1 carried-forward: scroll lock, focus trap, Escape — the
hamburger already has `aria-expanded`).

## 5. Backend changes (API routes only)

- `POST /me/tokens/transfer` body: `{ toUserId }` → **`{ toGamertag: string }`**. The
  route resolves the gamertag against verified `gamertag_links` rows
  (`status = 'verified'`, `lower(gamertag) = lower(input)`, limit 1 — Xbox gamertags
  are case-insensitively unique) to a userId, then calls
  the unchanged `transfer()`. No verified link → `400 { error: "not_verified" }` (same
  code the ledger uses, now also covering "no such player").
- `POST /me/referrer` body: `{ referrerUserId }` → **`{ referrerGamertag: string }`**,
  same resolution, unchanged `setReferrer()`. Errors unchanged (`self_referral`,
  `already_set`).
- No other API consumers exist (web is the only client); the old fields are dropped,
  not aliased. `packages/tokens` and the DB are untouched. Route tests updated.

## 6. Login restyle + token endgame + fix redos

**Login (`/login`).** Rebuilt on new tokens in the tabloid language (no canvas round;
interpolated from 15a's CTA banner): centered dark panel on paper, red kicker
`THE FRONT DESK`, Oswald headline `Get in the paper.`, mono explainer line, provider
buttons as skewed blocks (Discord in `--discord` blurple with white text; other
providers paper-on-dark outline), magic-link email input in the dark-input style with
a skewed send button and the existing sent/error states. Same backend-driven provider
list (`GET /api/auth/providers`); `login-form.tsx`/`login-panel.tsx` restyled, logic
unchanged.

**Legacy token deletion.** Remove the aliases `--bg --panel --panel-2 --line --bone
--dim --muted --wash --amber --blood --steel` from `globals.css` and their
`tailwind.config.ts` entries. Sweep the surviving consumers to new tokens:
`app/error.tsx`, `app/not-found.tsx`, `components/ui/button.tsx`, `ui/input.tsx`,
`ui/table.tsx`, `login-form.tsx` (restyle covers it). Every other consumer is deleted
by this slice. A repo-wide grep for the legacy class names must come back empty
(excluding the spec/plan docs).

**`tint` → `bone` rename.** With the legacy `--bone` alias gone, rename `--tint` to
`--bone` (the surface *is* brand "Bone") in `globals.css` + `tailwind.config.ts`, and
sweep `bg-tint`/`text-tint`/`border-tint` → `-bone` across the ~6 consumer files +
tests. Grep for `tint` must come back empty afterward.

**serverId fix redo** (from orphaned `835bf3e`): `GamertagLink` in `@/lib/types.ts`
drops the stale `serverId` field. The rest of that old commit touched files this slice
deletes.

## 7. R1/R2 carried-forward consolidation (one cleanup pass)

From the R2 final review + R1 rollup, all Minor:

- Dedupe the pagination box classes (`box`/`boxLink`/`boxOff`) shared by
  `survivors/pagination.tsx` and `player/player-pagination.tsx` into one
  `PaginationBar` (or shared class module) — one source of truth.
- Merge `Portrait` (survivor-row) and `PlayerAvatar` image hygiene into one shared
  decorative-image component.
- Extract the duplicated `Stat` subcomponent pattern (hero band / OG card).
- Skeleton fidelity: `BoardSkeleton` gets a podium tier; `DossierSkeleton` splits
  merged sections.
- Drop the redundant double `aria-hidden` on silhouette fallbacks.
- Disabled pagination edges fully hidden from the a11y tree (single `aria-hidden`
  span, no stray focusable content).
- `SkewCta` gets an `href | onClick` discriminated prop union.
- `countWord` singular form ("1 kill", "1 funeral").
- `activeNavKey` exact-segment matching (`/newsroom` must not light News).
- Verified-chip (masthead is gone — the rail identity row's stamp) checked at 390px.
- Test hygiene from the R2 list: stale self-unban test name, pvp-unknown-killer branch,
  pin the `Killed by` prefix, replace the `previousElementSibling` hero assertion,
  drop the `as never` in the `aliveMaps` fixture.

(The mobile-menu a11y carried-forward lands in §4 via `useModalBehavior`, not here.)

## 8. Testing & verification

- Unit tests (explicit vitest imports, Testing Library, props-only): `pillStatus`,
  rail state switching, server-card variants (alive/no-life/banned incl. countdown +
  spend states), tokens panel (send disabled/error/success mapping, referrer hide),
  link-tag panel (suggestions render, claim error), prove-it panel (box states,
  expired variant), pill rendering rules (signed-out hidden, dots/tok gating), sheet
  behavior (open/close/Escape/focus/scroll-lock via `useModalBehavior` tests), login
  states, `PaginationBar`, `activeNavKey`, `countWord`.
- API route tests for the two body changes (happy path + unresolvable gamertag).
- Full `pnpm turbo run test --concurrency=1` (with `TEST_DATABASE_URL`) + typecheck.
- Grep gates: legacy token classes zero, `tint` zero, `font-hand` zero.
- Chrome visual sweep at 1440 / 1280 / 390: all rail states, sheet open/closed,
  pill priority lines, login, boards + dossier inside the new main column, skip link +
  focus ring intact. Banned-state visuals unit-verified if the visual DB still has no
  banned player.

## Out of scope

News/obituaries/fresh-spawns content (R5+), life timeline (R4), the round-16
"players online" modules, any projection/read-model/schema change, avatar images,
gamertag change/release flows.
