# Badlands fleet turnover

Date: 2026-10-09. Deadline: the DayZ Badlands expansion ships on **2026-10-15**.

## Intent

On 2026-10-15 the site follows the new fleet, and nothing from a retired server leaks into a
new one.

| Before (2026-10-09) | After (2026-10-15) |
| --- | --- |
| Chernarus, id 1, service 18196786, slug `chernarus` | retired, slug renamed `chernarus-1.29` |
| Sakhal, id 2, service 19547068 | retired (service expired 2026-10-09; `active=false` already set in prod) |
| Livonia, id 3, service 19366604, map `enoch` | retired |
| | **new** Chernarus row on service 19366604, slug `chernarus`, map `chernarusplus` |
| | **new** Nasdara row on a new Nitrado service |

All servers are vanilla.

Decided with Steve:

- A re-mapped service gets a **new `servers` row**. It never relabels the old one.
- The old Chernarus row is renamed to `chernarus-1.29` **at cutover**, not before.
- A life that was still open when its server retired reads **"Alive when the server closed"**.
  It is a survivor's ending: it counts as a life, never as a death, and never produces an
  obituary or a ban.
- The cutover is a **tested command** (dry run by default, one transaction), not a SQL runbook.
- Retired servers **drop off the boards**. No archive board in this release.

Success means:

- no life continues across a map change;
- no old log is ingested into the wrong row;
- every past life and obituary stays reachable;
- a retirement is never treated as a death or a ban.

## Why the obvious approach is wrong

1. **Relabelling the Livonia row carries lives across maps.** The fold keys open lives on
   `(server_id, player_id)` (`packages/projections/src/fold.ts`). Anyone alive on Livonia who
   joins the new Chernarus gets a fresh spawn, but the fold continues their Livonia life. Every
   historical Livonia position would also be redrawn on Chernarus geometry (15360 vs 12800).
2. **A fresh row for the same service backfills Livonia's logs as Chernarus.** Ingest decides
   what to pull by matching `adm_files` rows for the server id (`apps/ingest-worker/src/tick.ts`).
   A new row has none, so its first sweep pulls every ADM file still on the service.
3. **A synthetic "server retired" event does not fit the event log.** `events.adm_file_id` is
   `NOT NULL`; every event traces to a log line.
4. **Open lives on a retired server never close.** No death line will ever arrive, so they read
   as alive forever, and the notifier keeps generating open-life notifications for them.

## 1. Schema and ingest

One migration on `servers`:

- Replace `servers_nitrado_service_id_uniq` with a **partial** unique index on
  `(nitrado_service_id) WHERE active`. A service may have any number of past rows, but at most
  one live row.
- Add `retired_at timestamptz NULL`. This is distinct from `active = false`, which
  `deploy/README.md` documents as a reversible *pause*. A paused server's open lives are paused;
  a retired server's open lives have ended. The migration sets no data.
