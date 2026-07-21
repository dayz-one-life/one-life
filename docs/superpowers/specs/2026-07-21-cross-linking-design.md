# Cross-linking pass — design

**Date:** 2026-07-21
**Status:** approved, not implemented
**Ships as:** three sequential PRs into `develop`, each independently releasable.

## 1. Problem

The site holds three record types that are densely related — players, lives, and articles — and
navigates between them only in a few hand-placed spots. A reader who lands on an obituary cannot
reach the life's event record. A player's profile does not say the paper ever wrote about them.
The controls rail names the server a life is on but will not open it.

The gamertag → profile link is largely solved: survivor board rows, kill lists, and death-by
attributions on funeral cards all route through the shared `GamertagLink`
(`apps/web/src/components/gamertag-link.tsx`) — including the killer on a past-life card
(`components/player/past-life-card.tsx:23`), verified during design. The gaps are life links,
article links, and gamertags inside article prose.

## 2. Scope

In scope:

- Life-detail links from the controls rail's server cards (alive, banned, and idle).
- Life-detail link from an article's dossier; obituary link from a life-timeline page.
- A queryable index of which players a published article names, and an **In The Paper** section on
  the player profile driven by it.
- Gamertags inside frozen article prose becoming links.

Out of scope:

- Rewriting any stored prose. Every article body in the database is frozen; all linkification is a
  render-time transform.
- Regenerating or re-imaging any article.
- Linking gamertags that appear in prose but are not part of the article's roster (see §6.3).

## 3. Ordering, and why it differs from the obvious one

The natural reading of the request is: sidebar links, then prose linkification, then the mentions
list. The dependency graph disagrees. Prose linkification needs a per-article roster of gamertags it
is allowed to link. That roster is exactly what `article_subjects` holds. Deriving it a second way —
reading `facts.killerGamertag` and `facts.subjects[]` at render time — would create two sources of
truth for the same question, which drift the first time a writer changes.

So: **PR-1 (no schema) → PR-2 (`article_subjects` + In The Paper) → PR-3 (prose linkification).**

## 4. PR-1 — Cross-links that need no schema change

### 4.1 Controls rail → life detail

`ServerStanding` (`packages/read-models/src/player-page.ts:12-14`) already carries
`alive.lifeNumber` and `ban.triggeringLifeNumber`. The rail's own projection —
`serverCards()` in `apps/web/src/components/controls/format.ts:24` — **drops both** on the way into
`ServerCardData`. Widening that projection is the entire change for alive and banned cards; no API,
route, or read-model change is involved.

Each card gains a `TIMELINE →` link built by the existing pure `lifeHref(gamertag, mapSlug,
lifeNumber)` (`apps/web/src/lib/life-href.ts`), matching how standing and funeral cards on the
player page already link.

`triggeringLifeNumber` is nullable. A banned card whose triggering life cannot be identified renders
no link rather than a broken one.

**Idle cards have no life number anywhere in the standing model** — an idle `ServerStanding` has
both `alive` and `ban` null. This requires a new `lastLifeNumber: number | null` on `ServerStanding`,
populated with the most recent ended life for that (gamertag, server). This is the only read-model
change in PR-1.

