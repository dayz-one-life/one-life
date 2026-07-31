# crier

Posts every published obituary to the configured channels (Discord webhook, Facebook Page),
exactly once per (obituary, channel), recorded in the durable `syndications` table.

## Env

| Var | Meaning |
| --- | --- |
| `CRIER_DRY_RUN` | default ON; set the literal string `false` to post for real |
| `CRIER_SINCE` | ISO instant; **unset = worker does nothing**. Set to the enablement time to skip history; point it backwards deliberately to backfill (posts pace at one per 2s) |
| `CRIER_DISCORD_WEBHOOK_URL` | presence enables Discord (channel settings → Integrations → Webhooks) |
| `CRIER_FB_PAGE_ID` + `CRIER_FB_PAGE_ACCESS_TOKEN` | presence of BOTH enables Facebook — see `docs/crier-facebook-setup.md` |
| `CRIER_INTERVAL_SECONDS` / `CRIER_BATCH_CAP` / `CRIER_MAX_ATTEMPTS` | 60 / 10 / 5 |
| `DATABASE_URL`, `SITE_URL` | as every worker |

## Operations

- A row at the attempt cap is poisoned and skipped; after fixing the cause (e.g. a new FB
  token), revive with: `UPDATE syndications SET attempts = 0 WHERE channel = 'facebook' AND posted_at IS NULL;`
- Rollout: set `CRIER_SINCE`, leave dry-run on, watch the logs for "dry-run: would post" lines,
  then set `CRIER_DRY_RUN=false`.
- The systemd unit (`onelife-crier`) is created once by the operator, copying any sibling
  worker unit (e.g. `onelife-notifier`) with the ExecStart pointed at `apps/crier`.
