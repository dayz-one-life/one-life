# Player notifications (apps/notifier, push, the inbox)

Split out of `CLAUDE.md` (2026-07-29), verbatim.

- **Player notifications**: a new `apps/notifier` worker + web surface that tells a signed-in player
  about things that happened to their own account — a **seven-kind catalogue**: gamertag verified,
  tokens received/granted, ban applied/lifted, life qualified and survival milestone. (Two further
  kinds, `obituary_published`/`birth_notice_published`, shipped here and went with the content
  engine.) Every kind
  is generated **per user, scoped to their own gamertag/verified links** — the feature never
  surfaces another player's activity, matching the same verified-link boundary the account rail
  already enforces for self-unban and tokens. Rows land in a new durable `notifications` table (fed
  by six generator functions across `apps/notifier/src/generators/` —
  the two ban kinds and the two life kinds each pair up in one file — deduped by a unique
  `natural_key` per notification instance) and are delivered two ways: an in-app feed — a masthead
  **`MastheadBell`** (all widths, signed-in only, an anchored popover at `md+`, a link to
  `/notifications` below `md`; badge caps at `9+` with the real count in `aria-label`) and a
  permanent **`/notifications`** inbox page ("The Wire", also carrying the `PushToggle` on its
  single light surface, no `onDark`), both reading a **frozen-tint** model — `useNotifications` /
  `useNotificationSeen` (`@/lib/use-notifications`): mark-read stamps the query cache via
  `setQueryData` (never invalidates, so a read row doesn't flatten mid-glance) and a 60s
  `refetchInterval` reconciles in the background (`GET /me/notifications` +
  `POST /me/notifications/read`) — and opt-in browser Web Push (`push_subscriptions` table,
  VAPID-signed via `web-push`, a service worker + PWA manifest, `POST`/`DELETE
  /me/push-subscriptions`, public `GET /push/vapid-key`). The worker
  runs two independently-gated passes per tick: **generate** (forward-only `NOTIFIER_SINCE` cutoff —
  unset means OFF, never a silent epoch default that would flood every player with their whole
  history — plus `NOTIFIER_DRY_RUN`, defaults `true`) and **push** (its own `NOTIFIER_PUSH_ENABLED`
  kill switch, so delivery can be staged on after generation is already live; a subscription retires
  itself after repeated failures). **`life_qualified` windows on the qualification instant DERIVED at
  read time** — `apps/notifier/src/generators/lives.ts` loads every open life owned by a verified
  user on a slugged server (with its sessions + kills) and calls `lifeQualifiedAt()`
  (`@onelife/read-models`), not `startedAt`, which would miss a life that qualifies long after it
  started. **Qualification is deliberately never materialized** (the `isLifeQualified` precedent) —
  one source of truth, shared with the survivors board and the enforcer. There is
  **no SQL qualification prefilter**: `lives.playtime_seconds` only advances at session close, so
  `qualifiedLifeCondition` is stale mid-session and would blind the generator to exactly the case it
  exists for. The candidate set (currently-alive verified players) is small. Migration `0015` adds
  only the two new tables, so **this release deploys normally, without `--rebuild`**. Single-instance, at-least-once delivery (the push pass reads
  unpushed rows without a row lock). Runbook +
  env vars: `deploy/README.md` and the `NOTIFIER_*` block in `.env.example`.
  **Invariants a future change would break by accident (each one shipped as a review fix — don't
  "tidy" them back):**
  1. **The ban generators window on `bans.created_at` and `bans.lifted_at`, never `banned_at` or
     `expires_at`.** `banned_at` is the *death* time, so if ingest/projector lag exceeds
     `NOTIFIER_LOOKBACK_HOURS` the ban row lands already outside the window and the player is never
     told. `expires_at` is merely `banned_at + BAN_DURATION_HOURS`, which both announces old bans at
     go-live and drops one the enforcer expires late. `lifted_at` is stamped by
     `markExpired`/`markLifted`/`redeem`, including under `ENFORCER_DRY_RUN`.
  2. **`ban_applied` has no status or `applied_at` filter.** Under `ENFORCER_DRY_RUN` — the
     production default — `markApplied()` is never called, so rows sit at `pending` with a NULL
     `applied_at`; either filter would be always-false in the configuration we actually run.
  3. **Every generator floors its query at `windowStart(deps)`** (`max(since, now - lookback)`,
     `apps/notifier/src/types.ts`). Survival milestones shipped without it and would have fired all
     crossed thresholds at go-live and re-derived them every tick forever.
  4. **`NOTIFIER_DRY_RUN` / `NOTIFIER_PUSH_ENABLED` are `z.string().optional()` + `!== "false"`, not
     a `z.enum`.** `.default()` fires only on `undefined`, so a blank/mis-cased value threw out of
     `loadConfig` at module scope and crash-looped the unit. Unparseable input must land on the safe
     side.
  5. **The sender is built through the guarded `buildSender()`, never at module top level.**
     `webpush.setVapidDetails()` throws *synchronously* on a bad key or a subject missing `mailto:`;
     built eagerly, one typo killed the process before the loop and took generation down with it.
     Invalid VAPID ⇒ `null` ⇒ push off, generation continues.
  6. **`POST /me/notifications/read` marks only the ids the client rendered.** A blanket
     mark-all-unread against a feed that serves one page silently destroys any deeper backlog. The
     feed is paginated (`?page=`) and the ownership predicate stays in the WHERE clause. This still
     holds after the move to the masthead bell + `/notifications` inbox: the popover reports only
     its page-1 rows, and the inbox page reports each page as it loads — never a mark-all.
  7. **Sign-out deletes the push subscription row *before* `signOut()`**
     (`signOutAndTeardownPush`, `apps/web/src/lib/push.ts`, shared by the rail and the mobile
     sheet). After sign-out the DELETE is scoped to a dead session and matches zero rows, leaving a
     shared browser delivering the previous user's notifications. It never throws — a failed
     teardown must not trap anyone in a session.