The rail and the mobile `ControlsSheet` render the same card data through different components
(`controls/server-cards.tsx` and the sheet's own rows). Both get the link. Note the ⚠️ two-surface
rule in CLAUDE.md: the rail is the light paper surface and the sheet is `bg-dark`, so the link needs
a token variant on each. A link written only in `text-red-deep` is invisible on the sheet —
`--red-deep` is a light-surface-only token.

### 4.2 Article dossier → life detail

An obituary and a birth notice each carry `gamertag`, `mapSlug`, and `lifeNumber` as columns. Their
dossier/Rap Sheet blocks gain a link to `lifeHref(...)`. Guard on `mapSlug !== null` — the column is
nullable, and the news interior already degrades this way.

### 4.3 Life detail → obituary

The life-timeline page looks up a published obituary for its own `(serverId, gamertag, lifeNumber)`
and, if one exists, links to it. This is a direct query on existing columns and does **not** depend
on `article_subjects`.

Only `status = 'published'` qualifies. A retracted or failed-stub article must not be linked.

## 5. PR-2 — In The Paper

**Revised 2026-07-21, after research. The `article_subjects` table is NOT built.** The original design
normalised article↔player links into a child table. Two findings retired that:

1. **`articles.gamertag` already covers every subject.** All 168 published rows have it, and it agrees
   with `facts.gamertag` on every row (zero mismatches). The table would have been a copy of a column
   that already exists.
2. **Writing it at publish time is invasive.** None of the four publish sites
   (`pg-store.ts`, `birth-pg-store.ts`, `news-pg-store.ts`, `newsroom/store.ts`) runs in a transaction
   or returns `articles.id` — they are bare `onConflictDoUpdate` calls. Populating a child table
   atomically means adding `.returning()` and a transaction to all four, two of which run live in
   production on every newsdesk tick.

And the reason the table looked mandatory was wrong: PR-3's prose roster is **per-article** (which
names may be linked inside *this* article), and both values already sit on the article row. PR-3 does
not need a cross-article index either.

So PR-2 ships the same user-visible feature against `articles` directly.

### 5.1 Indexes (migration `0017`)

Two partial expression indexes on `articles`, no new table:

```sql
CREATE INDEX articles_subject_idx ON articles (lower(gamertag), created_at DESC)
  WHERE status = 'published';
CREATE INDEX articles_killer_idx  ON articles (lower(facts->>'killerGamertag'), created_at DESC)
  WHERE status = 'published' AND facts->>'killerGamertag' IS NOT NULL;
```

**⚠️ The migration must be hand-written, and `meta/_journal.json` hand-appended.** The drizzle
snapshot chain is already broken — `meta/` stops at `0014_snapshot.json` while `0015` and `0016`
exist as `.sql` + journal entries with no snapshot. Running `drizzle-kit generate` would diff against
a stale snapshot and emit wrong SQL. This gap is pre-existing; migration `0017` must follow the same
hand-written practice as `0015`/`0016` rather than fix it, and the plan should not attempt a snapshot
backfill as a side quest.

No projection table changes, so this deploys with a plain `./deploy/deploy.sh` — no `--rebuild`. No
backfill script is needed at all: the data is already in the columns being indexed.

### 5.2 Read model

`getPlayerArticles(db, gamertag, { page, pageSize })` in `packages/read-models/src/player-articles.ts`.
Two arms unioned, each `status = 'published'`, ordered `created_at DESC`, paginated with a separate
count query — mirroring `getPublishedObituaries` (`obituary-articles.ts`), which is the pattern to copy:

- **subject** — `lower(articles.gamertag) = lower($1)`
- **killer** — `lower(articles.facts->>'killerGamertag') = lower($1)`

Returns `{ rows: PlayerArticleRow[], total, page, pageSize }` where a row carries
`{ kind, slug, headline, createdAt, role, mapSlug }`.

**If a player is both subject and killer of the same article, it appears once, as `subject`.** That
combination does not occur today (no published obituary has a self-kill) but the query must not emit
the same article twice.

### 5.3 API

`GET /players/:gamertag/articles?page=` — a separate route, not folded into `GET /players/:gamertag`,
because the player-page payload is already heavy and this section paginates independently.
`?page=` uses `z.coerce.number().int().positive().catch(1)`, matching the obituaries route.

### 5.4 The section

**In The Paper**, between current standing and the funeral cards: a count in the heading, then
reverse-chron rows of `KIND · DATE · ROLE` over the headline, each linking to the article interior.

**⚠️ It must use its own query parameter — not `page`.** The player page's existing past-lives
pagination is wired end-to-end on the bare `page` param (`parsePage` in the route, and the href
builder in `player-pagination.tsx`). A second section on `page` would make both paginations move
together. Use `ap` (articles page).

