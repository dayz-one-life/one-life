# Cross-linking PR-3 — Gamertags in prose

Date: 2026-07-21
Status: design approved, unimplemented
Supersedes: §6 of `2026-07-21-cross-linking-design.md` (written before `article_subjects` was cut)

## 1. What ships

A gamertag named inside an article's prose becomes a link to that player's dossier. It applies to
every published article kind — obituary, birth notice, news, editorial — and to the whole existing
corpus, because the linking happens at render time and the stored prose is never modified.

This is the last slice of the cross-linking design. PR-1 linked lives to articles and back; PR-2
put In The Paper on the player profile; PR-3 links the prose itself.

## 2. Why the original §6 needs rewriting

§6.2 sourced the roster from an `article_subjects` table. That table was researched and killed
during PR-2 (see PR-2 spec §5): `articles.gamertag` already covered 168/168 published subjects, and
all four publish sites are non-transactional with no `.returning()`, so a child table meant new
plumbing in two paths that run live on every newsdesk tick.

Nothing is lost. The roster PR-3 needs is **per-article**, and every interior already carries its
own on the DTO it renders from:

| Kind | Roster source (already present) |
| --- | --- |
| Obituary | `gamertag` (subject) + `killerGamertag` |
| Birth notice | `gamertag` |
| News (automated) | `gamertag` + `facts.subjects[].gamertag` |
| Editorial | `facts.subjects[].gamertag` — populated by the `newsroom` CLI, see §6 |

No migration. No schema change. No read-model query change.

## 3. Approach

Render-time linkification via a pure function, not publish-time markup.

The alternative — having the desks emit a `link` inline node into `body_blocks` — was rejected. It
is forward-only, so the entire existing corpus would stay plain; it requires a writer change in
four publish sites plus the CLI; and it freezes an href scheme into stored rows, where a
render-time function re-renders correctly the day a slug scheme or a route changes.

## 4. Components

### 4.1 `articleRoster` — pure, per kind

Builds a `string[]` of the gamertags this article is allowed to link. Deduped
case-insensitively, nulls dropped. It never reaches for a global player roster: matching frozen
prose against every gamertag on the server produces false positives on short or common names, and
the failure mode is a link on a word that is not a person.

### 4.2 `linkifyGamertags(text, roster): ReactNode[]` — pure

`apps/web/src/lib/linkify-gamertags.ts`. Splits a run of prose into alternating plain strings and
link elements.

Rules, each pinned by a test:

- **Case-insensitive.** The model does not preserve gamertag casing reliably.
- **The matched text is rendered, never the roster's casing.** Prose is never rewritten — if the
  article says `hartman` the page says `hartman`, linked to `/players/xsgt-hartman`.
- **Longest match first.** A short gamertag must not shadow a longer one that contains it.
- **Regex metacharacters escaped.** Gamertags are user-controlled input.
- **Whole-token boundaries.** A gamertag never matches inside a longer word. Plain `\b` is
  insufficient: gamertags contain spaces, digits, and punctuation, so the boundary test is
  "not flanked by a word character" evaluated against the match edges.
- **Every occurrence is linked**, not just the first.
- **An empty or absent roster returns the input unchanged**, so an article with no roster renders
  exactly the DOM it renders today.

Returns `ReactNode[]` rather than a string of HTML — no `dangerouslySetInnerHTML`, so prose can
never inject markup.

### 4.3 `GamertagLink`, extended

The site-wide `/players/{slug}` link element gains an optional `children`, defaulting to
`gamertag`. This keeps one place in the codebase that builds a player href, while letting the
caller render the prose's own casing.

In-prose styling adds a visible non-hover affordance — `text-red-deep` plus a dotted underline.
Hover-only colour fails WCAG 1.4.1, and `red-deep` is the correct token because every article
interior is a light paper surface (on dark surfaces the ratios invert — see the RED POLICY comment
in `globals.css`).

## 5. Call sites

- `ArticleBody` (`apps/web/src/components/shared/article-body.tsx`): the `para`, `quote`, and
  `list` block types **and the flat `body.split(/\n{2,}/)` fallback path**. The fallback is what
  every pre-0014 article still renders through — missing it would leave the large majority of the
  live corpus unlinked.
- The lede on all three interiors (`/obituaries/[slug]`, `/fresh-spawns/[slug]`, `/news/[slug]`),
  which is rendered outside `ArticleBody`. It is the first prose a reader hits and almost always
  names the subject.

Explicitly **not** linkified: headlines, subheads, kickers, image captions, pull-quote
attributions, OG cards, and feed cards. Those are chrome and index surfaces; a red inline link
inside display type fights the tabloid look.

`ArticleBody` takes the roster as a new optional prop. Omitted, it renders exactly as it does
today — so a future caller that forgets it degrades to plain prose rather than breaking.

## 6. Editorial rosters via the `newsroom` CLI

An editorial piece has no subject columns (migration `0016` made all five nullable) and usually no
`facts.subjects`, so under a strict per-article rule it would linkify nothing — and it is the kind
of article where cross-links matter most.

The `newsroom` CLI therefore gains a roster field, written into `facts.subjects` at publish in the
same shape the automated news desk uses (`{ gamertag }`, other fields optional). The CLI stays the
only sanctioned write path; the author controls exactly who is linked; the existing publish-time
contract (prefix registry, voice lint, required `factCheck` table) is where it belongs.

Two constraints:

- The roster is **validated against known players at publish time** — a typo'd callsign must fail
  the publish, not ship a link to a 404.
- It is **forward-only**. Already-published editorial pieces link nothing until re-published.

## 7. Testing

- `linkifyGamertags`: whole-token boundaries; casing preserved from the prose; regex-metacharacter
  gamertags; overlapping names where one contains the other; multi-word gamertags; empty roster;
  every-occurrence linking; a gamertag inside a `quote` block; a gamertag in the flat fallback path.
- `articleRoster`: each kind's fan-out, null/absent fields, case-insensitive dedup.
- `ArticleBody`: renders identical DOM when no roster is passed (the regression guard for all 168
  legacy articles).
- `GamertagLink`: `children` override renders the child text against the roster-derived href.
- Interiors: the lede links; the headline does not.
- `newsroom` CLI: publish fails on a roster naming an unknown player; a valid roster lands in
  `facts.subjects`.

## 8. Deployment

Plain deploy. No migration, no `--rebuild`, no backfill. Linkification is retroactive across the
whole corpus the moment the web app ships; editorial rosters begin with the next published
editorial piece.

## 9. Known risks

- **A gamertag that is also an ordinary word.** The per-article roster bounds the blast radius to
  players the article is genuinely about, but an obituary about a player named `Hunter` will link
  the word "hunter" in its own prose. Partly accepted: the alternative is a global roster, which is
  strictly worse, and the link still points at a real, relevant player.
  **Amended after implementation review:** Xbox allows 3-character callsigns, which pushes this
  further than the paragraph above assumed — a player named `Fox`, `Ash`, `Doc` or `Ace` would link
  every ordinary occurrence of that word. A roster entry shorter than `MIN_LINKIFY_LENGTH` (4,
  `@/lib/article-roster`) is therefore never linkified. A short-named player stays reachable from
  the byline, In The Paper, and the boards. Names of 4+ characters that are also ordinary words
  (`Hunter`, `Bear`) remain accepted per the original reasoning.
- **A roster gamertag whose player row is later removed** would link to a 404. The player page
  already `notFound()`s on an unresolvable slug, so this degrades to a normal 404 rather than an
  error.
