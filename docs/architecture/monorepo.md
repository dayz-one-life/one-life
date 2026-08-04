# Monorepo inventory: packages and apps

Split out of `CLAUDE.md` (2026-07-29), verbatim.

## Monorepo (pnpm + turbo, TS/ESM, Postgres + Drizzle)

- **packages:** `db` (schema + migrations; gained two durable
  tables, `notifications` and `push_subscriptions`, in migration `0015` for player notifications —
  see the Player notifications sub-project entry. Migration `0015` touches **no projection table**,
  so it ships with a plain `./deploy/deploy.sh` (no `--rebuild`); life qualification stays derived at
  read time via `lifeQualifiedAt()` and is never materialized on `lives`.
  `notifications`/`push_subscriptions` are durable — absent from
  `apps/projector/src/rebuild.ts`'s truncate list, present in `APP_TABLES`
  (`packages/test-support/src/global-setup.ts`),
  `domain` (zod events, emote/weapon dicts),
  `nitrado` (log-file client), `adm-parser` (pure ADM line parser), `event-log` (append/cursor over
  `events`), `projections` (fold logic), `read-models` (stats queries, including
  `player-priors` — global cross-life reputation via `getPlayerPriors`), `test-support` (Postgres
  test harness), `auth` (Better Auth), `verification` (emote-sequence challenges),
  `tokens` (unban-token ledger + grants/redeem/transfer), `rpt-parser` (RPT login-correlation →
  character sightings), `friends` (friendship pair ordering + viewer-relative projection,
  presence consent flags and `shouldNotifyPresence`; session-scoped location GRANTS
  (`location_shares`) and their `isShareEffective` predicate — F2's `shouldShareLocation` and its
  two switches were deleted by sub-project E;
  transitions, read queries; writes its own notifications inline — see the Friends F1 entry, whose
  ten invariants are all load-bearing).
- **apps:** `ingest-worker` (ADM+RPT poll→events loop; **DB-driven** — sweeps every `servers` row with
  `active=true` using the shared `NITRADO_TOKEN`, no `NITRADO_SERVICE_ID` env), `projector` (events→projections fold),
  `verifier` (emote-verification loop), `api` (Fastify REST + auth; token-store checkout routes require `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `STRIPE_TOKEN_PRICE_ID` — all unset-means-OFF, and the API warns at boot if any of the three is set but the others are not), `web` (Next.js frontend; displays token price from `NEXT_PUBLIC_TOKEN_PRICE_LABEL`, unset-means-OFF),
  `enforcer` (24h death-ban reconciler; dry-run by default), `granter` (token grant sweeps),
  `rebooter` (restarts every `active` server on the top of each **even UTC hour** — 00:00,02:00,…,22:00
  — best-effort per server; **no dry-run, live on deploy**; needs `NITRADO_TOKEN` + a `onelife-rebooter`
  systemd unit),
  `notifier` (player-notifications worker, two passes per tick: **generate** — seven notification
  kinds (gamertag verified, tokens received/granted, ban applied/lifted, life qualified, survival
  milestone) written to the `notifications` table, deduped by a **plain** unique `natural_key`
  index (its `onConflictDoNothing` takes no `targetWhere`) — and **push** —
  delivers unread, recent rows as browser Web Push, retiring a subscription after repeated
  delivery failures. Generation is gated by a forward-only **`NOTIFIER_SINCE`** cutoff (unset =
  OFF, never a silent epoch default) plus **`NOTIFIER_DRY_RUN`** (defaults `true`); push has its own
  independent **`NOTIFIER_PUSH_ENABLED`** kill switch, so generation and delivery can be staged on
  separately. Needs `DATABASE_URL` + `SITE_URL` (the latter is required by the config schema but
  **currently unused** — every notification `href` is a relative path), and (for push) `VAPID_PUBLIC_KEY`/
  `VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` — `VAPID_PUBLIC_KEY` is also read by the **api** unit, which
  serves it publicly at `GET /push/vapid-key`. **Single-instance, at-least-once delivery** — the
  push pass reads unpushed rows without a row lock.
  Needs a `onelife-notifier` systemd unit; deploy runbook in `deploy/README.md`),
  `crier` (obituary-syndication worker; posts every published obituary to Discord (channel
  webhook), Facebook (Page) and Reddit (link post to a subreddit), exactly once per
  (obituary, channel), tracked in the durable
  `syndications` table. Gated by a forward-only **`CRIER_SINCE`** cutoff (unset = OFF) plus
  **`CRIER_DRY_RUN`** (defaults `true`); each channel is enabled independently by the presence
  of its credentials — `CRIER_DISCORD_WEBHOOK_URL` for Discord, both `CRIER_FB_PAGE_ID` and
  `CRIER_FB_PAGE_ACCESS_TOKEN` for Facebook (see `docs/crier-facebook-setup.md`), and all four
  of `CRIER_REDDIT_CLIENT_ID` / `_CLIENT_SECRET` / `_REFRESH_TOKEN` / `_SUBREDDIT` for Reddit
  (see `docs/crier-reddit-setup.md`). Also reads
  `CRIER_INTERVAL_SECONDS` / `CRIER_BATCH_CAP` / `CRIER_MAX_ATTEMPTS` and, like every worker,
  `DATABASE_URL` + `SITE_URL`. Needs a `onelife-crier` systemd unit; deploy runbook in
  `apps/crier/README.md`.
  Three ⚠️ invariants specific to the Reddit channel, each documented at its site and worth
  knowing before touching `apps/crier`:
  1. **Reddit signals most failures as HTTP 200 with the error inside the JSON body**
     (`RATELIMIT`, `SUBREDDIT_NOEXIST`, flair validation, a shadowban). Trusting `res.ok` — which
     is what the Discord and Facebook channels correctly do — would stamp `posted_at` for a post
     that never happened, and `findSyndicationTargets` excludes a posted row forever: no retry, no
     error, no post. `postToReddit` parses `json.errors`.
  2. **A `CRIER_REDDIT_MIN_INTERVAL_SECONDS` deferral is neither a success nor a failure and must
     not touch the row.** Recording it as a failure burns an attempt, and at
     `CRIER_MAX_ATTEMPTS=5` five ticks of ordinary rate limiting would poison every queued row
     permanently. The window is read from `syndications` (`lastPostedAt`), not memory, so it
     survives restarts.
  3. **The channel dispatch in `tick.ts` is a map, not `if discord … else facebook`.** The
     original binary form would silently route any third channel to Facebook.
  The Reddit credential is a refresh token obtained via `authorization_code` with
  `duration=permanent` — the password grant is unusable with 2FA — and unlike the Facebook page
  token it does not expire, so there is no rotation runbook for it).

