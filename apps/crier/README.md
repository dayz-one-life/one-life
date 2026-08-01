# crier

Posts every published obituary to the configured channels (Discord webhook, Facebook Page,
X account), exactly once per (obituary, channel), recorded in the durable `syndications` table.

## Env

| Var | Meaning |
| --- | --- |
| `CRIER_DRY_RUN` | default ON; set the literal string `false` to post for real |
| `CRIER_SINCE` | ISO instant; **unset = worker does nothing**. Set to the enablement time to skip history; point it backwards deliberately to backfill (posts pace at one per 2s) |
| `CRIER_DISCORD_WEBHOOK_URL` | presence enables Discord (channel settings → Integrations → Webhooks) |
| `CRIER_FB_PAGE_ID` + `CRIER_FB_PAGE_ACCESS_TOKEN` | presence of BOTH enables Facebook — see `docs/crier-facebook-setup.md` |
| `CRIER_X_API_KEY` + `_API_SECRET` + `_ACCESS_TOKEN` + `_ACCESS_SECRET` | presence of ALL FOUR enables X — see `docs/crier-x-setup.md`. ⚠️ every X post costs $0.20 because it carries a link |
| `CRIER_INTERVAL_SECONDS` / `CRIER_BATCH_CAP` / `CRIER_MAX_ATTEMPTS` | 60 / 10 / 5 |
| `DATABASE_URL`, `SITE_URL` | as every worker |

## Operations

- A row at the attempt cap is poisoned and skipped; after fixing the cause (e.g. a new FB
  token), revive with: `UPDATE syndications SET attempts = 0 WHERE channel = 'facebook' AND posted_at IS NULL;`
- The revive query takes the channel name: `UPDATE syndications SET attempts = 0 WHERE channel = 'x' AND posted_at IS NULL;`
- A `rate limited — pausing this channel` warning is not an error. X allows 100 posts per 15
  minutes; crier pauses only that channel for the rest of the tick — Discord and Facebook keep
  posting — without recording an attempt, and resumes it on the next tick 60s later, so a
  backfill paces itself. Rows are never poisoned by throttling.
- Rollout: set `CRIER_SINCE`, leave dry-run on, watch the logs for "dry-run: would post" lines,
  then set `CRIER_DRY_RUN=false`.
- The systemd unit (`onelife-crier`) is created once by the operator, copying any sibling
  worker unit (e.g. `onelife-notifier`) with the ExecStart pointed at `apps/crier`.
