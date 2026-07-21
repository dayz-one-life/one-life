# Live-data Honesty Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 15 confirmed live-data-honesty defects from the 2026-07-21 audit — phantom dry-run bans, uncapped time-alive, dead ban countdowns, loading/error fabricating zeros, and a frozen birth-notice status — so no surface presents stale/phantom/fabricated state as live/confirmed.

**Architecture:** Fixes land where the value is derived (read-models, tokens) and where it renders (web). Each task pins the NEW honest behavior — this pass changes displayed values on purpose.

**Tech Stack:** Next.js App Router + React + Tailwind; Drizzle/Postgres read-models + tokens; RTL + vitest (DB suites need `TEST_DATABASE_URL`).

**Spec:** `docs/superpowers/specs/2026-07-21-live-data-honesty-design.md`
**Audit findings:** `.superpowers/sdd/sp3-findings.md`

## Global Constraints

- Fixes may touch `apps/web`, `packages/read-models`, `packages/tokens`, `apps/newsdesk` — scope each task to its listed files.
- This pass CHANGES displayed values by design; tests assert the new honest behavior, not byte-identical output.
- A ban is real only if `dry_run = false`. Real `pending` bans (queued under live enforcement) stay "banned"; only dry-run phantoms are filtered.
- A duration that implies presence accrues up to `lastSeenAt` (falling back to the session's own `connectedAt` when `lastSeenAt` is null) — matching `survivors.ts`'s `livePlaytime` idiom exactly, with NO clamp to `now` (clock skew between the game server and the app can put `lastSeenAt` a few seconds ahead of `now`; clamping to `now` would understate a still-online player's time alive).
- Loading/error must never render as an authoritative zero/empty.
- DB test suites need `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test`; per-package `pnpm --filter X test` avoids the turbo env-strip. Web: `pnpm --filter @onelife/web run test`. Typecheck: `pnpm turbo run typecheck`.
- Branch: `feature/live-data-honesty` (created from `develop`).

---

### Task 1: Phantom dry-run bans — read-model filter + redeem spend guard

**Files:**
- Modify: `packages/read-models/src/player-page.ts` (activeBans query, ~line 53 — add `eq(bans.dryRun, false)`)
- Modify: `packages/tokens/src/redeem.ts` (candidate query, ~line 19 — add `eq(bans.dryRun, false)`)
- Test: extend `packages/read-models` player-page tests + `packages/tokens` redeem tests (DB-backed; follow existing harness)

**Interfaces:** no DTO change required (a dry-run ban simply doesn't produce a banned card). If a later task needs the web to *distinguish* dry-run, add a `dryRun` flag to `BanStanding` — not needed for this task.

- [ ] **Step 1:** Failing tests — (a) `getPlayerPage` with only a `dry_run=true` pending ban on a server yields a NON-banned card (alive if an open qualified life exists, else idle) — currently renders "banned"; (b) `redeem()` with only a dry-run ban throws `no_active_ban` (and does NOT create a `-1` token transaction) — currently burns a token. Add a positive control: a `dry_run=false` pending ban STILL renders banned and STILL redeems.
- [ ] **Step 2:** Run to verify failure (read-models + tokens suites with `TEST_DATABASE_URL`).
- [ ] **Step 3:** Add `eq(bans.dryRun, false)` to both queries. Confirm the real-ban positive controls still pass (do not over-filter — `pending` non-dry-run stays).
- [ ] **Step 4:** Full read-models + tokens suites + typecheck.
- [ ] **Step 5:** Commit: `fix(bans): dry-run bans are not real — never render as banned, never spendable`.

---

### Task 2: Time-alive cap at lastSeenAt

**Files:**
- Modify: `packages/read-models/src/life-timeline.ts` (thread `lastSeenAt`; the `liveTimeAlive` open branch ~line 39 accrues through `lastSeenAt`, no clamp to `now`)
- Modify: `apps/web/src/lib/types.ts` (`LifeTimelineData` gains `lastSeenAt`)
- Modify: `apps/web/src/lib/life-timeline.ts` (the pure `buildTimeline`/`liveTimeAlive` — accrue through `lastSeenAt`, no clamp to `now`; soften the NOW row "and counting")
- Modify: `apps/web/src/components/life/hero.tsx` (inherits capped value; no change if it reads the read-model value — verify)
- Test: `apps/web/src/lib/life-timeline.test.ts` (cap + NOW-row wording); read-models life-timeline test (returns lastSeenAt)

**Interfaces:** `LifeTimelineData.lastSeenAt: string | Date | null`.

- [ ] **Step 1:** Failing tests — a fixture with an OPEN session, `startedAt` 9h ago, `lastSeenAt` 4h ago, `now` = present: `liveTimeAlive` yields ~5h (capped), NOT ~9h; the NOW row text no longer says "and counting". Assert `getLifeTimeline` returns `lastSeenAt`.
- [ ] **Step 2:** Run to verify failure.
- [ ] **Step 3:** Thread `lastSeenAt` through the read-model DTO; accrue the open-session time through `lastSeenAt` (match `survivors.ts` `livePlaytime`'s `lastSeenAt ?? connectedAt ?? now` idiom — no clamp to `now`); soften the NOW-row phrasing per spec §3. Confirm a still-online life (`lastSeenAt` ≈ `now`) is unchanged.
- [ ] **Step 4:** Web suite + read-models suite + typecheck.
- [ ] **Step 5:** Commit: `fix(web): life-timeline time-alive caps at last-seen, matching the board and dossier`.

---

### Task 3: Ban countdown terminal state

**Files:**
- Modify: `apps/web/src/components/player/format.ts` (`banCountdown` returns `null` when remaining <= 0)
- Modify: `apps/web/src/components/player/standing-card.tsx`, `apps/web/src/components/controls/server-cards.tsx`, `apps/web/src/components/controls/sheet.tsx` (each render site handles null → terminal "Lifting…"/"Ban lifted" or drops the countdown line, instead of "0h 0m")
- Test: `apps/web/src/components/player/format.test.ts` (null at/after expiry); standing-card/server-cards/sheet tests (terminal render)

**Interfaces:** `banCountdown(expiresAt, now): string | null`.

- [ ] **Step 1:** Failing tests — `banCountdown` returns `null` when `now >= expiresAt` (currently "0h 0m"); each render site shows the terminal state (not "Ban lifts in 0h 0m") when the countdown is null. Positive control: a future expiry still shows "Xh Ym".
- [ ] **Step 2:** Run to verify failure.
- [ ] **Step 3:** Make `banCountdown` return null past expiry; update the three render sites to branch on null (choose one terminal treatment consistently — "Lifting…" reads best while the enforcer catches up). Keep `formatDuration` for the live case.
- [ ] **Step 4:** Web suite + typecheck; update any pinned countdown test at same strength.
- [ ] **Step 5:** Commit: `fix(web): expired ban countdown flips to a terminal state instead of a dead 0h 0m timer`.

---

### Task 4: Loading/error must not fabricate zero/idle/empty

**Files:**
- Modify: `apps/web/src/components/player/self-unban-button.tsx` (don't show 0 tokens / a misleading CTA while `tokens` is loading/errored)
- Modify: `apps/web/src/components/controls/use-controls.ts` (distinguish unresolved player query from "idle" standing)
- Modify: `apps/web/src/app/page.tsx` (a feed-fetch ERROR is not the same as "no news"; keep the empty-newsroom fallback only for genuine emptiness)
- Test: the corresponding component/hook tests with loading & error query states (RTL; mock the query hooks' `isLoading`/`isError`)

**Interfaces:** none new — gate on existing query `isLoading`/`isError`/`data` presence.

- [ ] **Step 1:** Failing tests — self-unban with `tokens` in loading state does NOT assert "0 tokens" / does not render the no-tokens CTA as if authoritative; use-controls with an unresolved player query does NOT yield "idle" server cards; the home page rendered from a REJECTED feed fetch does NOT show the authoritative empty state (assert it renders a distinguishable fallback, or that the error path is handled distinctly from the empty path). Read each file first to choose the honest affordance.
- [ ] **Step 2:** Run to verify failure.
- [ ] **Step 3:** Implement per spec §5. Keep resolved-zero/genuine-empty behavior intact (a real 0 balance still shows 0; a real no-news still shows the empty newsroom). Only the unresolved/failed case changes.
- [ ] **Step 4:** Web suite + typecheck.
- [ ] **Step 5:** Commit: `fix(web): loading/failed fetches no longer render as an authoritative 0 tokens / idle / empty desk`.

---

### Task 5: Birth-notice live status + small honesty fixes

**Files:**
- Modify: `packages/read-models/src/birth-notice-articles.ts` (recompute subject alive/dead at request — mirror `getNewsSubjectStatus`; or a shared predicate) + `apps/web/src/components/birth-notices/birth-notice-article.tsx` (render the live status)
- Modify: `apps/web/src/app/players/[slug]/opengraph-image.tsx` ("Surviving since" → "First seen")
- Modify: `apps/newsdesk/src/image-pg-store.ts` (`saveArticleImage` regenerate bumps `created_at` so `?v=` changes)
- Test: birth-notice read-model test (since-died subject → dead status); OG wording is inspection/trivial; image-pg-store test (regenerate changes the version) if a store test exists, else note inspection

**Interfaces:** a `getBirthNoticeSubjectStatus` (or reuse the news predicate) returning current alive/dead for the subject.

- [ ] **Step 1:** Failing test — a birth-notice subject whose life has since ended is reported dead by the recomputed status (currently reads the frozen `death_at` → alive). Look at how `getNewsSubjectStatus`/`getNewsArticleBySlug` does it and mirror.
- [ ] **Step 2:** Run to verify failure.
- [ ] **Step 3:** Recompute the birth-notice status at request time; render it. Fix the OG wording. Bump `created_at` (or add a version) on the image regenerate conflict path. Keep the frozen prose untouched (only the status line is live).
- [ ] **Step 4:** Read-models + web + newsdesk suites + typecheck.
- [ ] **Step 5:** Commit: `fix(web): birth-notice status recomputes at request; OG says first-seen; image regen busts its cache`.

---

### Task 6: CHANGELOG, CLAUDE.md, full verification

**Files:** `CHANGELOG.md`, `CLAUDE.md`.

- [ ] **Step 1: CHANGELOG** — under `## [Unreleased]` → `### Fixed`:
  ```markdown
  - Live-data honesty (UX review sub-project 3): dry-run bans (never placed on the game server)
    no longer render as a real ban or accept a token spend; the life-timeline "time alive" caps at
    last-seen like the board and dossier (no more "9h and counting" for a player who logged off
    hours ago); an expired ban countdown flips to a terminal state instead of a dead "0h 0m" timer;
    loading and failed fetches no longer render as an authoritative "0 tokens", "idle", or "empty
    desk"; the Fresh Spawns status recomputes at request time so a since-died subject reads as dead;
    the share card says "first seen" rather than "surviving since"; and a regenerated article image
    busts its own cache.
  ```
- [ ] **Step 2: CLAUDE.md** — record the honesty invariants where future changes would break them: the dry-run-ban filter (a ban is real only if `dry_run=false`, enforced in `player-page` activeBans + `redeem` candidates — do not widen back); the time-alive `lastSeenAt` cap (all presence-implying durations cap there); `banCountdown` returns null past expiry (render sites branch on null). Point at the spec. Note the backlog items (enforcer dry-run expiry; server-countdown ticking).
- [ ] **Step 3: Verify** — `pnpm turbo run typecheck`, `pnpm --filter @onelife/web run test`, and the read-models + tokens + newsdesk suites (with `TEST_DATABASE_URL`) → all green.
- [ ] **Step 4: Commit:** `docs: changelog + CLAUDE.md for live-data honesty`.

Then hand off to `finishing-a-feature` for the PR into `develop`.
