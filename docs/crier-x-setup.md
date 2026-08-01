# X (Twitter) setup for crier

One-time setup to let crier post to the DayZ One Life X account. Prereq: you are logged in as
that account.

## ⚠️ It costs money

There is **no free tier** — X discontinued it in February 2026 and new developer accounts are
pay-per-use. Worse, in April 2026 X began charging **$0.20 for a post containing a link**,
versus $0.015 for a plain one. Every crier post carries an obituary URL, so **every X post
costs $0.20.** There is no way around it: moving the link into a self-reply just makes the
reply the link post.

Budget accordingly — and see "Rollout" below, which prices the first run before it happens.

## Steps

1. **Create the app**: https://developer.x.com → Developer Portal → create a project and app.
2. **Load credits**: Developer Console → Billing. No call succeeds until there is a balance.
   Set a low auto-recharge trigger so a runaway cannot spend much.
3. **Set app permissions to Read and Write.** Default is read-only, and posting will 403
   until you change it.
4. **⚠️ Regenerate the access token AFTER changing permissions.** A token minted while the app
   was read-only stays read-only forever, no matter what the app settings say afterwards. This
   is the single most common setup failure.
5. **Copy the four credentials** from Keys and Tokens:
   - API Key → `CRIER_X_API_KEY`
   - API Key Secret → `CRIER_X_API_SECRET`
   - Access Token → `CRIER_X_ACCESS_TOKEN`
   - Access Token Secret → `CRIER_X_ACCESS_SECRET`

   They do not expire. Copy them on your own machine, not the server, and prefix any shell
   command with a space so it stays out of history (with `HISTCONTROL=ignorespace`).
6. **Set all four env vars** on the server and restart crier — dry-run first, see Rollout.

## Rollout

`CRIER_DRY_RUN` defaults ON and logs one `dry-run: would post` line per row. Since X shares
`CRIER_SINCE` with the other channels and the ledger has no `x` rows yet, **the first live run
replays the entire back catalogue** to the account, oldest death first, 10 per 60s tick. That
is intended for a fresh timeline — but price it first:

1. Set the four vars, restart with dry-run still on.
2. Count the `would post` lines for channel `x`. Multiply by $0.20. That is the backfill bill.
3. Set `CRIER_DRY_RUN=false`, restart.
4. Watch for `rate limited — pausing this channel` warnings. These are expected and harmless
   during a backfill: X allows 100 posts per 15 minutes and crier runs faster than that, so
   when X throttles, crier pauses **only the X channel** for the rest of that tick — Discord
   and Facebook keep posting on schedule, unaffected — and resumes X on the next tick. The
   backfill drains over successive ticks without consuming any row's attempt budget, so rate
   limiting never poisons a row.

## If posting fails

- **403** — the app is read-only, or the token predates the permission change. Redo steps 3–4.
- **401** — a credential is wrong, or the server clock has drifted (OAuth 1.0a signatures carry
  a timestamp). Check `timedatectl` before re-minting keys.
- **Payment required / 402** — credits are exhausted.

After fixing the cause, revive the poisoned rows: see `apps/crier/README.md` Operations.
