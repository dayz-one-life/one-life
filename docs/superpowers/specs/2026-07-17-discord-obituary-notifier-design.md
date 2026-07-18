# Discord obituary notifier — design

**Date:** 2026-07-17
**Status:** Approved (design), pending implementation plan
**Scope:** Post a link to every obituary the newsdesk publishes into a Discord channel via a
webhook, on an ongoing basis, with guaranteed eventual delivery.

## Goal

Whenever the `apps/newsdesk` worker publishes an obituary, a link to that obituary
(`https://dayzonelife.com/obituaries/<slug>`) is posted to a Discord channel through an incoming
webhook. Discord unfurls the link into its own rich card using the obituary page's existing
OpenGraph tags (headline, dynamic OG image, description). Delivery is tracked and retried so no
obituary is silently dropped, and obituaries that already exist in the database at ship time are
also posted (the back-catalogue drains over the first ticks).

## Decisions (locked during brainstorming)

1. **Message format — plain link.** The post body is the obituary URL only. Discord generates the
   embed card from the page's OpenGraph metadata. No content duplication; the card can never drift
   from the page; least code.
2. **Delivery — tracked and retried.** A new `articles.discord_posted_at timestamptz` column records
   when each obituary was posted. A sweep posts any published obituary whose `discord_posted_at`
   is `NULL`, so transient Discord outages, worker restarts, and the dry-run→live switch never cause
   a permanent drop.
3. **Backfill — post the back-catalogue.** The migration adds the column with **no backfill
   `UPDATE`**, leaving existing published rows `NULL`. The sweep drains them oldest-death-first,
   throttled by a per-tick cap.

## Non-goals

- No custom Discord embed (title/description/fields). The plain link + Discord's OG unfurl is the
  whole message. (Revisitable later; explicitly out of scope now.)
- No new notification channels (Slack, email, etc.).
- No change to obituary generation, prompts, facts, or the web obituary pages.
- No editorial voice in the Discord message (no lead-in line). Body is the bare URL.

## Architecture

Generation and delivery stay separate concerns. `newsdeskTick` is unchanged — it finds qualified
dead lives, generates each obituary, and publishes it (writing an `articles` row with
`discord_posted_at = NULL`). A new **`notifyDiscord` sweep** runs immediately after the tick in the
same loop iteration and owns delivery: it reads unposted published obituaries from the table, posts
each link, and stamps `discord_posted_at`.

