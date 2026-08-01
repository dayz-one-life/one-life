# Crier X (Twitter) syndication — design

**Date:** 2026-08-01
**Status:** Implemented on `feature/crier-x-syndication`.
**Builds on:** `2026-07-31-crier-obituary-syndication-design.md`

Adds X as a third crier channel alongside Discord and Facebook. Every published obituary is
posted to X exactly once, recorded in the same durable `syndications` ledger under the channel
name `x`.

The crier's channel boundary is already clean — a body-builder plus a poster per channel, one
dispatch branch in `tick.ts`. Nothing structural moves. The genuinely new work is OAuth 1.0a
request signing, a 280-character fit, and a rate-limit path that the other two channels never
needed.

## What X costs, and why it shapes the design

Verified 2026-08-01 against `docs.x.com`:

- **There is no free tier.** X discontinued it in February 2026; new developer accounts are
  pay-per-use and must load credits in the developer console before any call succeeds.
- **A post containing a link costs $0.20**, versus $0.015 for a plain post — a surcharge X
  added in April 2026. Every crier post carries an obituary URL, so every X post is $0.20.
  There is no way around it: moving the link into a self-reply just makes the reply the link
  post.
- **Rate limits are not a steady-state concern**: 100 posts / 15 min per user, 10,000 / 24h per
  app. They matter only during a backfill (see "Rate limiting" below).

Ongoing cost is therefore *(obituaries per month) × $0.20*. The first live run is the sharp
edge, because it replays the back catalogue — see "Rollout".

## Auth: OAuth 1.0a, four static keys

X's write endpoint requires a user-context credential. Crier uses **OAuth 1.0a** with four
credentials minted once in the developer portal for the account itself:

| Var | Source |
| --- | --- |
| `CRIER_X_API_KEY` | app's consumer key |
| `CRIER_X_API_SECRET` | app's consumer secret |
| `CRIER_X_ACCESS_TOKEN` | account's access token (Read **and** Write) |
| `CRIER_X_ACCESS_SECRET` | account's access token secret |

They do not expire, so operationally this mirrors the Facebook Page-token model exactly: set
the vars, restart, done.

**Rejected: OAuth 2.0 user context.** Its access token expires every two hours and its refresh
token *rotates on each use*, so crier would need durable token storage, a refresh-on-401 path,
and a manual browser re-authorization whenever a write races or is lost. That is real
machinery for a single-account bot.

**Rejected: `twitter-api-v2`.** Signing is ~30 lines of `node:crypto`. The other two channels
are plain `fetch` calls, and a dependency in this worker earns nothing.

## `src/channels/x.ts`

Same shape as `facebook.ts` — a pure body-builder plus a poster taking `fetchFn` — with two
additions.

### Signing

The request body is JSON and there is no query string, so the OAuth signature base string
covers only the `oauth_*` parameters:

```
base = "POST&" + enc(url) + "&" + enc(sorted oauth params)
key  = enc(apiSecret) + "&" + enc(accessSecret)
sig  = base64(hmacSha1(key, base))
```

`enc` is RFC 3986 percent-encoding (stricter than `encodeURIComponent`: `!*'()` must also be
escaped).

`oauth_nonce` and `oauth_timestamp` are **injected as dependencies**, the way `now` already is
in `CrierDeps`, so a test can pin the exact `Authorization` header rather than regex around the
varying parts.

### Errors

A 429 throws a typed `RateLimitError` from a new `src/rate-limit.ts`, so the tick can
distinguish throttling from failure. Every other non-2xx throws the same `status: body` shape
the other two channels use.

Extending `RateLimitError` to Discord and Facebook is deliberately **out of scope**. The type
lives in its own module so that remains a one-line change later.

## The 280-character fit

`buildXText(post)` is the only genuinely new logic. Facebook sidesteps length entirely (the URL
rides in a separate `link` field); on X the URL must be in the post text.

Budget: **280 − 23 − 4 = 253 characters for headline + lede.** X counts every URL as 23
characters regardless of its actual length; the 4 is the two blank-line separators.

Rules, in order:

1. Headline alone exceeds 253 → truncate the headline, drop the lede. Unreachable through the
   newsdesk schema (which caps a headline at 200), present so the function is total.
2. Lede fits within `253 − headline` → post it whole. The result is byte-identical to the
   Discord body. Most obituaries land here — the voice prompt asks for a headline of ~90
   characters, leaving ~163 for a 1–2 sentence lede.
3. Otherwise → cut the lede at the last whole word inside the budget and append `…`.
4. If that fragment would be under 24 characters → drop the lede entirely, post headline + URL.
   Only reachable with a near-200-character headline; exists so a post can never be a headline
   followed by a bare ellipsis.

Length is counted in **code points**, not X's weighted count (which charges 2 for CJK and
emoji). The copy is English and the budget carries margin. This is a deliberate simplification,
not an oversight.

## `tick.ts`

`x` joins the enabled-channel list when all four credentials are present.

⚠️ **The dispatch today is `if (discord) … else → facebook`. That `else` must become an
explicit `else if`.** Left as-is, every X row silently posts to Facebook. This is the
highest-risk line in the change and gets its own test.

