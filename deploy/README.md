# Deploying dayzonelife.com (production runbook)

This box is a **shared multi-tenant host** (also runs regime.fi, manicdotes.com,
factory.eli5hq.com). The One Life platform runs as **systemd services** against the
**host Postgres**, fronted by **nginx + Let's Encrypt**, with DNS proxied through
**Cloudflare**.

## Topology

| Component | Where | Notes |
|-----------|-------|-------|
| Reverse proxy | nginx `dayzonelife.com` vhost | apex serves the app; `www` + `:80` 301 → `https://dayzonelife.com` |
| Web (Next.js) | `127.0.0.1:3010` | `onelife-web.service`; the ONLY upstream nginx talks to |
| API (Fastify) | `127.0.0.1:3011` | `onelife-api.service`; reached only via Next.js rewrites, not nginx |
| Workers | no ports | verifier, projector, enforcer, granter, rebooter, notifier, newsdesk (+ ingest, disabled) |
| Database | host Postgres `127.0.0.1:5432` | role `onelife`, db `onelife` (+ `onelife_test`) |

**Request flow:** browser → nginx (`:443`) → web (`:3010`). The web app's
`next.config.ts` `rewrites()` forward `/api/*`, `/api/auth/*`, `/media/*` to
`API_ORIGIN` (the Fastify API on `:3011`). nginx never needs to know about the API.

> Ports 3000/3001 belong to **regime** (do not reuse). 3002/3999 were the old
> `one-life-bot` Tribune web (now decommissioned).

## Services

Units live in `/etc/systemd/system/onelife-*.service`. All run as user `acab`,
`WorkingDirectory=/var/www/dayzonelife.com`, `EnvironmentFile=…/.env`,
`Restart=always`, `WantedBy=multi-user.target` (start on boot).

```bash
# status of the fleet
for s in web api verifier projector enforcer granter rebooter notifier newsdesk ingest; do
  printf "onelife-%-10s %s\n" "$s" "$(systemctl is-active onelife-$s)"; done

sudo systemctl restart onelife-web        # restart one
sudo journalctl -u onelife-api -f         # tail logs
```

- **onelife-web** — runs the Next `next` binary directly:
  `apps/web/node_modules/.bin/next start -H 127.0.0.1 -p 3010`.
  (Do NOT invoke via `pnpm … start -- -H …`: pnpm forwards the `--` literally and
  `next` treats it as a project-dir arg and crashes.)
- **onelife-api** — `pnpm --filter @onelife/api start`, `Environment=PORT=3011`.
- **workers** — `pnpm --filter @onelife/<app> start`.
- **onelife-ingest** — DB-driven: it sweeps every `servers` row with `active = true`
  (one cached Nitrado client per service id, shared token). With no active servers it
  idles harmlessly. See "Enabling ingest" below.
- **onelife-rebooter** — restarts every **active** server in the `servers` table on the top of
  every even UTC hour (00:00, 02:00, …, 22:00), using the shared `NITRADO_TOKEN`. Requires a
  `onelife-rebooter` systemd unit on the host (create it alongside the other worker units).
  **`NITRADO_TOKEN` must be set in `.env`** — unlike `enforcer`, the rebooter treats it as
  required and will crash-loop under `Restart=always` if it is missing.
- **onelife-notifier** — `pnpm --filter @onelife/notifier start`. Two passes per tick: **generate**
  (nine notification kinds — gamertag verified, tokens received/granted, ban applied/lifted, life
  qualified, survival milestone, obituary/birth-notice published — written to the durable
  `notifications` table) and **push** (delivers unread, recent notifications to subscribed browsers
  via Web Push, retiring an endpoint after repeated failures). Requires a `onelife-notifier` systemd
  unit on the host (create it alongside the other worker units). Needs `DATABASE_URL` and `SITE_URL`
  in `.env` (`SITE_URL` is currently reserved/unused by this worker — every notification `href` is a
  relative path; it is threaded through `GeneratorDeps` but nothing reads it yet); see "Player
  notifications: environment + rollout" below for the full var list and the required staged go-live.
  Migration `0015` adds only the two new durable tables (`notifications`, `push_subscriptions`) —
  **no projection table changes**, so this release deploys with a plain `./deploy/deploy.sh`, **not**
  `--rebuild`. The `life_qualified` notification derives each life's qualification instant at read
  time via `lifeQualifiedAt()`, exactly as the survivors board and the enforcer do, so it works on
  pre-existing lives immediately with no backfill.
