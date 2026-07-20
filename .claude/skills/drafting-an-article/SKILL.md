---
name: drafting-an-article
description: Use to run an editorial newsroom session — scout for stories, explore the live data, and write an institutional piece (an Almanac, a Ledger entry, a dispatch) through the newsroom CLI. Triggers on "draft an article", "write an Almanac", "write a Ledger", "newsroom session".
---

# Drafting an Article

The editorial desk's session ritual. Everything factual comes from read-only queries; every
write goes through `pnpm --filter @onelife/newsdesk run newsroom <cmd>` — **the only write
path** for editorial rows. No LLM API calls anywhere; you are the writer.

Sessions run on the production host against the live database (exploration read-only).
Set `DATABASE_URL` (and `NEWS_PREVIEW_TOKEN` + `SITE_URL` for preview links) before starting.

## The ritual, in order

### 1. Scout

```
pnpm --filter @onelife/newsdesk run newsroom scout
```

Prints the shipped Standing Dead + Long Form trigger finders as *story tips* (suppression and
the already-covered anti-join both apply), plus a per-map aggregate digest.

### 2. Explore freely

Query the live data read-only. The founding session's cookbook:

```sql
-- Ledger ⋈ bans: who paid their way out, and when
SELECT b.gamertag, b.server_id, b.banned_at, b.lifted_at, tt.delta, tt.reason, tt.created_at
FROM bans b JOIN token_transactions tt
  ON tt.reason = 'unban_redeem' AND tt.created_at BETWEEN b.banned_at AND COALESCE(b.lifted_at, now())
ORDER BY tt.created_at DESC;

-- Idle-alive: open qualified lives by silence, longest first
SELECT p.gamertag, s.map, l.playtime_seconds / 60 AS minutes,
  now() - MAX(COALESCE(se.disconnected_at, se.connected_at)) AS silent_for
FROM lives l JOIN players p ON p.id = l.player_id JOIN servers s ON s.id = l.server_id
LEFT JOIN sessions se ON se.life_id = l.id
WHERE l.ended_at IS NULL GROUP BY p.gamertag, s.map, l.playtime_seconds ORDER BY silent_for DESC;

-- Per-map medians (non-suicide lives)
SELECT s.map, COUNT(DISTINCT l.player_id) AS players,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY l.playtime_seconds) / 60.0 AS median_minutes
FROM lives l JOIN servers s ON s.id = l.server_id
WHERE l.ended_at IS NOT NULL AND COALESCE(l.death_cause,'') <> 'suicide' GROUP BY s.map;

-- Retention: how many players ever came back for a second life
SELECT COUNT(*) FILTER (WHERE n > 1)::float / COUNT(*) AS returned_pct
FROM (SELECT player_id, COUNT(*) AS n FROM lives GROUP BY player_id) t;

-- Hour-of-day: when the servers actually live
SELECT EXTRACT(hour FROM connected_at) AS utc_hour, COUNT(*) FROM sessions GROUP BY 1 ORDER BY 1;
```

**Two standing rails, always:**

- **Check whether one player is moving your aggregate.** The Livonia 1.0-minute-median lesson:
  a small map's median was one prolific respawner. Re-run the query excluding the top player
  before printing any per-map claim.
- **State n when it is small.** "45 souls against 70" is honest; "39% more durable" over nine
  lives is not.

### 3. Consent pass

- Read `NEWSDESK_NEWS_SUPPRESSED_GAMERTAGS` — a suppressed player never appears, even in
  aggregates you name people from.
- **Living subjects** get the Standing Dead rails: no implied death, no fix, no route, no
  recognisable locale — the Fog Rule (past tense fair, present tense fogged). Never a
  coordinate, anywhere, ever.
- **Banned subjects** get the Ledger rule: *aim at the paperwork, never the player serving the
  sentence.*

### 4. Voice

- Read `/var/www/brand/brand-bible.md` **§6** (six constants + tone map, including the Almanac
  and Ledger rows) and **§9** (vocabulary, both ban tiers) **live** — do not write from memory.
  If `/var/www/brand` is absent, shallow-clone to the scratchpad:
  `git clone --depth 1 git@github.com:dayz-one-life/brand.git <scratchpad>/brand`.
- The CLI lints Tier 1 mechanically; **Tier 2 (punching down, Fog-Rule fogging) is yours.**
- Read recent prose and treat its attributions and headline constructions as **burned**:
  ```sql
  SELECT pull_quote_attribution, headline FROM articles
  WHERE status = 'published' ORDER BY created_at DESC LIMIT 12;
  ```

### 5. Compose the payload

A JSON file matching the contract (`apps/newsdesk/src/newsroom/contract.ts`): `format`
(lowercase kebab, e.g. `almanac` / `ledger`), `naturalKey` (must start with `almanac:`,
`ledger:`, or `editorial:`), `headline` (≤90 chars), `lede`, `blocks`
(`para`/`subhead`/`quote`/`list`), optional `pullQuote`, ≤2 `tags`, optional named `subjects`.

**Every claim in the prose gets a row in `factCheck`** (`{claim, source}`) — live aggregates
drift, so the payload freezes publish-time truth the same way the automated desks freeze
`facts`.

### 6. Draft and review

```
pnpm --filter @onelife/newsdesk run newsroom draft <file.json>
```

Open the printed preview URL and review the real page (DRAFT banner, kicker, prose, tags).
Fix by `spike` + re-`draft`, or by editing and re-drafting under an explicit `slug`.

### 7. Publish — on human approval only

```
pnpm --filter @onelife/newsdesk run newsroom publish <slug>
```

Prints the live URL; optionally paste it into Discord by hand. `unpublish` is the mistake
hatch (back to draft — never `retracted`; retraction is a public correction owned by the
sweep). **No manufactured cadence** — the desk prints when there is news.