### Rate limiting

```
catch (err) {
  if (err instanceof RateLimitError) { rateLimited.add(t.channel); log.warn(…); continue; }
  … existing recordFailure path
}
```

A 429 is throttling, not failure, so it **does not call `recordFailure`** and does not consume
one of the 5 attempts — that budget stays reserved for real errors like a revoked key. Without
this, ~5 rate-limited ticks would permanently poison every affected row and require the
README's manual revive.

**Revised during implementation: per-channel pause, not a whole-tick `break`.** The original
design ended the entire tick on the first 429, on the theory that once X is throttling the rest
of the batch is doomed too. Review caught that this starves the *other* channels: because a
rate-limited row's attempts are deliberately never burned, it stays at the head of every future
batch for as long as X stays 429'd — which can be weeks against a monthly cap — and a `break` on
that first target in sorted order would silently halt Discord and Facebook syndication as well.
The shipped behavior instead tracks 429'd channels in a per-tick `Set`: hitting one adds its
channel to the set and `continue`s, so later targets on *other* channels in the same tick still
post; only that channel is skipped for the remainder of the tick. The next tick resumes and
retries it, so a backfill still self-paces to whatever X allows — it just no longer takes
Discord and Facebook down with it.

This matters because `CRIER_BATCH_CAP` is 10 rows per 60s tick — roughly 150 posts per 15
minutes against a ceiling of 100. Steady-state obituary volume is nowhere near this; a backfill
is exactly the case that hits it.

## Config

Four vars, **all four present or the channel stays off** — the same both-or-nothing rule
Facebook uses, so half a credential set never half-posts. Ledger channel name is `x`.

X shares `CRIER_SINCE` with the other channels rather than taking its own cutoff. Since the
ledger has no `x` rows on first run, this means **the first live run replays the entire back
catalogue** to the new account, oldest death first, paced 10 per tick. That is the intended
behavior for a fresh timeline. A per-channel `CRIER_X_SINCE` was considered and rejected as
unnecessary given the decision to backfill.

## Testing

`test/channels.test.ts`:

- `buildXText` across all four length branches — whole lede, word-boundary trim with `…`,
  sub-24-character fragment dropped, over-long headline truncated.
- The exact `Authorization` header, with `nonce` and `timestamp` pinned.
- 429 → `RateLimitError`; other non-2xx → throws with status and body text.
- The token never appears in the request URL.

`test/config.test.ts`: all four vars enable `x`; any missing one leaves it off.

`test/tick.test.ts`:

- An `x` target posts to X and **not** to Facebook (the `else if` trap).
- A `RateLimitError` pauses only that channel for the rest of the tick, `recordFailure` is
  never called, and later targets on *other* channels in the same tick still post; the paused
  channel's later targets are left untouched for the next tick.
- A non-429 X failure still records a failure and still posts the other channels
  (the existing independent-channels invariant).

## Docs

- New `docs/crier-x-setup.md`: developer portal → app with **Read and Write** permission →
  load credits → mint the four keys → verify without posting → set vars and restart.
  It must state the $0.20-per-link-post cost plainly.
- `apps/crier/README.md`: env table row, and the poisoned-row revive line generalized to `x`.
- `CHANGELOG.md` entry, written last, before the PR.

## Rollout

`CRIER_DRY_RUN` defaults ON and prints one `would post` line per row, so **the first live-run
bill is knowable in advance** — but not by counting log lines. In dry-run, `crierTick`
increments `skipped`, logs, and `continue`s without ever calling `recordSuccess`, and
`findSyndicationTargets` caps every batch at `CRIER_BATCH_CAP` (default 10). A dry-run tick
therefore logs the same 10 oldest rows every 60 seconds forever — counting `would post` lines
undercounts the bill without bound (a 500-obituary catalogue would price at $2 instead of $100).
Price it with a database query instead:

```sql
SELECT count(*) FROM articles a
 WHERE a.kind = 'obituary' AND a.status = 'published' AND a.death_at > '<CRIER_SINCE>'
   AND NOT EXISTS (SELECT 1 FROM syndications s
                    WHERE s.slug = a.slug AND s.channel = 'x' AND s.posted_at IS NOT NULL);
```

Multiply the count by $0.20. Do that before setting `CRIER_DRY_RUN=false`, because the backfill
fires the whole catalogue at once.

1. Create the app, load credits, mint the four keys.
2. Set the four vars, restart crier with dry-run still on.
3. Run the query above to price the backfill. Also watch a tick of dry-run output as a smoke
   check — confirm the lines say `channel: "x"` and the post body reads correctly — but do NOT
   count them to price the backfill; the batch cap means you will see the same 10 rows every
   tick.
4. Set `CRIER_DRY_RUN=false`, restart, watch for 429 warnings — X pauses, Discord and Facebook
   keep posting, and the backfill drains over successive ticks.

## Out of scope

- `RateLimitError` for Discord and Facebook.
- Threads, media uploads, or posting the obituary image directly to X (the OG card already
  renders it).
- Any per-channel `SINCE` cutoff.