Reading delivery state from the table (rather than from the tick's return value) is what makes the
sweep idempotent, self-retrying, and able to drain the backlog — all from one code path. The
just-published obituary and a week-old un-posted one are handled identically.

```
main.ts loop  (every NEWSDESK_INTERVAL_SECONDS):
  ├─ newsdeskTick(db, …)     # unchanged: publish new obituaries (discord_posted_at = NULL)
  └─ notifyDiscord(db, …)    # NEW: post published-but-unposted obituaries, stamp them
       ↑ its own try/catch — a Discord outage never affects generation
```

`main.ts` wraps `notifyDiscord` in a try/catch sibling to the existing tick try/catch, so a Discord
failure is logged and the loop continues.

## Components

Each unit is small, single-purpose, and independently testable.

### `apps/newsdesk/src/discord.ts`
Generic Discord webhook client.

```
postToDiscordWebhook(webhookUrl: string, content: string, deps: { fetch: typeof fetch })
  : Promise<DiscordPostResult>
```

- POSTs `{ content }` as JSON to `webhookUrl`.
- Interprets the response:
  - `204 No Content` → `{ ok: true }` (Discord's success for webhook posts).
  - `429` → `{ ok: false, rateLimited: true, retryAfterSeconds }` (parsed from the JSON body's
    `retry_after`, seconds).
  - other non-2xx / network throw → `{ ok: false, rateLimited: false, error }`.
- `fetch` is injected for testing. No global state.

### `apps/newsdesk/src/obituary-url.ts`
Pure URL builder.

```
obituaryUrl(siteUrl: string, slug: string): string   // `${siteUrl}/obituaries/${slug}`
```

- `siteUrl` has any trailing slash stripped (mirrors `apps/web/src/lib/seo.ts` `SITE_URL`).

### `apps/newsdesk/src/pg-store.ts` (extend)
Two new functions beside the existing store code.

```
findUnpostedObituaries(db, { limit }): Promise<UnpostedObituary[]>
  // articles WHERE kind='obituary' AND status='published'
  //   AND slug IS NOT NULL AND discord_posted_at IS NULL
  //   ORDER BY death_at ASC   LIMIT :limit
  // returns { id, slug, headline, gamertag }  (headline/gamertag for log context only)

markObituaryPosted(db, id: number, now: Date): Promise<void>
  // UPDATE articles SET discord_posted_at = :now WHERE id = :id
```

- Ordering is **oldest death first** so a backlog replays in chronological order. In steady state
  there is roughly one new obituary per tick, so it still posts promptly. (Flip to `DESC` if newest
  should always jump the queue — noted as an easy change.)
- `publishObituary`'s upsert is **not** modified: it never writes `discord_posted_at`, so an existing
  stamp is always preserved, and published lives are already excluded from `findObituaryTargets`.
  Together these guarantee each obituary is stamped once and can never double-post.

### `apps/newsdesk/src/notify.ts`
The sweep. Orchestrates store + discord + url.

```
notifyDiscord(db, deps: {
  webhookUrl: string;      // "" ⇒ feature disabled
  siteUrl: string;
  maxPerTick: number;
  dryRun: boolean;
  fetch: typeof fetch;
  now: Date;
  log;
}): Promise<{ posted: number; failed: number; disabled: boolean }>
```

Logic:
1. If `webhookUrl` is empty → return `{ posted: 0, failed: 0, disabled: true }` (no-op).
2. `rows = findUnpostedObituaries(db, { limit: maxPerTick })`.
3. For each row (sequential):
   - `url = obituaryUrl(siteUrl, row.slug)`.
   - If `dryRun` → `log.info("DRY RUN: would post <url>")`, **do not** post or stamp, continue.
   - `res = postToDiscordWebhook(webhookUrl, url, { fetch })`.
     - `ok` → `markObituaryPosted(db, row.id, now)`, `posted++`.
     - `rateLimited` → `log.warn({ retryAfterSeconds })`, **break** (stop posting this tick; remaining
       rows retry next tick). Do not stamp.
     - error → `log.warn`, `failed++`, do not stamp, continue to next row.
4. Return counts.

## Data flow (one obituary)

```
publishObituary → articles row: status=published, slug set, discord_posted_at=NULL
      ↓ (same tick, or a later one)
findUnpostedObituaries → { id, slug } (published, slugged, NULL, oldest death first, ≤ cap)
      ↓ per row
obituaryUrl(siteUrl, slug) → postToDiscordWebhook(url)
      ↓ ok                                   ↓ failure / 429
markObituaryPosted(id, now)                  leave NULL → retried next tick
```

## Configuration & secret handling

Three new env vars in `apps/newsdesk/src/config.ts` (zod), all with safe defaults:

| Env var | Default | Meaning |
|---|---|---|
| `DISCORD_OBITUARY_WEBHOOK_URL` | `""` | Enable gate. Empty ⇒ the sweep is a no-op. Named distinctly from the existing `DISCORD_CLIENT_ID`/`DISCORD_CLIENT_SECRET` (which are for Discord **login**, a different feature). |
| `SITE_URL` | `https://dayzonelife.com` | Base URL for absolute obituary links. Mirrors the web app's `SITE_URL` convention. |
| `NEWSDESK_DISCORD_MAX_PER_TICK` | `10` | Per-tick post cap. Throttles the backlog drain; keeps posting well under Discord's ~30-request/60-second webhook limit. |

`Config` type and `loadConfig` gain the three mapped fields (`discordWebhookUrl`, `siteUrl`,
`discordMaxPerTick`).

**The webhook URL is a secret.** It is stored only in the host's gitignored `.env`. `.env.example`
and `deploy/README.md` get a blank placeholder and documentation. The real value is never committed.

## Error handling & rate limits

- Discord unreachable / 5xx / network error → `log.warn`, row stays `NULL`, retried next tick.
- `429` → log `retry_after` and stop posting for this tick (the worker is **not** slept); remaining
  rows retry next tick. With a cap of 10 and a 5-minute interval this is essentially unreachable
  outside a large first-deploy backlog drain.
- Dry-run (`NEWSDESK_DRY_RUN` still `true`, the default) → the sweep logs `DRY RUN: would post <url>`
  and neither posts nor stamps, so flipping to live later posts them for real. Consistent with how
  dry-run already gates generation.
- A thrown error anywhere in the sweep is caught in `main.ts` and logged; the loop continues.

## Migration `0009` + schema

```sql
ALTER TABLE articles ADD COLUMN discord_posted_at timestamptz;
CREATE INDEX articles_discord_unposted_idx ON articles (death_at)
  WHERE status = 'published' AND discord_posted_at IS NULL;
```

- No backfill `UPDATE` (the "post the backlog" decision).
- The partial index keeps the sweep's lookup cheap as `articles` grows (it targets exactly the
  rows the sweep scans).
- `packages/db/src/schema.ts` gains
  `discordPostedAt: timestamp("discord_posted_at", { withTimezone: true })` and the
  `articles_discord_unposted_idx` partial index in the table's index block.
- This is a **new nullable column, no table reshape** → a normal `migrate` on deploy, **not** a
  `--rebuild`.

## Testing

- `test/discord.test.ts` — injected `fetch`: asserts POST method, target URL, JSON `{ content }`
  body, and correct mapping of `204` / `4xx` / `429` (with `retry_after`) responses.
- `test/obituary-url.test.ts` — pure: trailing-slash stripping, slug composition.
- `test/notify.test.ts` — fake store + fake discord client + fake log:
  - disabled (returns early) when `webhookUrl` is empty;
  - dry-run logs but does not post or stamp;
  - success posts and stamps;
  - failure leaves the row un-stamped (`failed` counted);
  - respects `maxPerTick`;
  - stops posting on `429`.
- `test/pg-store.test.ts` (extend) — Postgres harness: `findUnpostedObituaries` selects only
  published + slugged + `NULL` rows, ordered by `death_at`, capped by `limit`; `markObituaryPosted`
  stamps the row; a stamped row is not re-selected.

## Deploy & docs

- `.env.example`: add `DISCORD_OBITUARY_WEBHOOK_URL=`, `SITE_URL=https://dayzonelife.com`,
  `NEWSDESK_DISCORD_MAX_PER_TICK=10` (blank webhook placeholder — no real secret).
- `deploy/README.md`: note the webhook + site URL under the `onelife-newsdesk` service description.
- Deploy is a normal release: build → backup → **migrate** (picks up `0009`) → restart fleet (the
  newsdesk unit is already in the fleet). No `--rebuild`. The operator adds the real webhook URL to
  the host `.env` before the newsdesk restart.

## Workflow

Solo-maintainer mode. Work happens on `feature/discord-obituary-notifier` → PR into `develop`.
`CHANGELOG.md` updated on the PR; `CLAUDE.md` updated last (the newsdesk-app description and the
`articles`-table note gain the `discord_posted_at` column + notifier sweep).