A player with no articles renders no section. A **failed fetch** must not render as an empty section —
use `settleFeed` and an honest failure line, per the live-data-honesty invariant. Note
`FeedFailedBanner` is currently a private local function in `apps/web/src/app/page.tsx`, not exported;
reusing it means extracting it to a shared component.

### 5.5 What this defers

If the news vertical is ever enabled and publishes a multi-subject Long Form piece, its co-subjects
(in `facts.subjects[]`) will NOT appear on their profiles — only the primary, via `articles.gamertag`.
Today that is zero articles. When it stops being zero, revisit the child table; `news-facts.ts`'s
`NewsSubject` is already shaped for it.

Corpus at time of writing: **6** published obituaries name a killer, across just **two** distinct
players (`YrJustBad` ×3, `TidierCart8730` ×3), both real player rows. So the `killer` role is real but
tiny — render it as a role tag, do not build dedicated UI around it.

## 6. PR-3 — Gamertags in prose

### 6.1 Where

A pure `linkifyGamertags(text, roster): ReactNode[]`, applied inside `ArticleBody`
(`apps/web/src/components/shared/article-body.tsx`) to the `para`, `quote`, and `list` block types —
**and to the flat `body.split(/\n{2,}/)` fallback path**, which is what every pre-0014 article still
renders through. Missing the fallback would leave the large majority of the live corpus unlinked.

### 6.2 Roster

The article's own rows from `article_subjects`, supplied by the article read-models. Not the global
player roster: matching frozen prose against every gamertag on the server would produce false
positives on short or common names, and the failure mode is a link on a word that is not a person.

### 6.3 Matching rules

- Case-insensitive. The model does not preserve gamertag casing reliably.
- Whole-token boundaries only, so a gamertag never matches inside a longer word.
- Regex metacharacters in gamertags escaped. Gamertags are user-controlled input.
- Longest match first, so a short gamertag cannot shadow a longer one that contains it.
- Never linkify inside an already-linked node.
- Every occurrence is linked, not just the first.

Prose in the database is never modified.

## 7. Testing

- `serverCards()` projection: pins that `lifeNumber` / `triggeringLifeNumber` survive, and that a
  null triggering life yields no link.
- `lifeHref` link targets on all three card states, on **both** the rail and the dark sheet,
  including the token swap (an RTL test asserts the DOM, not contrast — the invisible-panel class of
  bug shipped once already this way).
- `getPlayerArticles`: role fan-out, published-only filtering, ordering, pagination, case-insensitive
  gamertag match.
- Backfill script: survey output on a fixture corpus covering each article kind, plus an
  unrecognised-shape row.
- `linkifyGamertags`: whole-token boundaries, casing, regex-metacharacter gamertags, overlapping
  names, no-roster, and a gamertag appearing in a `quote` block and in the flat fallback path.
- The In The Paper section: empty state renders nothing; failed fetch renders a failure state, not
  an empty one.

## 8. Deployment

PR-1: plain deploy. PR-2: plain deploy, then run `backfill-article-subjects` on the host — no
`--rebuild`; migration `0017` touches no projection table. PR-3: plain deploy.

## 9. Known risks

1. ~~**Backfill fidelity is unverified**~~ — **retired 2026-07-21.** The corpus was surveyed against
   the local `onelife_prod` dump; §5.3 now carries exact counts and a hard acceptance number (174
   rows). The remaining residual is that the survey reflects a corpus with the news vertical still
   off; the shape will change when it is enabled.
2. **Idle-card links are a judgement call.** A player idle on a map may have last died months ago,
   making the link noise. Cheap to build and cheap to remove if it reads badly.
3. **Roster-only linkification under-links by design.** An article that names a player who is
   neither a subject nor the killer leaves that name plain. Widening this later means widening the
   table's role vocabulary and re-running the backfill, not changing the renderer.
4. **`role='killer'` earns little UI at launch.** Six articles corpus-wide carry a killer (§5.3).
   The In The Paper section should render the role tag generically rather than building a dedicated
   "Appearances" treatment around a case that is currently six rows. This is a reason to prefer the
   single-section design already chosen in §5.4, not a reason to change it.
