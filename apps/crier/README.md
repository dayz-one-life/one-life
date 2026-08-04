# crier

Posts every published obituary to the configured channels (Discord webhook, Facebook Page,
Reddit link post), exactly once per (obituary, channel), recorded in the durable `syndications`
table.

## Env

| Var | Meaning |
| --- | --- |
| `CRIER_DRY_RUN` | default ON; set the literal string `false` to post for real |
| `CRIER_SINCE` | ISO instant; **unset = worker does nothing**. Set to the enablement time to skip history; point it backwards deliberately to backfill (posts pace at one per 2s) |
| `CRIER_DISCORD_WEBHOOK_URL` | presence enables Discord (channel settings → Integrations → Webhooks) |
| `CRIER_FB_PAGE_ID` + `CRIER_FB_PAGE_ACCESS_TOKEN` | presence of BOTH enables Facebook — see `docs/crier-facebook-setup.md` |
| `CRIER_REDDIT_CLIENT_ID` + `_CLIENT_SECRET` + `_REFRESH_TOKEN` + `_SUBREDDIT` | presence of ALL FOUR enables Reddit — see `docs/crier-reddit-setup.md` |
| `CRIER_REDDIT_FLAIR_ID` / `_USER_AGENT` | optional; the agent defaults to a distinctive one, which Reddit requires |
| `CRIER_REDDIT_MIN_INTERVAL_SECONDS` | 600. Reddit-only rate cap, on top of the 2s inter-post gap |
| `CRIER_INTERVAL_SECONDS` / `CRIER_BATCH_CAP` / `CRIER_MAX_ATTEMPTS` | 60 / 10 / 5 |
| `DATABASE_URL`, `SITE_URL` | as every worker |

## Operations

- A row at the attempt cap is poisoned and skipped; after fixing the cause (e.g. a new FB
  token), revive with: `UPDATE syndications SET attempts = 0 WHERE channel = 'facebook' AND posted_at IS NULL;`
- **⚠️ Reddit reports most rejections as HTTP 200 with the error in the body**, so a Reddit
  failure looks like any other recorded failure — read `last_error`, not the status. The Reddit
  credential is a refresh token and does not expire, so there is no rotation step for it.
- **A Reddit rate-cap deferral is not a failure** and burns no attempt: the row waits for a later
  tick. Watch for `rate cap: deferred` and a non-zero `deferred` on the tick summary. A backfill
  therefore drains to Reddit at one post per `CRIER_REDDIT_MIN_INTERVAL_SECONDS` while Discord and
  Facebook take it at the 2s pace.
- Rollout: set `CRIER_SINCE`, leave dry-run on, watch the logs for "dry-run: would post" lines,
  then set `CRIER_DRY_RUN=false`.
- The systemd unit (`onelife-crier`) is created once by the operator, copying any sibling
  worker unit (e.g. `onelife-notifier`) with the ExecStart pointed at `apps/crier`.