- **onelife-newsdesk** — `pnpm --filter @onelife/newsdesk start`. Sweeps qualified deaths lacking a
  published obituary and writes each in the One Life voice via OpenRouter, then publishes it.
  Obituary-only revival of the retired content engine — no birth notices, no news vertical, no
  images, no Discord posting. Requires a `onelife-newsdesk` systemd unit on the host, **created by
  hand** (not checked into the repo — mirror of the other worker units, and the same reason the
  removal's one-time operator step below had to disable it by hand). Needs `DATABASE_URL`,
  `OPENROUTER_API_KEY`, and `NEWSDESK_MODEL` (default `anthropic/claude-sonnet-5`) in `.env`.
  **Two gates, both default OFF:** `NEWSDESK_DRY_RUN` defaults `true` (logs the obituary it would
  generate, never calls the model or writes); `NEWSDESK_SINCE` unset turns the whole pass off —
  set it once to the ISO-8601 go-live instant to begin **forward-only** coverage, so history is
  never backfilled at API cost. Other vars: `NEWSDESK_INTERVAL_SECONDS` (default 300),
  `NEWSDESK_BATCH_CAP` (default 10), `NEWSDESK_MAX_ATTEMPTS` (default 3),
  `NEWSDESK_TEMPERATURE` (default 0.7). **Go-live order:** deploy normally
  (`./deploy/deploy.sh`, no `--rebuild` — migration `0030` touches no projection table) → watch a
  dry-run interval and confirm the log shows `DRY RUN: would generate obituary` lines → set
  `NEWSDESK_SINCE` to the go-live instant → set `NEWSDESK_DRY_RUN=false` → watch the first live
  tick and read the first published obituary before walking away.

## Player notifications: environment + rollout

`apps/notifier` (see `apps/notifier/src/config.ts` for the authoritative schema) reads:

```
DATABASE_URL=                               # shared with the rest of the fleet
SITE_URL=https://dayzonelife.com            # reserved/unused: every notification href is a relative path; not currently read
NOTIFIER_INTERVAL_SECONDS=60                # sweep cadence
NOTIFIER_SINCE=                             # ISO-8601 go-live cutoff; UNSET = generation OFF
NOTIFIER_DRY_RUN=true                       # logs intended notifications; set false to write them
NOTIFIER_LOOKBACK_HOURS=48                  # per-tick generator query window
NOTIFIER_PUSH_ENABLED=true                  # kill switch for the push pass (generation is unaffected)
NOTIFIER_PUSH_MAX_PER_TICK=50
NOTIFIER_PUSH_MAX_AGE_MINUTES=60            # don't push a notification older than this
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=                              # a mailto: address, e.g. mailto:ops@dayzonelife.com
FCM_PROJECT_ID=                             # Firebase project id; UNSET = device push OFF
FCM_SERVICE_ACCOUNT_JSON_BASE64=            # base64 of the whole service-account JSON
LOG_LEVEL=info
```

Generate the VAPID key pair once, before first enabling push:

```bash
npx web-push generate-vapid-keys
```

Put `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` into the shared
`/var/www/dayzonelife.com/.env`. **`VAPID_PUBLIC_KEY` must also be readable by the `onelife-api`
unit** — the API serves it publicly at `GET /push/vapid-key` so the browser can call
`pushManager.subscribe()`; the private key is notifier-only and must never reach the API or the
web bundle.

### Native device push (FCM)

Device push is OFF until both variables above are set; web push and notification generation are
unaffected by their absence. Setting it up is a one-time operator task:

1. Create a Firebase project and enable Cloud Messaging.
2. Create a service account with the **Firebase Cloud Messaging API Admin** role and download its
   JSON key.
3. `base64 -i service-account.json | tr -d '\n'` and put the result in
   `FCM_SERVICE_ACCOUNT_JSON_BASE64`. Base64 because the key is a PEM full of newlines, which does
   not survive a `.env` file intact.
4. Set `FCM_PROJECT_ID` to the Firebase project id.
5. **For iOS only:** upload an APNs authentication key (from an Apple Developer Program membership)
   to Firebase under Project Settings → Cloud Messaging. FCM relays to APNs, so without this step
   Android push works and iOS push does not.

These credentials are notifier-only. They must never reach the API or the web bundle.

Restart `onelife-notifier` after setting them.

**Staged rollout (spec §8) — go live in four steps, not one:**

1. Deploy with `NOTIFIER_DRY_RUN=true` and `NOTIFIER_SINCE` unset. The unit runs, generation is
   fully OFF (no rows written), push is inert (nothing to push). Confirms the service starts cleanly.
2. Set `NOTIFIER_SINCE` to a go-live instant (still `NOTIFIER_DRY_RUN=true`). Generators run and log
   what *would* be written, with zero effect on the `notifications` table — a dry-run rehearsal
   against real data.
3. Set `NOTIFIER_DRY_RUN=false` with `NOTIFIER_PUSH_ENABLED=false`. Notifications are now written and
   readable in the web rail, but no browser push is sent yet.
4. Set `NOTIFIER_PUSH_ENABLED=true` (and confirm VAPID keys are set) to turn on delivery.

Restart `onelife-notifier` after each `.env` change (`sudo systemctl restart onelife-notifier`).

## Environment

### ⚠️ Never enable `ENFORCER_DRY_RUN` while a ban is `applied`

Under dry-run, the enforcer's expire and lift arms mark a ban `expired`/`lifted` **without calling
Nitrado**. So switching dry-run on mid-ban closes the database row while its entries stay on the
game server's Banlist — and once the row is closed, no query ever revisits it, so nothing will
ever remove them.

Since bans are placed against the player's **account ID** as well as their gamertag, such an
orphan is now **permanent and unshakeable**: the player cannot escape it by renaming, and only
manual editing of the Banlist will clear it. Before this feature the orphan was a name, which a
rename shed on its own.

Check first, and wait for it to clear:

```bash
psql "$DATABASE_URL" -tAc "select count(*) from bans where status='applied' and dry_run=false;"
# must be 0 before setting ENFORCER_DRY_RUN=true
```

If you have already tripped this, the affected entries are recoverable — find them with the query
below and delete those lines from the server's Banlist by hand:

```bash
psql "$DATABASE_URL" -c "select gamertag, dayz_id, server_id, status, lifted_at from bans
                         where status in ('expired','lifted') and dry_run=false
                         order by lifted_at desc limit 20;"
```

Runtime env is `/var/www/dayzonelife.com/.env` (loaded by systemd `EnvironmentFile`).
Key deployment values added at standup:

```
BETTER_AUTH_SECRET=<64-char hex>            # generated with: openssl rand -hex 32
BETTER_AUTH_URL=https://dayzonelife.com
AUTH_TRUSTED_ORIGINS=https://dayzonelife.com
MAGIC_LINK_ENABLED=true                     # set false to hide email sign-in on the login page
API_ORIGIN=http://127.0.0.1:3011
NEXT_PUBLIC_APP_URL=https://dayzonelife.com
NEXT_PUBLIC_SITE_URL=https://dayzonelife.com
DISCORD_CLIENT_ID=                          # fill BOTH to enable Discord login
DISCORD_CLIENT_SECRET=
MODERATOR_USER_IDS=                         # comma-separated user ids; see below
```

### ⚠️ `MODERATOR_USER_IDS` must be set before the mobile app ships

Reporting an avatar hides it **immediately**, pending review. Restoring it requires a
moderator, and moderators come only from this variable — so while it is unset, a
bad-faith report is a one-way door: the avatar is hidden and nothing in the product can
bring it back.

Unset denies everyone by design (a typo must mean "moderation unavailable", never "a
stranger can delete avatars"), and blank entries are dropped so a trailing comma cannot
admit an empty id. Find the id for an account with:

```
psql "$DATABASE_URL" -c 'select id, email from "user";'
```

The value is deliberately not recorded in this repo — it names a specific person's
account, and publishing it just tells an attacker which session to go after.

**Next.js has a second env file: `apps/web/.env.production`.** Next auto-loads it at
BOTH `next build` and `next start`. It MUST contain `API_ORIGIN` and the
`NEXT_PUBLIC_*` values because Next **bakes `rewrites()` targets and `NEXT_PUBLIC_*`
at build time** into `.next/routes-manifest.json` and the client bundle. Setting them
only in the systemd env is too late — the wrong values are already frozen in the build.

## Rebuild / redeploy

### ⚠️ A change to `deploy.sh` never applies to the deploy that installs it

> **Read this page from `main` on GitHub, not from the host.** The checked-out copy is by
> definition the *old* release's, so it cannot describe the release you are about to install.
> This document is subject to the same lag it documents.

`deploy.sh` deploys the repo it lives in: the operator invokes the *currently checked-out*
script, which then checks out the new tag and carries on to the end. There is no `exec` and no
re-invocation, so the release that ships a `deploy.sh` fix is deployed **by the previous
release's script**, flaw included. The fix takes effect from the *next* deploy onward.

This is **deliberately not fixed**, not unfixable — the script could `exec` its new self behind
a guard flag once the checkout succeeds. Compensating manually on the rare release that touches
`deploy.sh` is cheaper than an exec-resume in the one script whose failure means an outage.

(The running bash process is *not* corrupted by the checkout. `git checkout` unlinks and
recreates, so it keeps reading the original inode — verified on macOS/APFS and Linux/overlayfs:
a 236 KB script that checks out a 42-byte replacement of itself completes every phase.)

**⚠️ Do not try to "get ahead" by checking out the tag first.** `git checkout <tag> &&
./deploy/deploy.sh` makes preflight see `ROLLBACK_TAG == LATEST_TAG` and exit 0 with *"Already
on … — nothing to deploy"*, leaving the fleet running old code against new files. Always let
the script do its own checkout.

**In practice:** when a release changes `deploy.sh`, read its changelog entry and compensate
for that one deploy.

**Concretely, for v0.37.2** — which fixed the migrate and `--rebuild` phases to pass
`DATABASE_URL` explicitly to their children — the older script that installs it still runs the
bare invocation and dies in the MIGRATE phase, *after* the fleet has been stopped (the ERR trap
then rolls back and restarts on the old tag). Applies to **any first deploy from a tag older
than v0.37.2**, not only from v0.37.1:

```bash
cd /var/www/dayzonelife.com
DATABASE_URL=placeholder ./deploy/deploy.sh     # add --rebuild if the release needs it
```

**The value is deliberately irrelevant.** All that is needed is for the name to carry the
export attribute into the script; `read_database_url` then overwrites it with the real value
from `.env`, and the export survives the reassignment, so the children inherit the correct URL.
A one-shot prefix — rather than `export` — also leaves no production connection string sitting
in the operator's shell for a later ad-hoc `pnpm db:migrate` to pick up.

Needed **once**. From v0.37.2 onward a plain `./deploy/deploy.sh` is enough.

### Normal deploys

**Preferred: `deploy/deploy.sh`.** It automates the whole sequence below —
checks out the latest release tag, installs + builds web, stops the fleet, takes
a full-DB `pg_dump` checkpoint, migrates, restarts, and health-checks:

```bash
cd /var/www/dayzonelife.com
./deploy/deploy.sh            # deploy the latest semver tag
./deploy/deploy.sh --rebuild  # ALSO truncate + re-fold projections (schema-shape releases)
```

- Backups land in `$HOME` (override with `ONELIFE_BACKUP_DIR`) as
  `onelife-pre-<tag>-full.sql`; the script offers to prune stale ones at the end.
- It checks out a **tag** (detached HEAD). If a deploy fails **before** migrate it
  rolls the code back automatically; if it fails **after** a successful migrate it
  leaves the new code running and prints the checkpoint path (Postgres migrations
  are forward-only — restore is manual).
- Use `--rebuild` only for releases whose migrations change projection-table shape
  (e.g. v0.3.0's `0005`/`0006`). The player-notifications release is **not** one of them — it adds
  only new tables. If a plain deploy's `db:migrate` aborts on a
  projection-table constraint, that's the signal to re-run with `--rebuild`.
- **⚠️ The gamertag case-insensitivity release (`0024`) is one-way for a HAND rollback.** `0024`
  moved `players_gamertag_uniq` onto `lower(gamertag)`; the older release's `createPlayer` uses
  `ON CONFLICT (gamertag)`, which then matches no constraint and raises inside the fold
  transaction — the projector retries it forever and every projection stalls. `deploy.sh` will
  not do this to you (it refuses to auto-revert once the migrate phase has succeeded), so this
  only bites a manual `git checkout <older-tag>`; restore the pre-deploy dump instead, or
  recreate a `players_gamertag_uniq` on the bare column first. **Note this index no longer exists
  at all as of migration 0025** (gamertag is a current label, not an identity, and identity is
  `dayz_id`) — a rollback past 0025 needs to recreate the index from scratch, not merely repoint
  it, and a hand rollback to a pre-0025 release will re-admit duplicate-gamertag rows that 0025
  legitimately created.
- **⚠️ The fleet-turnover release (`0039`) replaces `servers_nitrado_service_id_uniq` with a partial
  unique index `WHERE active`.** Older releases do not use `ON CONFLICT` on `servers`, so a HAND
  rollback is safe **only BEFORE the fleet cutover (section B of "Fleet turnover") has run.**
  After it, a pre-0039 build ignores `ingest_from` (the new Chernarus row would backfill every
  Livonia ADM still on service 19366604), cannot recreate the old full unique index (two rows now
  share 19366604), and shows retired servers' open lives as alive. So after the cutover: stop
  `onelife-ingest` FIRST (`sudo systemctl stop onelife-ingest`), and prefer restoring the
  pre-deploy dump over a hand rollback. What 0039 changes going forward is that a second ACTIVE
  row on one Nitrado service is refused (a retired row may share its service id with the active
  one that replaced it). This release needs no `--rebuild`.

<details><summary>Manual equivalent (fallback)</summary>

```bash
cd /var/www/dayzonelife.com
git pull                        # (via the fork/PR workflow — see CLAUDE.md)
pnpm install --frozen-lockfile
# drizzle-kit reads DATABASE_URL and nothing else, and its bundled dotenv loads from
# packages/db/, not the repo root — so name the database explicitly or it errors out.
DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/')" \
  pnpm --filter @onelife/db run db:migrate   # if there are new migrations
pnpm build                                 # builds web (reads apps/web/.env.production)
sudo systemctl restart onelife-web onelife-api onelife-verifier \
     onelife-projector onelife-enforcer onelife-granter onelife-rebooter \
     onelife-notifier onelife-newsdesk
```
</details>

Verify the web build baked the right proxy target:
```bash
grep -oE 'http://[^"]+' apps/web/.next/routes-manifest.json | sort -u   # expect 127.0.0.1:3011
```

## Enabling ingest (Nitrado)

`ingest-worker` ingests every **active** server in the `servers` table, using the shared
`NITRADO_TOKEN`. Register servers as data (single tenant → no per-server token), with
`fleet-cutover --add`, never by hand-written SQL:

```bash
cd /var/www/dayzonelife.com
PNPM="$(command -v pnpm || echo /home/acab/.local/bin/pnpm)"
DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/')" \
  "$PNPM" --filter @onelife/projector run fleet-cutover -- \
  --add <slug>:<name>:<map-codename>:<nitrado-service-id>          # dry run: prints BEFORE/AFTER
# re-run with --apply to commit
```

`ON CONFLICT (nitrado_service_id)` no longer applies: migration 0039 made that index partial
(`WHERE active`), so an upsert keyed on the service id matches no constraint. Only one ACTIVE row
may hold a service id.

Then:
1. `sudo systemctl enable --now onelife-ingest`
2. `sudo journalctl -u onelife-ingest -f` — each tick logs `ingest sweep complete {servers,sightings}`.

Pausing a server without retiring it is still `UPDATE servers SET active=false WHERE id=…`; retiring
one (so its open lives read as "Alive when the server closed") is `fleet-cutover --retire`.

## Fleet turnover (2026-10-15)

Chernarus and Livonia are replaced by a new Chernarus (on Livonia's old Nitrado service) and
Nasdara. Sakhal was switched off on 2026-10-09 and is retired after the fact. Spec:
`docs/superpowers/specs/2026-10-09-badlands-fleet-turnover-design.md`. The release has ONE
migration (`0039`) and needs NO `--rebuild`; deploy it normally with `./deploy/deploy.sh`.

Production rows going in: id 1 `chernarus` (service 18196786), id 2 `sakhal` (service 19547068,
`active=false`), id 3 `livonia` (map `enoch`, service 19366604).

`fleet-cutover` flags: `--retire <slug>[=<new-slug>]` (renames the retiring row's slug so a
successor can take it), `--add <slug>:<name>:<map>:<nitrado-service-id>`,
`--retired-at <ISO>` (must carry `Z` or a `±hh:mm` offset; offset-less input is refused), and
`--apply`. Without `--apply` it prints BEFORE/AFTER tables and changes nothing. **`--retired-at`
applies to EVERY `--retire` in the invocation**, which is why the Sakhal step is its own run.

Every command below runs on the prod host in `/var/www/dayzonelife.com` and names `DATABASE_URL`
explicitly (the script never exports it):

```bash
cd /var/www/dayzonelife.com
PNPM="$(command -v pnpm || echo /home/acab/.local/bin/pnpm)"
DB="$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/')"
```

### A. After the deploy, before the 15th: retire Sakhal after the fact

Sakhal's history already shows in dossiers as soon as the deploy lands. What this step changes is
that Sakhal's still-open lives read as retired ("Alive when the server closed") instead of open.
Find the last thing Sakhal ingested; the query prints the exact `--retired-at` argument:

```bash
psql "$DB" -At -c "SELECT to_char(max(occurred_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') FROM events WHERE server_id = 2"
```

Run the cutover with that value, dry first, then with `--apply`:

```bash
DATABASE_URL="$DB" "$PNPM" --filter @onelife/projector run fleet-cutover -- \
  --retire sakhal --retired-at <value printed above>
DATABASE_URL="$DB" "$PNPM" --filter @onelife/projector run fleet-cutover -- \
  --retire sakhal --retired-at <same value> --apply
```

Run this FIRST and on its own; do not fold it into the 15th's invocation.

### B. On the 15th: the cutover

Nasdara's map codename and Nitrado service id are NOT known yet. Fill them in on the day: the
codename comes from the server's mission/config once the map exists, the service id from the
Nitrado panel. Do not guess either.

⚠️ **Nothing may restart the Livonia server between `--apply` and the map switch.** From
`--apply` on, the new Chernarus row is active on service 19366604 with `ingest_from` = the
cutover time, so a Livonia restart in that gap writes a fresh Livonia ADM that the new row
ingests as Chernarus. `onelife-rebooter` restarts every ACTIVE server at every even UTC hour
(00:00, 02:00, ...), and Nitrado runs its own scheduled restarts, hence the order below.

1. **Stop the rebooter and the newsdesk**, and do the whole of steps 1 to 6 clear of the minutes
   around an even UTC hour and of any Nitrado scheduled restart for 19366604. The newsdesk is
   paused so it cannot publish an old Chernarus obituary under the `chernarus` slug in the moment
   the rename commits:

   ```bash
   sudo systemctl stop onelife-rebooter onelife-newsdesk
   ```

2. **In the Nitrado panel, stop the Livonia server (service 19366604).**
3. **Dry run** (changes nothing; read the BEFORE/AFTER tables and the re-pointed obituary count):

   ```bash
   DATABASE_URL="$DB" "$PNPM" --filter @onelife/projector run fleet-cutover -- \
     --retire chernarus=chernarus-1.29 --retire livonia \
     --add chernarus:Chernarus:chernarusplus:19366604 \
     --add nasdara:Nasdara:<NASDARA-MAP-CODENAME>:<NASDARA-NITRADO-SERVICE-ID>
   ```

4. **Apply**: the same command with `--apply` appended. It is one transaction; any refusal rolls
   back everything. The rename also re-points the old Chernarus's obituaries to `chernarus-1.29`,
   so their "Final Reload" and life links keep pointing at the old server.
5. **Only then switch 19366604's map to Chernarus on Nitrado and start it.** Cutover first, map
   switch after, never before.
6. **Start the rebooter and the newsdesk again:**

   ```bash
   sudo systemctl start onelife-rebooter onelife-newsdesk
   ```

7. **Before players join, count what the new Chernarus row ingested.** Do this right after the
   server comes up, before the next even UTC hour. The server has started exactly once since the
   switch, so the new Chernarus row must hold **exactly one** file. Two or more means a restart
   happened between `--apply` and the switch, and the extra file is a Livonia log that would put
   Livonia play on the new Chernarus row:

   ```bash
   psql "$DB" -c "SELECT a.server_id, a.name, a.log_date FROM adm_files a JOIN servers s ON s.id = a.server_id WHERE s.slug = 'chernarus' AND s.active ORDER BY a.id"
   ```

   Zero rows only means the first sweep has not run yet; wait a minute and repeat. Do not judge
   the file by its `log_date`: that is the server's local clock, uncorrected, so it cannot be
   compared with the time you switched the map. Nasdara is a new service with no older logs, so
   it needs no such check.

   If there are two or more, stop `onelife-ingest` (`sudo systemctl stop onelife-ingest`) before
   anyone joins and sort it out; the abort path below stays open while no life exists on the new
   rows.
8. **Watch** `sudo journalctl -u onelife-ingest -f`. Ingest goes from 2 active servers (Chernarus,
   Livonia; Sakhal is already off) to 2 active servers (the new Chernarus and Nasdara), so expect
   `"servers":2` sweeps throughout, now covering the new rows. Then confirm new lives (spawns)
   land on the new rows. The query counts lives started in the last hour per server, so expect
   rows for the new Chernarus and Nasdara ids:

   ```bash
   psql "$DB" -c "SELECT server_id, count(*) FROM lives WHERE started_at > now() - interval '1 hour' GROUP BY 1"
   ```

9. **Post-cutover web check**, once the cutover has run: confirm a dotted slug serves in
   production on a real life page of the old Chernarus. (`/survivors/chernarus-1.29` 404s by
   design: retired servers drop off the boards.) The query prints the player slug the site uses
   (the gamertag lowercased, each run of non-alphanumerics turned into one `-`, leading and
   trailing `-` trimmed) and the life number:

   ```bash
   psql "$DB" -At -c "SELECT trim(both '-' from regexp_replace(lower(p.gamertag), '[^a-z0-9]+', '-', 'g')), l.life_number FROM lives l JOIN players p ON p.id = l.player_id WHERE l.server_id = 1 ORDER BY l.id DESC LIMIT 1"
   curl -sI https://dayzonelife.com/players/<player-slug>/chernarus-1.29/lives/<n>   # expect HTTP/2 200
   ```

   It cannot be checked before the rename.

#### Aborting after `--apply` (the map switch failed and you must revert)

Valid ONLY while no player has spawned on the new rows. If the map on 19366604 was already
switched, first stop that server on Nitrado and switch its map back to Livonia. Then stop ingest,
find the new rows' ids, and confirm they have no lives:

```bash
sudo systemctl stop onelife-ingest
psql "$DB" -c "SELECT id, slug, nitrado_service_id FROM servers WHERE slug IN ('chernarus', 'nasdara')"
psql "$DB" -c "SELECT server_id, count(*) FROM lives WHERE server_id IN (<NEW-CHERNARUS-ID>, <NASDARA-ID>) GROUP BY 1"
```

If the second query prints ANY row, do not use this path: restore the pre-cutover state from a
dump instead. If it prints none, revert in one transaction. It deletes the new rows (and any
ingest bookkeeping they gathered), hands `chernarus` back to row 1, re-points its obituaries back,
and un-retires rows 1 and 3 (Sakhal, row 2, stays retired):

```bash
psql "$DB" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
DELETE FROM events    WHERE server_id IN (<NEW-CHERNARUS-ID>, <NASDARA-ID>);
DELETE FROM raw_lines WHERE server_id IN (<NEW-CHERNARUS-ID>, <NASDARA-ID>);
DELETE FROM adm_files WHERE server_id IN (<NEW-CHERNARUS-ID>, <NASDARA-ID>);
DELETE FROM servers   WHERE id IN (<NEW-CHERNARUS-ID>, <NASDARA-ID>);
UPDATE servers  SET slug = 'chernarus' WHERE id = 1 AND slug = 'chernarus-1.29';
UPDATE articles SET map_slug = 'chernarus' WHERE server_id = 1;
UPDATE servers  SET active = true, retired_at = NULL WHERE id IN (1, 3);
COMMIT;
SQL
```

`ON_ERROR_STOP` makes psql quit at the first error, before `COMMIT`, so a failure changes
nothing. A foreign-key error from the `DELETE FROM servers` means the new rows already hold projected
play; the transaction rolls back whole and this path is closed. Otherwise start the Livonia
server (19366604, map Livonia) on Nitrado, then
`sudo systemctl start onelife-ingest onelife-rebooter onelife-newsdesk`.

## Enabling Discord login

1. https://discord.com/developers/applications → New Application.
2. OAuth2 → add redirect URI **exactly**:
   `https://dayzonelife.com/api/auth/callback/discord`
3. Copy Client ID + Client Secret into `.env` (`DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`).
4. `sudo systemctl restart onelife-api` (and `onelife-web` if you touched web env).
   Empty vars = provider disabled; you must set BOTH or the API refuses to boot.

Without Discord, login falls back to **magic-link with a console mailer** — the login
link is printed to `journalctl -u onelife-api`, not emailed. Configure SMTP later.

## Owner-only life map tiles (DayZ terrain mirror)

**This release needs no migration and no `--rebuild`** — the owner-only life map read
models query existing `positions`/`kills`/`lives` rows only; there is no new or
reshaped projection table. A plain `./deploy/deploy.sh` is the whole deploy.

The per-life map (owner-only, `/players/[slug]/[map]/lives/[n]`) renders a player's
trail over a self-hosted mirror of DayZ's own terrain tiles. This is **host
configuration, not a release artifact** — it is a one-time prerequisite (redone only
when a map's terrain changes upstream), never touched by `deploy/deploy.sh`. Tile
mirroring is independent of the release train: it may be run before or after any given
`deploy.sh`, in either order, and **skipping it degrades rather than blocks** — see
"Things to know before relying on this" below for exactly how it degrades.

**Prerequisite:** install [`dzmap-loader`](https://github.com/WoozyMasta/dzmap) on
the host and put it on `PATH` first. `deploy/mirror-tiles.sh` checks for it and
fails with a clear message rather than half-running if it's missing.

Mirror every map in the script's `MAPS` list (`chernarusplus`, `sakhal`, `enoch`/Livonia,
`nasdara`). `/var/www/tiles` is root-owned, so run it under `sudo`:

```bash
cd /var/www/dayzonelife.com
sudo ./deploy/mirror-tiles.sh -p 4    # first-time mirror (-p 4: dzmap-loader concurrency)
sudo ./deploy/mirror-tiles.sh -p 4    # re-mirror (after a DayZ terrain update) —
                                       # a bare re-run already fully re-downloads
                                       # and replaces the destination, so there is
                                       # no force flag needed here
```

This populates `/var/www/tiles/<map>/topographic/<z>/<x>/<y>.webp` (override the
root with `TILE_DIR`). The path matches DZMap's own layer name exactly — the
mirrored tree is DZMap's own output, unmodified — and must match what the web app
requests (`apps/web/src/components/life/track-map.tsx`); a divergence here 404s
every tile.

Add the nginx location block (alongside the existing `dayzonelife.com` vhost
server block):

```nginx
# Owner-only life map tiles. Static, immutable, and regenerated only by
# deploy/mirror-tiles.sh — never by a release.
location /tiles/ {
    alias /var/www/tiles/;
    add_header Cache-Control "public, max-age=31536000, immutable";
    access_log off;
    try_files $uri =404;
}
```

Then `sudo nginx -t && sudo systemctl reload nginx`.

Things to know before relying on this:

- **Tiles are NOT in git (hundreds of MB) and NOT in Postgres**, so they are
  **not captured by the `pg_dump` backup** in `deploy/deploy.sh`. They are fully
  reproducible by re-running `deploy/mirror-tiles.sh` — that's the trade being
  made: no backup coverage, in exchange for keeping hundreds of MB of static
  binary tiles out of every database checkpoint.
- **⚠️ A map is only replaced when its new pyramid is COMPLETE** (5461 tiles at the default
  zoom 0–6). static.xam.nu returns 403 for most tiles to non-browser clients, and
  `dzmap-loader` reads that 403 as "tile does not exist" and reports success. On 2026-10-15
  that silently turned the complete Chernarus and Livonia mirrors into 1144- and 537-tile ones
  under the script's old "non-empty is good enough" check. The script now re-fetches every
  missing tile with curl (browser User-Agent + xam.nu Referer, 4 at a time) and refuses to swap
  in anything short of a full pyramid, leaving the live tiles untouched and listing the map
  under `failed/empty`. If that happens, just re-run later. A 403 from xam.nu is not evidence
  a tile is missing: every tile at zoom 0–6 exists.
- **A missed or not-yet-run mirror is not a release blocker.** `track-map.tsx`
  sets `errorTileUrl` to a blank placeholder and the map container has a dark
  background, so an absent tile set degrades to a bare trail on a dark
  backdrop rather than a broken-tile checkerboard or a crash.
- **The tile-pyramid projection (`CANVAS_PX` in `track-map.tsx`) is a documented
  assumption, not yet verified against real tiles** — there was no mirrored tile
  set or production host available when it was written. **Before relying on the
  life map for real**, mirror at least one map, sign in as that life's owner,
  open its life-map page, and confirm a known in-game landmark lands where it
  should. If the trail renders uniformly offset or scaled, `CANVAS_PX` (and/or
  `MAX_ZOOM`) needs correcting for the mirrored pyramid — see the comment beside
  it in `track-map.tsx`. This step is still outstanding as of this writing.

### Verify the tile mirror after running `mirror-tiles.sh`

Don't guess a tile path — `mirror-tiles.sh` prints per-map tile counts and a final
success/failure summary, and exits non-zero if it mirrored zero maps. Find and curl a
tile that actually exists rather than assuming a fixed `z/x/y`:

```bash
TILE="$(find /var/www/tiles/chernarusplus -name '*.webp' | head -1)"
# => e.g. /var/www/tiles/chernarusplus/topographic/3/4/4.webp   (yours will differ)
curl -sI "https://dayzonelife.com/tiles/${TILE#/var/www/tiles/}" | head -1
# => expect: HTTP/2 200
```

## Login avatars

Migration `0029` creates the durable `avatars` table and drops the three retired
character-pipeline tables (`characters`, `character_sightings`, `rpt_files`) — it's a plain
`./deploy/deploy.sh`, **no `--rebuild`**. No new env vars, worker, or systemd unit; the API's own `pnpm install` is the only
extra step, because of the point below.

**⚠️ `sharp` (the avatar image-processing library) is a native dependency, not pure JS.** `pnpm
install` on the host must successfully fetch its linux-x64 prebuilt binary. If that fetch is
skipped or fails — offline install, `--ignore-scripts`, a platform mismatch — `pnpm install`
itself still reports success; the failure only shows up when the **api** unit tries to boot and
throws on `sharp`'s native module load. If the api unit is crash-looping right after a deploy that
touched `apps/api`'s dependencies, check `sudo journalctl -u onelife-api -n 50` for a sharp/native
module error before looking anywhere else.

Avatar bytes live in Postgres (`avatars.image`, a few hundred rows at ~10–30 KB each) — there is no
host filesystem component and nothing to add to `mirror-tiles.sh` or any other asset-sync step.
They ride the existing `pg_dump` backup for free, same as every other table.

## Deleting a player's account

There is **no code path** for this — it is entirely manual, driven by an email to
`admin@dayzonelife.com` (see `apps/web/src/content/legal/privacy.tsx` §10 "Deleting your
account"). No admin UI, no scheduled job.

Four foreign keys in `packages/db/src/schema.ts` have **no `onDelete`**, so a bare
`DELETE FROM "user"` fails outright. Given the account's `user.id` (`$UID`) and the email on the
account (`$EMAIL`), run these **in order**:

```sql
-- 1. verification_challenges.gamertag_link_id has no onDelete — clear it before gamertag_links.
DELETE FROM verification_challenges
WHERE gamertag_link_id IN (SELECT id FROM gamertag_links WHERE user_id = '$UID');

-- 2. gamertag_links.user_id has no onDelete.
DELETE FROM gamertag_links WHERE user_id = '$UID';

-- 3. referrals is a link between two real users; delete both directions. (referrals.user_id
--    cascades on user delete already; referrer_user_id does not, and blocks deleting anyone who
--    referred another player — this covers that side.)
DELETE FROM referrals WHERE user_id = '$UID' OR referrer_user_id = '$UID';

-- 4. token_transactions.counterparty_user_id has no onDelete, and those rows belong to ANOTHER
--    player's ledger — null the reference, do not delete the row.
UPDATE token_transactions SET counterparty_user_id = NULL WHERE counterparty_user_id = '$UID';

-- 5. The `verification` table (magic-link tokens) has NO user FK at all — it's keyed by
--    `identifier` (the email), so it must be cleared by email, not by user id.
DELETE FROM verification WHERE identifier = '$EMAIL';

-- 6. Now every remaining reference to this user cascades: session, account, avatars,
--    push_subscriptions, notifications, location_shares, and the user's own (non-counterparty)
--    token_transactions and referrals rows. (`friendships` and `user_preferences` were dropped
--    whole in v0.69 along with the friends feature — no longer part of this list.)
DELETE FROM "user" WHERE id = '$UID';
```

If a step is skipped or the order is wrong, step 6 fails on a foreign-key violation rather than
silently leaving orphaned rows — that's the point of doing it in this order.

**Not deleted by any of this, matching the privacy policy:** `lives`, `kills`, `positions` and the
rest of the append-only gameplay record; `articles` (obituaries); and `bans`, which are keyed to
the gamertag rather than the account and so are unaffected by an account deletion.

## TLS

Certbot-managed lineage `dayzonelife.com` (apex + www). `live/ → archive/` symlinks are
the normal certbot layout. Renewal profile: `/etc/letsencrypt/renewal/dayzonelife.com.conf`;
`certbot.timer` is active. Because DNS is behind Cloudflare, HTTP-01 renewal needs
`/.well-known/acme-challenge/` to pass through (Cloudflare allows this by default).
Sanity check: `sudo certbot renew --dry-run`.

## Release notes

### One-time operator step for the content-engine removal

**⚠️ Run this BEFORE `./deploy/deploy.sh`, not after.** The `onelife-newsdesk` systemd unit is not
checked into the repo, so `deploy.sh` cannot remove it — and v0.44.0 also dropped `newsdesk` from
the `SERVICES` array, so `stop_services` no longer stops it either. A newsdesk that is running when
the deploy lands **keeps running**: `git checkout` deletes its source, but the node process already
has its modules resident, so it ticks on with the old code. Every tick it publishes new articles
into `articles` and **posts a Discord link to `/obituaries/<slug>`, which the deploy just turned
into a 404** — measured cadence at the time of the removal was ~4 obituaries/day, i.e. a dead
public link roughly every six hours until someone notices.

On the host, once, before deploying:

    sudo systemctl disable --now onelife-newsdesk
    sudo rm /etc/systemd/system/onelife-newsdesk.service
    sudo systemctl daemon-reload

If the deploy has already gone out, run it now — the damage is bounded to the dead Discord links
already posted, which are ordinary messages and can be deleted from the channel by hand.

### One-time operator step for the obituaries revival (2026-07-28)

Obituaries alone are back (no birth notices, news, images or Discord — see the
`onelife-newsdesk` entry above and the "One Life MVP" section of `CLAUDE.md`). The systemd unit
was removed by hand in the step above and is not checked into the repo, so it must be
**recreated by hand**, mirroring every other worker unit, before the newsdesk process runs again:

1. Create + **enable but do not start** the `onelife-newsdesk` unit on the host
   (`sudo systemctl enable onelife-newsdesk`, no `--now`) — the `articles` table this release's
   migration recreates doesn't exist yet, so starting the unit before the deploy runs opens a
   crash-loop window.
2. Deploy normally (`./deploy/deploy.sh` — migration `0030` recreates a trimmed `articles` table,
   touches no projection table, so no `--rebuild`). **⚠️ This deploy runs the *previous* release's
   `deploy.sh`** (see the "A change to `deploy/deploy.sh` NEVER applies to the deploy that installs
   it" note in `CLAUDE.md`), which predates `onelife-newsdesk` and so neither checks for it nor
   restarts it — start it by hand this once, after the deploy completes:
   `sudo systemctl start onelife-newsdesk`.
3. Confirm a dry-run tick logs `DRY RUN: would generate obituary` lines.
4. Set `NEWSDESK_SINCE` to the go-live instant.
5. Set `NEWSDESK_DRY_RUN=false`.
6. Watch the first live tick and read the first published obituary before walking away.

## Rollback (re-expose the old Tribune)

The old stack is stopped+disabled, not deleted (`/opt/one-life-bot`).
```bash
sudo systemctl enable --now tribune-web.service one-life-bot.service   # bring old back
sudo sed -i 's|127.0.0.1:3010|127.0.0.1:3002|' /etc/nginx/sites-available/dayzonelife.com
sudo nginx -t && sudo systemctl reload nginx
```
Backups of the pre-cutover nginx vhost and `.env` are alongside the originals with
`.bak.<timestamp>` suffixes.
```