- Add `ingest_from timestamptz NULL`, a forward-only ingest cutoff. Unset means no cutoff (the
  existing rows' behaviour, explicitly OFF, not an epoch default).

The migration's journal `when` must exceed entry 0038's (`1787158800000`). Verify it applied by
checking the columns and the index exist, not by trusting drizzle-kit's success output.

Ingest (`ingestTick`): when the server has `ingest_from`, skip every file whose offset-corrected
start time (`localTimestampMs + offsetMs`) is before it. A file with no readable timestamp is
skipped, and logged, while a cutoff is set. The clock offset is derived from the file listing
before the check, so a brand-new row (offset 0) still compares in corrected time. ADM files
rotate on every server restart and a map change requires a restart, so file granularity aligns
with the switch.

No other `servers` reader changes. All select by `id` or `active`. The enforcer resolves a ban's
service by server `id`, so a ban issued on the retired Livonia row still lifts against the right
physical server.

## 2. Retirement at read time

Rule: **a life with `ended_at IS NULL` on a server with `retired_at` set ended at `retired_at`,
and not by death.** Nothing is written to `lives`. The fold, projection tables and `--rebuild`
are untouched (derived facts are computed at read time, never materialized).

In `packages/read-models`, the shared life queries compute it once in SQL:

- `endedAt` = `COALESCE(lives.ended_at, servers.retired_at)`, so existing downstream
  "open means alive" checks are right without edits.
- New field `endReason: 'death' | 'server_retired' | null`, threaded through
  `packages/api-client` types.
- An open session on a retired server is capped at `retired_at` for playtime.

Display: every place that renders a life's state reads `endReason` and shows "Alive when the
server closed" instead of a cause of death. Known places: `ticket-stage.tsx`,
`components/account/format.ts`, `client-logic` `player-format.ts` and `life-timeline.ts`,
`components/servers/grouping.ts`, the life page and its OpenGraph image. The implementation plan
enumerates the full list from a grep of `endedAt` readers.

Counts: a retired-ended life counts in **lives** and toward **longest life**, never in
**deaths** or anything kill-related.

Workers:

| Worker | Treatment |
| --- | --- |
| Enforcer | Reads raw `lives` and acts on deaths. A retirement never reaches it. Add a test pinning that. |
| Newsdesk / obituaries | Driven by deaths. A retirement produces none. Add a test pinning that. |
| Notifier | `generators/lives.ts` selects every open slugged life. Add `servers.retired_at IS NULL`. |

Boards: retired servers are inactive, and every board already filters on `active`. No change.

## 3. The cutover command

`apps/projector/src/fleet-cutover.ts`, script `fleet-cutover`, next to the existing operator
backfills. Generic, not hardcoded for this date.

```
pnpm --filter @onelife/projector run fleet-cutover -- \
  --retire chernarus=chernarus-1.29 \
  --retire livonia \
  --add chernarus:Chernarus:chernarusplus:19366604 \
  --add nasdara:Nasdara:<codename>:<service-id> \
  [--retired-at <ISO>] [--apply]
```

- `--retire <slug>[=<new-slug>]` sets `active=false`, `retired_at`, and optionally moves the slug.
  An already-paused row with `retired_at` NULL is accepted (Sakhal's case).
- `--add <slug>:<name>:<map>:<service>` inserts an active row with `ingest_from` = the cutover
  time.
- `--retired-at` overrides the retirement timestamp (default: transaction time). It exists for
  Sakhal, retired after the fact.
- Without `--apply`: print the server table before and after, and change nothing.
- With `--apply`: one transaction, in order: retirements, then slug renames, then inserts. The
  old row must release `chernarus` before the new row takes it.
- Refuses, changing nothing, when:
  - a slug or service matches no row;
  - a target is already retired;
  - a slug would collide;
  - a service would end up with two active rows.

It needs `DATABASE_URL` passed explicitly, like every other operator script.

## 4. Nasdara, copy, rollout

Nasdara needs almost nothing on the day:

- `mapLabel` title-cases an unknown codename, and `serverTagline` has a fallback.
- `worldSize` returns null for an unknown codename, so the map renders its honest no-map state.
- Add "Nasdara" to the newsdesk's place-name list (`apps/newsdesk/src/no-place.ts`).

A post-release follow-up PR adds the real codename label, world size, `deploy/dzmap.yaml` tiles,
place names and a tagline once the map exists.

Copy in this release:

- `join-servers.tsx` `HOSTS`: Chernarus and Nasdara.
- `/about`: check for per-server copy.
- Delete the unused `MAP_SLUGS` in `apps/web/src/lib/servers.ts`.

Rollout:

1. Release and deploy before 2026-10-15: one migration, **no `--rebuild`** (no projection table
   changes shape).
2. Immediately after the deploy, retire Sakhal properly:
   `fleet-cutover --retire sakhal --retired-at <Sakhal's last ingested event time> --apply`.
3. On 2026-10-15:
   1. Run the cutover (dry run, then `--apply`).
   2. **Then** switch the maps on Nitrado. The reverse order would ingest the first Chernarus log
      into the Livonia row.
   3. Watch `journalctl -u onelife-ingest` and confirm new deaths land on the new rows.

The cost is the last few minutes of the old maps' live logs before the switch, which are not
ingested. Players are kicked by the restart regardless.

`deploy/README.md` gets the runbook. Its "Enabling ingest" SQL (`ON CONFLICT
(nitrado_service_id)`) no longer matches a partial index and is rewritten to point at
`fleet-cutover`.

Before the 15th, confirm a dotted slug is served end to end in production: `/survivors/chernarus-1.29`
and a life page under it. No app code rejects dots, but nginx config was not inspected.

## Testing

- **Migration.** Two rows for one service are allowed when at most one is active, and refused
  when both are.
- **Ingest.** Files before `ingest_from` are skipped. An unreadable timestamp is skipped while a
  cutoff is set. The comparison uses offset-corrected time. Unset `ingest_from` behaves exactly
  as today.
- **Cutover command:**
  - a dry run changes nothing;
  - `--apply` is atomic;
  - every refusal case leaves the table untouched;
  - the slug handover works in one run;
  - an already-paused row is accepted.
- **Read-models.**
  - An open life on a retired server has `endedAt = retired_at` and
    `endReason = 'server_retired'`.
  - A paused, unretired server's open life stays open.
  - A retired life counts in lives, not deaths.
  - A session's playtime is capped at `retired_at`.
- **Workers.** The notifier skips retired servers. The enforcer and newsdesk never act on a
  retirement.
- **Web.** "Alive when the server closed" renders at each display point.

## Out of scope

- An archive board for retired servers.
- Redirects for old `/players/*/chernarus/lives/*` links. The slug is reused, so after cutover
  those links open the new server's life of the same number. Accepted as a consequence of
  giving the live server the clean slug.
- Nasdara geometry, tiles and place names (the follow-up PR).
