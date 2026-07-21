# Sitemap + robots.txt

Date: 2026-07-21
Status: design approved, unimplemented

## 1. Problem

The site has no `sitemap.xml` and no `robots.txt`. Every player dossier, life timeline, article and
board page is reachable only by crawling from the front page. The cross-linking work (PR-1/2/3) made
that graph dense — but a dense graph still leaves the deepest tier, life timelines, several hops from
any entry point, and gives search engines no `lastmod` signal on a site whose entire premise is
freshness.

The absent `robots.txt` also means `/login`, `/welcome` and `/notifications` are crawlable.

## 2. Scale

From the local `onelife_prod` dump (newest article 2026-07-18):

| Class | Count |
| --- | --- |
| Players | 97 |
| Lives | 194 |
| Published articles | 168 |
| Slugged servers | 3 |
| Board URLs | 12 |
| Static pages | 5 |
| **Total** | **~476** |

Comfortably inside the 50,000-URL limit for a single sitemap file, with room for 100× growth. **No
sitemap index, and no `generateSitemaps` splitting.** Revisit only if the URL count approaches
50,000 or the file approaches 50 MB uncompressed.

## 3. Architecture

Three pieces, each independently testable:

1. `getSitemapEntries` (`packages/read-models/src/sitemap.ts`) — three narrow queries returning the
   enumerable URLs and their `lastmod` values.
2. `GET /sitemap` (`apps/api/src/routes/sitemap.ts`) — public, unauthenticated, serves that read
   model as JSON.
3. `apps/web/src/app/sitemap.ts` and `apps/web/src/app/robots.ts` — Next.js metadata routes that
   render `sitemap.xml` and `robots.txt`.

### 3.1 Why one endpoint

The web app has no direct database access; it reaches everything through the API. The alternative
was paging through the existing `/obituaries`, `/news` and `/birth-notices` feeds — that is N round
trips, it drifts if the newsdesk publishes mid-enumeration, and there is no endpoint that enumerates
players or lives at all. A single call returning a consistent snapshot is simpler and cheaper.

### 3.2 Payload

```ts
{
  players:  { slug: string; lastmod: string }[],
  lives:    { playerSlug: string; mapSlug: string; n: number; lastmod: string }[],
  articles: { kind: string; slug: string; lastmod: string }[],
}
```

Timestamps are ISO strings. The web layer builds every path, so a route change never requires an
API change.

## 4. Rules that keep the sitemap honest

A sitemap that lists a URL which 404s or redirects is worse than no sitemap — it burns crawl budget
and signals a low-quality site. Each of these is a test.

1. **A life's map segment is a `servers.slug`, never `servers.map`.** The route resolves it with
   `resolveServerBySlug` and 404s on a miss; the mission codename (`chernarusplus`, `enoch`) is
   display-only. A life on a server with a null slug is **omitted entirely** — it has no reachable
   URL.
2. **Only players with at least one life.** A player row with no lives has nothing to render. Today
   that is all 97, but the rule must not depend on that.
3. **Only `status='published'` articles.** Retracted articles are deliberately `noindex` (they stay
   reachable so a shared link yields the correction, but they must not be advertised); drafts are
   not public at all.
4. **Never the explicit-default sort paths.** `/survivors/time` and `/survivors/[map]/time`
   `redirect()` to their bare paths. The canonical board set is: `/survivors`, `/survivors/kills`,
   `/survivors/longest`, and for each slugged server `/survivors/{slug}`, `/survivors/{slug}/kills`,
   `/survivors/{slug}/longest`.
5. **Board URLs are built by the existing pure `boardHref`** (`@/lib/board-params`), never by string
   concatenation, so they cannot drift from the router.
6. **Feed pages list page 1 only.** `?page=N` variants are paginated views of the same feed.
7. **`lives.life_number` is the URL segment `n`.** It is `NOT NULL` on the table and is what the
   profile's own links use. (This is the one place the codebase's "never key on `life_number`" rule
   does *not* apply — that rule governs matching an **article** to a life, where the stable key is
   `(server_id, gamertag, life_started_at)`. Here we are generating the URL the router itself
   resolves by number.)

## 5. `lastmod`

Real values, never `new Date()`. A sitemap claiming everything changed on every fetch trains
crawlers to ignore the field.

| Class | Value |
| --- | --- |
| Article | `articles.created_at` |
| Life | `lives.ended_at ?? lives.started_at` |
| Player | the most recent life activity across their lives (`MAX(ended_at, started_at)`) |
| Boards / feeds / home | omitted — they change constantly, and a value would be a guess |
| `/about` | omitted |

## 6. Freshness

`export const revalidate = 3600` on the sitemap route. One enumeration query per hour regardless of
crawler traffic; a new obituary appears within the hour. Crawlers re-fetch sitemaps far less often
than hourly, so anything finer is spend without benefit.

## 7. Failure behaviour

If the API call throws, `sitemap.ts` returns the **static and board entries only** rather than
propagating the error. A partial sitemap beats a 500: an API blip must never look to a crawler like
the site has no pages. The failure is logged. This mirrors the live-data-honesty principle already
applied to the home page's feed fetches — degrade visibly, never fabricate.

`robots.ts` has no data dependency and cannot fail this way.

## 8. robots.txt

```
User-agent: *
Allow: /
Disallow: /login
Disallow: /welcome
Disallow: /notifications
Disallow: /api

Sitemap: https://dayzonelife.com/sitemap.xml
```

The host comes from `SITE_URL` via `absoluteUrl` (`@/lib/seo`), so a staging deployment advertises
its own sitemap, not production's. The `Sitemap:` line is how a crawler finds the file without
Search Console.

AI crawlers (GPTBot, CCBot, ClaudeBot) are **not** blocked — the paper wants citations.

## 9. Testing

- `getSitemapEntries`: a life on an un-slugged server is omitted; a player with no lives is omitted;
  a retracted article and a draft are both omitted while a published one is present; `lastmod`
  values come from the right columns.
- The route: shape and public accessibility.
- `sitemap.ts`: includes the three canonical combined-board URLs and excludes `/survivors/time`;
  includes per-map boards for each slugged server; renders a life URL using the server **slug**;
  returns static + board entries when the API call rejects.
- `robots.ts`: the four disallows are present and the `Sitemap:` line uses `SITE_URL`.

## 10. Deployment

Plain deploy. No migration, no rebuild, no backfill. After deploy, submit `/sitemap.xml` in Google
Search Console once — the `Sitemap:` directive covers discovery for everything else.

## 11. Out of scope

- A sitemap index or `generateSitemaps` splitting (§2).
- Image or video sitemap extensions. Article hero images are already exposed through
  `NewsArticle` JSON-LD `image`.
- `changefreq` and `priority`. Google ignores both.
- Any change to canonical tags, which already exist on every indexable route.
