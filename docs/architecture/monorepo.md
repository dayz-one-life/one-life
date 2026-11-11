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
  `nitrado` (log-file client), `adm-parser` (pure ADM line parser),
  `death-verdict` (pure, no workspace dependencies: the death-cause vocabulary and
  `toPublicDeath`, the one function that turns a stored verdict into the words a page prints,
  with `writerBrief` for what the obituary writer is told about the same death —
  nothing imports it yet. It also holds the classifier's evidence layer, a port of a reference
  pipeline kept with the private golden data: `evidence/parse.ts` (`parseEvidenceLine` — separate
  from `adm-parser`'s `parseLine` on purpose; it emits no events and has no `subIndex` contract),
  `evidence/log-clock.ts` (UTC from the log's own header date and wall clock, never from
  `raw_lines.occurred_at`; a file must be stamped whole and in order), `context/cluster.ts`
  (which lines are one death and which is its primary line — ⚠️ never a `committed suicide`
  line, so the line a life was folded from is not always the primary), `context/select.ts`
  (`selectContextLines`, the ONE rule for which lines a death needs) and `context/build.ts`
  (`DeathContext`). Distances and float sums are the reference's to the last bit (`pyHypot`,
  `pySum`, `pyRound` — never `Math.hypot` or a plain `+` where the reference calls `hypot` or
  `sum`): rules compare them with round thresholds. `classify/` holds the rules, each a named
  function with the reference's rule id: `killed.ts` (a `killed by` line, A01 to A17), `bare.ts`
  (a stated mechanism on a bare death line, B01 to B08), `finish.ts` (the post-pass: assists,
  earlier attackers, co-causes, the heat faint cycle), `conditions.ts`, `tables.ts` (every
  constant a rule compares against — changing one is a `CLASSIFIER_VERSION` bump) and
  `credit.ts` (`creditEvidence`: tests 1 to 5 of the trap-kill bar, pure). ⚠️ Each rule sets the
  attribution's `basis` itself: only `kill_line`, `kill_line_driver` and `kill_line_self` may
  ever put a name on a page; `placement` (a trap's placer) can become a trap kill and only
  through the bar; every inferred person is `not_stated`. ⚠️ `creditEvidence` answers
  `evidence_passes`, `refused` or `not_applicable` and never `credited`: `evidence_passes` means
  only that the log evidence holds — the two tests that need the database and any operator
  override belong to whoever stores the verdict, and only that writer may set `credited` or
  `granted`. A placement counts only when it was written before the device went off (the
  victim's trip line for a tripwire); every trip line of the victim in the last six seconds is
  the death's own detonation, and two wires tripped in that time refuse (`ambiguous_trip`). Its
  other flags (`fuse_not_4s`, `no_explosion_line`, `multi_blast`, `kill_lines_xN`,
  `held_frag_before_blast`, `claymore_by_other_player`) mark shapes no real trap death has had;
  they do not refuse, so whatever lists trap kills for the operator must show them. ⚠️ Only the stated rules are
  ported: a death that needs an inferred rule comes back as rule `B00`, "unknown", and
  `golden-attest.json`'s `gaps` counts them; nothing may store or show a verdict while it is
  not 0. `ContextInput.files[].boot` is the file's number in the server's boot order over ALL
  its files (it gives the restarts between a trap being set and going off); a loader that
  passes part of a log must pass `SelectOptions.bootOrdinals`. Its private
  golden suites need `DEATH_GOLDEN_DIR` and are skipped without it;
  `pnpm --filter @onelife/death-verdict run golden` runs them where the data is and writes
  `golden-attest.json`. **The attestation is signed.** It records the hash of `src/`
  (`sourceHash`), of the golden harness — `scripts/**`, `test/golden-private/**`,
  `vitest.golden.config.ts` and the `golden` command (`harnessHash`) — and of every private file
  the suites read, answers included (`corpusSha`), how many suites and tests ran, and the
  outcome; the Ed25519 key that signs it lives ONLY with the golden data
  (`$DEATH_GOLDEN_DIR/attest-key/`), and `golden-attest.pub.pem` is its public half. The public
  `attest.test.ts` verifies the signature and both hashes, pins the suite and test counts, and
  holds a ceiling on the known gaps that each step lowers. So a change under `src/`, `scripts/`
  or `test/golden-private/` needs a fresh golden run by someone who has the data — the file
  cannot be edited by hand. A run counts only when `scripts/golden-reporter.ts` saw every suite
  of `GOLDEN_SUITES` pass with nothing skipped and nothing changed underneath; it deletes the
  previous run's record when a run starts. ⚠️ Two limits, stated plainly: the signature proves
  the file came from a machine with the golden data, not that its holder ran the suites
  honestly; and a pull request can replace `golden-attest.pub.pem` together with the
  attestation — a change to that file is a change to who may attest and must be reviewed as
  one), `event-log` (append/cursor over
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
  delivers unread, recent rows to two transports, browser Web Push and native device push (FCM),
  retiring a subscription after repeated delivery failures. Generation is gated by a forward-only
  **`NOTIFIER_SINCE`** cutoff (unset = OFF, never a silent epoch default) plus **`NOTIFIER_DRY_RUN`**
  (defaults `true`); push has its own independent **`NOTIFIER_PUSH_ENABLED`** kill switch, so
  generation and delivery can be staged on separately. Needs `DATABASE_URL` + `SITE_URL` (the
  latter is required by the config schema but **currently unused** — every notification `href` is
  a relative path), and (for web push) `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` —
  `VAPID_PUBLIC_KEY` is also read by the **api** unit, which serves it publicly at
  `GET /push/vapid-key` — and (for device push) `FCM_PROJECT_ID`/`FCM_SERVICE_ACCOUNT_JSON_BASE64`,
  either missing leaving device push OFF without affecting web push or generation; there is no
  Firebase project yet, so both ship unset. **Single-instance, at-least-once delivery** — the
  push pass reads unpushed rows without a row lock.
  Needs a `onelife-notifier` systemd unit; deploy runbook in `deploy/README.md`),
  `crier` (obituary-syndication worker; posts every published obituary to Discord (channel
  webhook) and Facebook (Page), exactly once per (obituary, channel), tracked in the durable
  `syndications` table. Gated by a forward-only **`CRIER_SINCE`** cutoff (unset = OFF) plus
  **`CRIER_DRY_RUN`** (defaults `true`); each channel is enabled independently by the presence
  of its credentials — `CRIER_DISCORD_WEBHOOK_URL` for Discord, both `CRIER_FB_PAGE_ID` and
  `CRIER_FB_PAGE_ACCESS_TOKEN` for Facebook (see `docs/crier-facebook-setup.md`). Also reads
  `CRIER_INTERVAL_SECONDS` / `CRIER_BATCH_CAP` / `CRIER_MAX_ATTEMPTS` and, like every worker,
  `DATABASE_URL` + `SITE_URL`. Needs a `onelife-crier` systemd unit; deploy runbook in
  `apps/crier/README.md`).

