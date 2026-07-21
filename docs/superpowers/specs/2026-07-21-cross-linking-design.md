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

## 5. PR-2 — `article_subjects` and In The Paper

### 5.1 The table

Migration `0017`:

```
article_subjects
  article_id  integer NOT NULL REFERENCES articles(id) ON DELETE CASCADE
  gamertag    text    NOT NULL
  role        text    NOT NULL          -- 'subject' | 'killer'
  PRIMARY KEY (article_id, gamertag, role)
  INDEX (gamertag)
```

**⚠️ `gamertag` is text with no foreign key to `players`, deliberately.** `apps/projector/src/rebuild.ts:8`
truncates `players … RESTART IDENTITY CASCADE` on every projection rebuild. A FK to `players` would
make each rebuild cascade-delete the entire mention index. `articles` already keys subjects by
gamertag text for this reason; `article_subjects` follows it.

The table is **durable**: absent from `rebuild.ts`'s truncate list, present in `APP_TABLES`
(`packages/test-support/src/global-setup.ts:30-33`). It ships with a plain `./deploy/deploy.sh` —
no `--rebuild`, since it touches no projection table.

The composite PK makes every write idempotent under `onConflictDoNothing`. Including `role` in the
key means one player can hold two roles on one article (subject of a piece that also records them as
a killer) without collision.

### 5.2 Writers

Rows are written alongside each article upsert, in the same transaction:

- `apps/newsdesk/src/pg-store.ts` — obituary publish (`subject` = `facts.gamertag`, `killer` =
  `facts.killerGamertag` when non-null)
- `apps/newsdesk/src/birth-pg-store.ts` — birth notice publish (`subject` only)
- the news publish path — one `subject` row per entry in `facts.subjects[]`
- the `newsroom` CLI publish path — editorial pieces, which may legitimately have **zero** subjects

Failure stubs (`status='failed'`) write no subject rows: they have no confirmed facts.

### 5.3 Backfill

A re-runnable `backfill-article-subjects` script in `apps/newsdesk`, following the
`backfill-death-causes` precedent (`apps/projector`): surveys first, prints what it found and what
it could not interpret, writes only additions, and is safe to run twice.

**This is the least verified part of the design.** The `facts` jsonb shape varies by article kind and
by when the row was written, and the local development database predates the `articles` table
entirely, so the shape across the ~168 published rows was not inspected during design. The script
must report per-kind counts and an unrecognised-shape list, and should be run against a production
dump before it is trusted. Treat a low subject count as a bug in the script, not as a fact about the
corpus.

### 5.4 Read model, API, and the section

`getPlayerArticles(db, gamertag, { page, pageSize })` in
`packages/read-models/src/player-articles.ts`. Joins `article_subjects` to `articles`, filters
`status = 'published'`, orders `created_at DESC`, returns `{ kind, slug, headline, createdAt, role,
mapSlug }` plus a total. Gamertag matching is case-insensitive, consistent with the rest of the
codebase.

Served at a new `GET /players/:gamertag/articles?page=` rather than folded into
`GET /players/:gamertag`. The player-page payload is already heavy, and a separate route lets this
section paginate independently.

The **In The Paper** section renders between current standing and the funeral cards: a count in the
heading, then reverse-chron rows of `KIND · DATE · ROLE` over the headline, linking to the article
interior. It needs its own page parameter — `?page=` already belongs to past lives.

A player with no articles renders no section at all. A *failed fetch* must not render as an empty
section: this is the live-data-honesty invariant already established in the codebase (loading and
error are never rendered as an authoritative zero), and the home page's `settleFeed` +
`FeedFailedBanner` is the pattern to follow.

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

1. **Backfill fidelity is unverified** (§5.3). The one item that should be checked against real data
   before implementation is trusted.
2. **Idle-card links are a judgement call.** A player idle on a map may have last died months ago,
   making the link noise. Cheap to build and cheap to remove if it reads badly.
3. **Roster-only linkification under-links by design.** An article that names a player who is
   neither a subject nor the killer leaves that name plain. Widening this later means widening the
   table's role vocabulary and re-running the backfill, not changing the renderer.
