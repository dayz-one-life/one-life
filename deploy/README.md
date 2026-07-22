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
| Workers | no ports | verifier, projector, enforcer, granter, rebooter, newsdesk, notifier (+ ingest, disabled) |
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
for s in web api verifier projector enforcer granter rebooter newsdesk notifier ingest; do
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
- **onelife-newsdesk** — sweeps qualified deaths lacking a published obituary, generates each in
  the One Life voice via OpenRouter, and publishes it. Requires a `onelife-newsdesk` systemd unit
  on the host (create it alongside the other worker units). Needs `DATABASE_URL`,
  `OPENROUTER_API_KEY`, and `NEWSDESK_MODEL` (default `anthropic/claude-sonnet-5`) in `.env`.
  **`NEWSDESK_DRY_RUN` defaults `true`** — obituaries and birth notices are logged, not generated or
  stored (no OpenRouter credits spent); set `false` to actually generate and write them.
  The worker also runs a **birth-notice (Fresh Spawns) pass**, gated by `NEWSDESK_BIRTH_SINCE` — an
  ISO-8601 go-live instant. Unset / empty / invalid ⇒ that pass is **off**; set it once to begin
  **forward-only** birth-notice coverage from that instant (still subject to `NEWSDESK_DRY_RUN`).
  To also post each published obituary into Discord, set `DISCORD_OBITUARY_WEBHOOK_URL` (an
  incoming-webhook URL — a **secret**; keep it only in the host `.env`, never commit it) plus
  `SITE_URL` (default `https://dayzonelife.com`, used to build the absolute obituary link) and
  optionally `NEWSDESK_DISCORD_MAX_PER_TICK` (default `10`, the per-sweep post cap that drains the
  back-catalogue on first live run). Empty webhook ⇒ the Discord notifier sweep is a no-op (this is
  the newsdesk's Discord pass, unrelated to the `onelife-notifier` worker below); it respects
  `NEWSDESK_DRY_RUN`. Delivery is tracked in `articles.discord_posted_at`, so obituaries published
  while the webhook was unset are posted once it is set. Ships in migration `0011` — a normal
  `./deploy/deploy.sh` (migrate) picks it up, no `--rebuild`.
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
```

**Next.js has a second env file: `apps/web/.env.production`.** Next auto-loads it at
BOTH `next build` and `next start`. It MUST contain `API_ORIGIN` and the
`NEXT_PUBLIC_*` values because Next **bakes `rewrites()` targets and `NEXT_PUBLIC_*`
at build time** into `.next/routes-manifest.json` and the client bundle. Setting them
only in the systemd env is too late — the wrong values are already frozen in the build.

## Rebuild / redeploy

### ⚠️ A change to `deploy.sh` never applies to the deploy that installs it

> **Read this page from `develop` on GitHub, not from the host.** The checked-out copy is by
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
     onelife-projector onelife-enforcer onelife-granter onelife-rebooter onelife-newsdesk \
     onelife-notifier
```
</details>

Verify the web build baked the right proxy target:
```bash
grep -oE 'http://[^"]+' apps/web/.next/routes-manifest.json | sort -u   # expect 127.0.0.1:3011
```

## Enabling ingest (Nitrado)

`ingest-worker` ingests every **active** server in the `servers` table, using the shared
`NITRADO_TOKEN`. Register servers as data (single tenant → no per-server token):

```sql
-- one row per Nitrado game server you want ingested
INSERT INTO servers (nitrado_service_id, name, active)
VALUES (18196786, 'main', true)
ON CONFLICT (nitrado_service_id) DO UPDATE SET active = true;
-- pause a server without deleting its data:  UPDATE servers SET active=false WHERE nitrado_service_id=…;
```

Then:
1. `sudo systemctl enable --now onelife-ingest`
2. `sudo journalctl -u onelife-ingest -f` — each tick logs `ingest sweep complete {servers,sightings}`.

Adding/removing a server later is a pure data change (`active` flag) — no redeploy, no restart.

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

Mirror all three maps (`chernarusplus`, `sakhal`, `enoch`/Livonia):

```bash
cd /var/www/dayzonelife.com
./deploy/mirror-tiles.sh              # first-time mirror
./deploy/mirror-tiles.sh              # re-mirror (after a DayZ terrain update) —
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

## TLS

Certbot-managed lineage `dayzonelife.com` (apex + www). `live/ → archive/` symlinks are
the normal certbot layout. Renewal profile: `/etc/letsencrypt/renewal/dayzonelife.com.conf`;
`certbot.timer` is active. Because DNS is behind Cloudflare, HTTP-01 renewal needs
`/.well-known/acme-challenge/` to pass through (Cloudflare allows this by default).
Sanity check: `sudo certbot renew --dry-run`.

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
