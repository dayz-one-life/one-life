# Login avatars — design

**Date:** 2026-07-27
**Status:** Approved (approach A — Postgres-stored, API-served, mirrored at write time)

## 1. What and why

The RPT character mapping is not accurate enough to keep showing: personas are inherited
across charID reuse and the roster resolution mis-attributes often enough that the portraits
on the survivor board and life timeline are confidently wrong. It goes — the whole pipeline,
not just the display.

In its place: **player avatars sourced from the login method** (Discord / Google / GitHub all
populate Better Auth's `user.image` at sign-in), stored and served by us, with an update
mechanism on `/you` (refresh from provider, upload a custom image, remove). Verified players'
avatars appear publicly **by default** (their deliberate decision to verify a public gamertag
already links their account to it; the avatar is removable). Players with no site account —
most rows on any board — render the existing silhouette, exactly as an unknown character does
today.

## 2. Demolition — the character pipeline

Deleted outright:

- **Tables:** `characters`, `character_sightings` (migration `0029` drops both; they also
  leave `REBUILD_TRUNCATE_TABLES` in the same release — safe with the rebuild-before-migrate
  order, because the tables still exist at rebuild time and the new list simply no longer
  names them).
- **Ingest:** the ingest-worker's RPT pass and the `@onelife/rpt-parser` package. RPT
  polling existed solely to feed character sightings; removing it also halves Nitrado log
  traffic per sweep.
- **Read models / domain:** `getLifeCharacter` (`packages/read-models/src/character.ts`),
  the `character` field on the life-detail/timeline payloads, `rosterByClass` and the
  31-persona dictionary (`packages/domain/src/characters.ts`).
- **Web:** the roster-path half of `CharacterImage` (`characterSrc`), the
  `/characters/*.webp` assets (31 files, plus the Fandom-wiki attribution obligation they
  carried), and every `character` prop threading through survivor rows, `LifeHero`,
  `PlayerAvatar`.

The **silhouette fallback survives** — it becomes the base state of the new `Avatar`
component rather than a fallback from a failed roster lookup.

Not touched: `kills`, `lives`, positions, priors — nothing else read the character tables.

## 3. Data model

One new **durable** table (absent from `REBUILD_TRUNCATE_TABLES`, present in `APP_TABLES`):

```
avatars
  user_id     text PK references "user"(id) on delete cascade
  image       bytea        -- 256×256 webp, NULL on a removal tombstone
  hash        text         -- 16 hex chars of sha256(image), NULL on a tombstone
  source      text         -- 'provider' | 'upload', NULL on a tombstone
  updated_at  timestamptz not null
```

- **Row states:** no row = never touched (auto-populate allowed). Row with image = live
  avatar. Row with NULL image = **explicit removal tombstone** — auto-populate must never
  resurrect it; only an explicit re-sync or upload can.
- A partial index on `hash` (`WHERE hash IS NOT NULL`) serves the public lookup.
- Deliberately a separate table, not a column on `user` — that table belongs to Better Auth
  (same reasoning as `user_preferences`, `packages/db/src/schema.ts`).
- Size reality: ~10–30 KB per image × a few hundred users. It rides the existing `pg_dump`
  backup for free; no host filesystem, no nginx change.

## 4. Image pipeline (one path for both sources)

All images — uploaded or mirrored from a provider — pass through the same processing in the
API before touching the table:

1. Byte cap: reject over **5 MB** pre-processing.
2. Decode with `sharp`; reject anything it cannot parse as an image. Accept the formats
   sharp decodes by default (jpeg/png/webp/gif/avif); SVG is **rejected** (scripting
   surface, and sharp only rasterises it with extra libs anyway).
3. `resize(256, 256, { fit: "cover" })` → center-crop, then encode webp (`quality: 80`).
   Output is always a 256×256 webp regardless of input; EXIF and metadata are dropped by
   re-encoding.
4. `hash = sha256(bytes).slice(0, 16)`; upsert the row.

Provider mirroring adds: fetch `user.image` over **https only**, follow at most 3 redirects,
5 s timeout, same 5 MB cap streamed. **`user.image` is user-writable** (Better Auth's
default `/update-user` endpoint accepts it, and that field has no cheap per-field disable —
see the auth-config note below), so the fetch is restricted in production to an **https host
allowlist** matching the three configured providers' avatar CDNs (`cdn.discordapp.com`, any
host ending `.googleusercontent.com`, `avatars.githubusercontent.com`), re-checked on every
redirect hop so a compliant host cannot redirect to an internal target. **Public pages never
hotlink a provider CDN**: no visitor-IP leakage to Discord/Google, and Discord's rotating CDN
URLs can't rot our pages.

