# Crier: a Reddit channel — design

**Date:** 2026-08-04
**Status:** approved
**Builds on:** `docs/superpowers/specs/2026-07-31-crier-obituary-syndication-design.md`

## Problem

`apps/crier` posts every published obituary to Discord and Facebook, exactly once per
`(obituary, channel)`. r/dayzonelife exists and gets nothing. Add Reddit as a third channel.

## Why this is mostly free

The crier already owns everything that is hard about syndication: the `CRIER_SINCE` forward-only
cutoff, the dry-run default, per-`(slug, channel)` idempotence, bounded attempts, and the rule
that channels fail independently. `syndications.channel` is plain `text` with a unique index on
`(slug, channel)` — **no migration**.

## Post format

A **link post**: `title` = the obituary headline, `url` = the obituary page. Reddit renders the
OG card, so the feed entry carries the gamertag and cause without us duplicating the site's
content, and clicks land on the site.

The lede is deliberately dropped. Discord and Facebook both carry it; on Reddit a link post
cannot. Posting it as a follow-up comment was considered and declined: it is a second call with
an independent failure mode, and the syndication row records exactly one outcome — a post that
succeeded with a failed comment has nowhere to be recorded and no way to be retried without
double-posting. Revisit if the subreddit reads thin.

## Components

### `apps/crier/src/channels/reddit.ts` (new)

`buildRedditParams(post, opts)` → `URLSearchParams`:
`sr`, `kind=link`, `title`, `url`, `api_type=json`, `resubmit=false`, optional `flair_id`.

`postToReddit(fetchFn, token, post, opts)` → POST `https://oauth.reddit.com/api/submit`.

Two ⚠️ invariants live here, both silent if violated:

- **⚠️ Reddit signals failure with HTTP 200 and an error INSIDE the JSON body.** `RATELIMIT`,
  `SUBREDDIT_NOEXIST`, `DOMAIN_BANNED`, a shadowban — all arrive as `200 { json: { errors: [...] } }`.
  Checking `res.ok`, which is what both existing channels correctly do, would call that a success
  and write `posted_at`, marking the obituary permanently syndicated when nothing was posted.
  There is no retry after that: the row is excluded from `findSyndicationTargets` forever.
  `postToReddit` must parse the body and throw on a non-empty `json.errors`.
- **⚠️ A distinctive `User-Agent` is mandatory.** Reddit throttles generic and shared agents
  aggressively. Default `onelife-crier/1.0 (+https://dayzonelife.com)`, overridable.

### Token provider — same file

`createRedditTokenProvider({ fetchFn, creds, now })` returns `() => Promise<string>`.

Access tokens live one hour; the worker ticks every 60s, so minting per post would be both
wasteful and itself rate-limited. The provider mints via the `refresh_token` grant (HTTP Basic
`clientId:clientSecret` against `https://www.reddit.com/api/v1/access_token`), caches until 60s
before expiry, and re-mints **once** on a 401 before giving up.

Injected rather than module-global so tests drive it with a fake clock and no timers.

**The stored credential is a refresh token**, minted once by the operator through an
`authorization_code` flow with `duration=permanent`. Password grant was rejected: it breaks
outright when the account has 2FA enabled, and disabling 2FA on an account that moderates the
subreddit is a worse trade than a one-time OAuth dance. Unlike the Facebook page token, a refresh
token does not expire — so the Facebook runbook line about reviving poisoned rows after minting a
fresh token has no Reddit equivalent.

### Rate cap — `lastPostedAt` in `pg-store.ts`, applied in `tick.ts`

`CRIER_REDDIT_MIN_INTERVAL_SECONDS`, default 600. Before posting to Reddit the tick reads
`MAX(posted_at) WHERE channel = 'reddit'`; if that is within the interval, the row is left for a
later tick.

- **⚠️ A rate-cap deferral MUST NOT increment `attempts`.** With `CRIER_MAX_ATTEMPTS = 5`, five
  ticks — five minutes — of ordinary rate-limiting would poison every queued row permanently, and
  the channel would go silent with no error anywhere. This is the one genuine landmine in the
  change and it gets its own test. A deferral is neither a success nor a failure; it is a skip.
- Read from `syndications`, not memory: it survives restarts and holds across the fleet.
- Consequence, and intended: a backfill (`CRIER_SINCE` pointed backwards) drains to Reddit at one
  post per interval while Discord and Facebook take it at the existing 2s pace.

### `tick.ts` dispatch

```
if (t.channel === "discord") … else postToFacebook(…)
```
becomes a dispatch map. **As written, any third channel silently routes to Facebook.**

The rate-cap check goes in the same loop, before the dry-run branch is irrelevant — a dry run
should still *report* what it would post, so the cap applies only to live posts.

### `config.ts`

| Var | Meaning |
| --- | --- |
| `CRIER_REDDIT_CLIENT_ID` | app credentials |
| `CRIER_REDDIT_CLIENT_SECRET` | |
| `CRIER_REDDIT_REFRESH_TOKEN` | the durable credential |
| `CRIER_REDDIT_SUBREDDIT` | e.g. `dayzonelife`, no `r/` prefix |
| `CRIER_REDDIT_FLAIR_ID` | optional |
| `CRIER_REDDIT_USER_AGENT` | optional, defaulted |
| `CRIER_REDDIT_MIN_INTERVAL_SECONDS` | default 600 |

All four required vars present, or the channel stays off — mirroring Facebook's both-or-nothing
rule. Half a credential set must never half-enable a channel.

## Testing

`channels.test.ts`:
- payload shape, including `kind=link` and the absent-vs-present `flair_id`;
- **a 200 response carrying `json.errors` throws** — the invariant above, and the test that would
  have caught the whole failure mode;
- a 200 with empty `errors` resolves;
- the token provider caches within the hour, re-mints after expiry, and re-mints once on a 401.

`tick.test.ts`:
- a Reddit row inside the rate window is skipped **and `recordFailure` is not called** — asserting
  the absence, because the bug is an extra call, not a wrong value;
- outside the window it posts;
- each channel routes to its own poster (the dispatch-map regression);
- a Reddit failure still lets the same obituary's Discord post through;
- dry-run reports Reddit rows regardless of the rate cap.

`config.test.ts`: three-of-four credentials leaves the channel off.

**What tests cannot prove:** that Reddit accepts the payload, that the subreddit's own rules
(flair required, domain allowlists) don't reject it, and that the OG card unfurls in a Reddit
feed. Those need a live post — first to a private test subreddit, then to r/dayzonelife.

## Operator setup — `docs/crier-reddit-setup.md` (new)

Mirrors `docs/crier-facebook-setup.md`: register the app at reddit.com/prefs/apps, the one-time
refresh-token mint, confirming the bot may submit to the subreddit, and the dry-run-first rollout.

The posting account is 15 years old with 10k+ karma and moderates the subreddit — the spam-filter
risk that would dominate a fresh account is not a factor here.

## Risks

- Reddit's free API tier is nominally for non-commercial use. Raised and accepted by the project
  owner; volume is a few posts a day against a 100 QPM allowance.
- Subreddit rules (required flair, minimum account age for links) can reject posts. These surface
  as `json.errors` and therefore as ordinary recorded failures, visible in `last_error` — which
  is exactly why the 200-with-errors invariant matters.
