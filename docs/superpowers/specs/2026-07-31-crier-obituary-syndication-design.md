# Crier — obituary syndication to Discord and Facebook — design

**Date:** 2026-07-31
**Status:** approved (approach and design confirmed by Steve)

## Problem

Published obituaries live only on the site. Steve wants every obituary posted to a Discord
channel (via webhook) and to a Facebook Page, automatically. The new OG card (v0.70.0) means a
bare obituary link already unfurls with the death card on both platforms; the post adds the
headline and lede as text.

## Decision

A new worker app, **`apps/crier`**, in the mold of `notifier`/`newsdesk`: an interval tick loop
over the shared Postgres, a durable per-channel delivery ledger, dry-run by default, forward-only
cutoff. Syndication is decoupled from newsdesk's generation loop — an external-platform outage
never entangles obituary publishing, and channels degrade independently of each other.

## App shape

```
apps/crier/src/
  config.ts            env parsing (see Environment)
  main.ts              pino logger + pg pool + setInterval loop, same skeleton as notifier
  tick.ts              one cycle, all deps injected (store, channels, now, log) — unit-testable
  pg-store.ts          target query + syndication upserts
  channels/discord.ts  buildDiscordPayload(post) + postToDiscord(fetch, url, post)
  channels/facebook.ts buildFacebookParams(post) + postToFacebook(fetch, pageId, token, post)
```

`post` is `{ headline, lede, url }`. Message body on both channels:

```
{headline}

{lede}

{url}
```

- **Discord**: `POST {webhookUrl}` JSON `{ content }`. Success = 2xx (webhooks return 204).
- **Facebook**: `POST https://graph.facebook.com/v21.0/{pageId}/feed`, form-encoded
  `message={headline\n\nlede}`, `link={url}`, `access_token={token}`. Success = 2xx with a JSON
  `id`. The `link` param drives FB's unfurl of the OG card.
- The obituary URL is built from `SITE_URL` config (the `obituaryUrl()` pattern in
  `apps/newsdesk/src/obituary-url.ts` — copy the helper, or lift it if trivially shareable).
  Never request-derived (v0.69.1 rule).

## State: the `syndications` table

Migration in `packages/db`:

```sql
CREATE TABLE syndications (
  id          bigserial PRIMARY KEY,
  slug        text NOT NULL,           -- obituary slug (the article's public identity)
  channel     text NOT NULL,           -- 'discord' | 'facebook'
  posted_at   timestamptz,             -- NULL until a successful post
  attempts    integer NOT NULL DEFAULT 0,
  last_error  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slug, channel)
);
```

**Durable, not a projection.** It records real external side effects; it must survive
`--rebuild` (never listed in `REBUILD_TRUNCATE_TABLES`) — a rebuild must not repost history.
⚠️ Journal-`when` trap applies to the new migration: its `when` must exceed entry 0032's
fabricated future timestamp or drizzle-kit silently applies nothing; verify the table exists
after migrating.

## Tick semantics

1. `since === null` → return `{ skipped: all }` immediately. Unset means OFF — no epoch default
   that would blast all history into a fresh channel.
2. Enabled channels = those whose env creds are present. No channels enabled → no-op tick.
3. Targets: published obituaries with `death_at > since`, joined against `syndications`, where
   any enabled channel lacks a `posted_at` row and has `attempts < maxAttempts` (default 5),
   oldest death first, capped at `batchCap` (default 10) per tick.
4. For each target × missing channel: in dry-run, log the exact payload and continue — zero
   external calls, zero writes. Otherwise post, then upsert the row: success sets `posted_at`;
   failure increments `attempts` and records `last_error`. A Discord failure never affects the
   Facebook attempt for the same article, and vice versa (independent try/catch per channel —
   the shared-try/catch bug class from the house rules).
5. 2-second pause between consecutive external posts (rate courtesy; also paces any deliberate
   backfill when Steve points `CRIER_SINCE` backwards).

Rows at the attempt cap stay visible in the table as the poison record; no automatic revival
(manual `UPDATE` resets `attempts` if a token gets fixed — documented in the README).

## Environment

| Var | Meaning |
| --- | --- |
| `CRIER_DRY_RUN` | default **on**; anything except explicit `false` stays dry |
| `CRIER_SINCE` | ISO instant; unset = worker does nothing (forward-only cutoff; set to enablement time to skip history) |
| `CRIER_DISCORD_WEBHOOK_URL` | presence enables the Discord channel |
| `CRIER_FB_PAGE_ID` + `CRIER_FB_PAGE_ACCESS_TOKEN` | presence of both enables the Facebook channel |
| `CRIER_INTERVAL_SECONDS` | tick interval in seconds, default 60 |
| `CRIER_BATCH_CAP` | posts per tick, default 10 |
| `DATABASE_URL` | as every worker |
| `SITE_URL` | absolute link base, default `https://dayzonelife.com` |

## Ops

- Register `crier` in the deploy fleet exactly as `notifier` is registered (service list in
  `deploy/`; see `deploy/README.md`). It ships OFF everywhere until `CRIER_SINCE` is set.
- New `docs/crier-facebook-setup.md`: create the Meta developer app, add `pages_manage_posts` +
  `pages_read_engagement`, exchange for a long-lived Page Access Token, find the Page ID, set
  the two env vars. (Steve has the Page; app + token still to be minted.)
- Discord setup is one line: channel settings → Integrations → Webhooks → copy URL.

## Testing

- `tick.ts`: injected fake store + fake fetch. Cases: SINCE unset → nothing; dry-run → zero
  fetch calls and zero writes; both channels posted and recorded; Discord failure still posts
  Facebook and records both outcomes; attempt-capped rows excluded; batch cap respected.
- `pg-store.ts`: DB suite under `TEST_DATABASE_URL` — target query excludes posted/capped rows
  per channel; upsert transitions (fresh row → failure increments → success stamps `posted_at`).
- Channel builders: pure-function tests pinning the exact Discord JSON and the exact FB
  form-encoding (incl. newlines and URL escaping).
- ⚠️ Any new env var a suite reads must be added to `turbo.json`'s `test.env` list.
- Real posting is verified post-deploy with dry-run logs first, then a live test post into a
  private Discord channel / unpublished FB page visibility if desired.

## Out of scope

- Non-obituary prose, post editing/deletion, Instagram/X, per-map channel routing (the
  `channel` column leaves room), retry backoff sophistication beyond the attempt cap.
