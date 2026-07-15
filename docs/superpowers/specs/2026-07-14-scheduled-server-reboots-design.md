# Scheduled server reboots — design

**Date:** 2026-07-14
**Branch:** `feature/scheduled-server-reboots`
**Status:** Approved (brainstorm)

## Goal

Automatically restart every active Nitrado game server on a fixed wall-clock
schedule: **every 2 hours, at the top of an even UTC hour** (00:00, 02:00, 04:00,
…, 22:00 UTC). Fire the restart immediately with no player warning message.

## Non-goals (YAGNI)

- No pre-restart warning / broadcast message to players.
- No per-server schedule overrides.
- No configurable interval or timezone (hard-coded to 2h / even UTC hours).
- No persistence of reboot history (no new tables, no event log entries).
- No dry-run gate — a scheduled restart is a routine, reversible operation (unlike a
  ban), so it goes live as soon as it is released and deployed.

These are deferred; revisit only if a concrete need appears.

## Approach

A new standalone always-on worker, **`apps/rebooter`**, mirroring the structure and
conventions of the existing `enforcer` / `granter` workers (own `config.ts` /
`main.ts` / `tick.ts`, deployed alongside the fleet). Chosen over folding into an
existing worker (muddies responsibilities; existing workers are naive interval loops,
not clock-aligned) and over an external cron/script (the request is for a platform
feature that runs on our infra with the same dry-run safety as the rest of the fleet).

## Components

### 1. `packages/nitrado` — add `restartServer`

`packages/nitrado/src/client.ts`, on `NitradoClient`:

```ts
async restartServer(): Promise<void> {
  await this.postJson(`/services/${this.serviceId}/gameservers/restart`, {});
}
```

- Reuses the existing private `postJson`, which already POSTs with the bearer token
  and asserts the response `status === "success"` (throwing otherwise).
- Empty body — fire immediately, no `message` / `restart_message` params.
- One `NitradoClient` is constructed per server from `(NITRADO_TOKEN, nitradoServiceId)`,
  exactly as the ingest-worker does today.

### 2. `apps/rebooter/src/config.ts`

Zod-parsed env:

- `DATABASE_URL` (required) — to read the `servers` table.
- `NITRADO_TOKEN` (required) — shared fleet token.
- `LOG_LEVEL` (optional).

No dry-run flag: reboots are live immediately once deployed.

### 3. `apps/rebooter/src/schedule.ts` — the one novel piece

A pure, unit-testable boundary calculator — no `Date.now()` inside; the caller passes
the clock:

```ts
// ms from `nowMs` until the next even UTC hour at :00:00 (00,02,…,22).
export function msUntilNextBoundary(nowMs: number): number
```

Semantics:
- Boundaries are even UTC hours at exactly minute 0, second 0, ms 0.
- If `nowMs` is *exactly* on a boundary, return the full interval to the *next*
  boundary (never 0 — avoids a tight loop).
- Correctly wraps 23:xx → next day 00:00 and any odd hour → next even hour.

### 4. `apps/rebooter/src/tick.ts`

- Query `servers` where `active = true`.
- For each row, build/lookup a `NitradoClient(NITRADO_TOKEN, nitradoServiceId)` and
  call `restartServer()`.
- **Best-effort per server:** one server's failure is caught + logged and does *not*
  abort the remaining servers.
- Log each restart (`restarting <name> (#<serviceId>)`) for observability.

### 5. `apps/rebooter/src/main.ts`

Thin loop:

```
loop forever:
  sleep(msUntilNextBoundary(Date.now()))
  await tick()
```

Re-aligning to the wall clock every cycle makes it self-correcting (no interval drift).
On startup, log whether dry-run is on (matching enforcer's startup warning).

## Data flow

```
main loop ── sleep until next even-UTC-hour boundary ──▶ tick()
                                                          │
                        SELECT * FROM servers WHERE active = true
                                                          │
                        for each server (best-effort):
                          NitradoClient(token, serviceId).restartServer()
```

No new tables, no event-log writes, no projections touched.

## Error handling

- Per-server restart failures are caught, logged, and skipped — the sweep continues.
- A `tick()`-level failure (e.g. DB unreachable) is logged; the loop continues to the
  next boundary rather than crashing the process.
- `postJson` already throws on non-2xx / non-`success` Nitrado responses; those surface
  as the per-server error above.

## Testing

- `schedule.test.ts` — `msUntilNextBoundary` boundary math: mid-odd-hour, mid-even-hour,
  exactly-on-boundary (returns full interval, not 0), and 23:xx → 00:00 next-day wrap.
- `tick.test.ts` — using the existing Postgres test harness + a fake Nitrado `fetch`:
  calls restart for each active server; inactive servers are skipped; one server's
  failure does not abort the others.
- `main.ts` stays a thin, untested loop (repo convention for the other workers).

## Deployment note

The new worker joins the fleet restarted by `deploy/deploy.sh` and begins issuing
reboots on the next even-UTC-hour boundary as soon as it is released and deployed — no
gate to flip.