`sharp` is a new API dependency (prebuilt native binaries via pnpm; note for the deploy
runbook that the host install must succeed — it's linux-x64-glibc, which sharp ships).

## 5. Routes

Four `/me` routes (session-gated; **no subject parameter anywhere** — the only avatar a
caller can write is their own, same shape as every other `/me` surface):

- `GET /me/avatar` — the session user's current hash (or null on no row / a tombstone).
- `POST /me/avatar` — multipart upload (`@fastify/multipart`, 5 MB limit) → pipeline →
  upsert (`source: 'upload'`). Returns the new hash.
- `POST /me/avatar/sync` — re-fetch the session user's current `user.image` → pipeline →
  upsert (`source: 'provider'`). 409 `no_provider_image` when `user.image` is null
  (magic-link users).
- `DELETE /me/avatar` — write the tombstone (NULL image/hash/source). Always 200; deleting
  what isn't there is a no-op.

One public route:

- `GET /avatars/:hash.webp` — bytes by hash, `content-type: image/webp`,
  `cache-control: public, max-age=31536000, immutable` (the hash changes when the image
  does, so immutable is honest). 404 on no match. The hash is content-derived and appears
  in public payloads anyway; there is nothing to enumerate — a miss discloses nothing.

## 6. Auto-populate

After an OAuth sign-in, a Better Auth **session-create after-hook** fires and — only when
`user.image` is set, no `avatars` row exists (tombstones count as existing), and the fetch
is fire-and-forget off the login path — mirrors the provider image through the pipeline. A
login must never block or fail on avatar work.

Result: a verified player who has ever signed in with a social provider gets a public
avatar with zero action; a magic-link user stays a silhouette until they upload.

## 7. Public read path

Read-models attach `avatarHash: string | null` by joining verified `gamertag_links` (on
`lower(gamertag)`, the package convention) → `avatars` (live rows only — `image IS NOT
NULL`):

- `getAliveSurvivors` — hero + podium rows (compact rows show no portrait; unchanged).
- `getLifeTimeline` — the life hero shows the player's avatar instead of a persona.

The dossier is deliberately untouched: its hero has been avatar-free since the v0.11.0
redesign, and this feature does not reintroduce a portrait there.

The web builds the URL with one helper (`avatarSrc(hash)` → `/api/avatars/<hash>.webp`) and
renders through one **`Avatar`** component: image when a hash is present, the existing
silhouette otherwise. Loading is not an authoritative silhouette-with-meaning — the
silhouette IS the resolved empty state, so no special loading treatment is needed beyond
the browser's own image loading.

`/you` gains an avatar panel: current avatar (or silhouette), **Upload**, **Refresh from
login provider**, **Remove**. Announcements on settlement, never at click time (SR-structure
policy). The masthead account disc uses the avatar when present.

## 8. Failure honesty

- A failed `POST /me/avatar/sync` (provider URL rotted, timeout) leaves the existing row
  untouched and reports the error — never silently degrades to a tombstone.
- The public route serves stale-but-cached happily (immutable); a changed avatar changes
  URL, so staleness self-resolves at the next payload refresh.
- Read-model join failure modes: an unverified or renamed-away gamertag simply yields
  `avatarHash: null` → silhouette. No error state needed on public surfaces.

## 9. Deploy

- Migration `0029`: create `avatars`, drop `characters` + `character_sightings` +
  `rpt_files`. Touches one durable table and drops three projection tables — plain
  `./deploy/deploy.sh`, **no `--rebuild`** (nothing needs re-folding; the event log never
  carried character data).
- `@onelife/rpt-parser` removal deletes a workspace package; `pnpm install` on deploy
  handles it.
- No new env vars, no new worker, no systemd change. The ingest-worker simply stops
  making RPT requests.
- Rollback note: the migration is destructive of character data (drop tables). The data
  was wrong — that is the point — but a re-run of the old RPT backfill is not possible
  after old RPT logs rotate off Nitrado. Accepted.

## 10. Testing

- **Pipeline:** unit tests over the processing function — oversized reject, non-image
  reject, SVG reject, EXIF-stripped 256×256 webp out, stable hash.
- **Routes:** upload/sync/delete happy paths; tombstone semantics (sync after remove
  works, auto-populate after remove does not — mutation-tested); `no_provider_image`;
  public route cache headers and 404.
- **Read-models:** avatarHash present for a verified live-avatar player, null for
  unverified / tombstoned / renamed-away; join is on `lower(gamertag)`.
- **Web:** `Avatar` renders image vs silhouette; `/you` panel announces on settlement;
  the update flow invalidates the right queries.
- **Removal:** the suite compiles and passes with the character pipeline gone (the real
  test of a clean demolition); grep-gate that `/characters/` and `rosterByClass` have no
  remaining references.
