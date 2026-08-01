# Crier X (Twitter) Syndication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Post every published obituary to X (Twitter) as a third crier channel, alongside Discord and Facebook.

**Architecture:** The crier already has a clean channel boundary — a pure body-builder plus a `fetchFn`-taking poster per channel, and one dispatch branch in `tick.ts`. This adds `src/channels/x.ts` in the same shape, plus two things the other channels never needed: OAuth 1.0a request signing (~30 lines of `node:crypto`, no dependency) and a typed `RateLimitError` so the tick can tell throttling from failure.

**Tech Stack:** TypeScript/ESM, vitest, zod (config), `node:crypto` (HMAC-SHA1). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-01-crier-x-syndication-design.md`

## Global Constraints

- **No new npm dependencies.** Signing is hand-rolled on `node:crypto` deliberately; `twitter-api-v2` was considered and rejected.
- **Ledger channel name is the literal string `x`** — matching the existing `discord` and `facebook`.
- **All four X credentials present, or the channel stays off.** Half a credential set must never half-post. This mirrors Facebook's both-or-nothing rule in `loadConfig`.
- **A 429 must never call `recordFailure`.** The 5-attempt budget is reserved for real errors; letting rate limiting consume it would permanently poison rows during the backfill.
- **Character budget is exactly 253** for headline + lede: 280 − 23 (X counts every URL as 23 chars, whatever its length) − 4 (two `\n\n` separators).
- **Minimum lede fragment is 24 code points.** Below that the lede is dropped entirely rather than posting a headline followed by a near-bare ellipsis.
- **Secrets never appear in a URL or query string** — `Authorization` header only.
- Tests live beside the existing ones in `apps/crier/test/`; run with `pnpm --filter @onelife/crier run test`.
- Every task ends in a commit. `CHANGELOG.md` is written **last**, in Task 5, immediately before the PR.

## File Structure

| File | Responsibility |
| --- | --- |
| `apps/crier/src/rate-limit.ts` | **Create.** The `RateLimitError` type, alone, so `tick.ts` can `instanceof` it without importing a channel. |
| `apps/crier/src/channels/x.ts` | **Create.** `buildXText` (the 280-char fit), `buildAuthHeader` (OAuth 1.0a), `postToX`. |
| `apps/crier/src/config.ts` | **Modify.** Four new env vars → one `x: XCredentials \| null` field. |
| `apps/crier/src/tick.ts` | **Modify.** Enable `x`; explicit per-channel dispatch; `RateLimitError` → end the tick without recording a failure. |
| `apps/crier/src/main.ts` | **Modify.** Supply the `nonce` dep; warn when no channel is configured. |
| `apps/crier/test/channels.test.ts` | **Modify.** X body-fit branches, auth header, error mapping. |
| `apps/crier/test/config.test.ts` | **Modify.** All-four-or-off. |
| `apps/crier/test/tick.test.ts` | **Modify.** Routing, and the 429 path. |
| `docs/crier-x-setup.md` | **Create.** One-time operator setup. |
| `apps/crier/README.md` | **Modify.** Env table, operations. |
| `CHANGELOG.md` | **Modify.** Unreleased entry. |

---

### Task 1: The post body — `RateLimitError` and the 280-character fit

The only genuinely new logic in the feature, and the part with real branches. Built first so Task 2's poster has a body to send.

**Files:**
- Create: `apps/crier/src/rate-limit.ts`
- Create: `apps/crier/src/channels/x.ts`
- Test: `apps/crier/test/channels.test.ts` (append a new `describe`)

**Interfaces:**
- Consumes: `ObituaryPost` from `apps/crier/src/post.ts` — `{ headline: string; lede: string; url: string }`.
- Produces:
  - `class RateLimitError extends Error` (from `src/rate-limit.ts`)
  - `buildXText(post: ObituaryPost): string` (from `src/channels/x.ts`)

- [ ] **Step 1: Write the failing tests**

Append to `apps/crier/test/channels.test.ts`. Add `buildXText` to the import list at the top of the file:

```ts
import { buildXText } from "../src/channels/x.js";
```

Then append:

```ts
describe("x post body", () => {
  const url = "https://dayzonelife.com/obituaries/ronaldraygun552-7";
  // X counts every URL as 23 characters regardless of length, so the real string's length
  // is irrelevant to the budget — these tests assert against the 23-char accounting.
  const weighted = (text: string): number => Array.from(text).length - Array.from(url).length + 23;

  it("posts headline, lede and url in full when they fit — identical to the discord body", () => {
    expect(buildXText(post)).toBe(
      "RonaldRaygun552's Seventh Sakhal File Closes\n\nHe simply stopped being alive.\n\nhttps://dayzonelife.com/obituaries/ronaldraygun552-7",
    );
  });

  it("trims a long lede at a whole-word boundary and marks it with an ellipsis", () => {
    // headline is 44 code points, so the lede budget is 253 - 44 = 209.
    // A 299-char lede of 60 "word"s trims to the 41 whole words that fit (204 chars) + "…".
    const long = { ...post, lede: Array(60).fill("word").join(" ") };
    const text = buildXText(long);
    expect(text).toBe(`${post.headline}\n\n${Array(41).fill("word").join(" ")}…\n\n${url}`);
    expect(weighted(text)).toBeLessThanOrEqual(280);
  });

  it("never splits a word", () => {
    const long = { ...post, lede: Array(60).fill("word").join(" ") };
    const lede = buildXText(long).split("\n\n")[1]!;
    expect(lede.replace("…", "").split(" ").every((w) => w === "word")).toBe(true);
  });

  it("drops the lede entirely when the fragment that would fit is under 24 characters", () => {
    // A 240-char headline leaves 13 for the lede — too little to say anything.
    const cramped = { ...post, headline: "h".repeat(240) };
    const text = buildXText(cramped);
    expect(text).toBe(`${"h".repeat(240)}\n\n${url}`);
    expect(text).not.toContain("…");
    expect(weighted(text)).toBeLessThanOrEqual(280);
  });

  it("truncates a headline that alone exceeds the budget, and drops the lede", () => {
    const huge = { ...post, headline: "h".repeat(300) };
    const text = buildXText(huge);
    expect(text).toBe(`${"h".repeat(252)}…\n\n${url}`);
    expect(weighted(text)).toBeLessThanOrEqual(280);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @onelife/crier run test`
Expected: FAIL — cannot resolve `../src/channels/x.js`.

- [ ] **Step 3: Write `src/rate-limit.ts`**

```ts
/** A 429 from a channel: throttling, NOT failure.
 *
 *  ⚠️ The tick must not call recordFailure for this — burning one of the 5 attempts on a rate
 *  limit would permanently poison every row a backfill touches, since CRIER_BATCH_CAP (10 per
 *  60s tick) runs ~150 posts per 15 minutes against X's ceiling of 100. The attempt budget is
 *  reserved for real errors like a revoked key. */
export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}
```

- [ ] **Step 4: Write the body-builder in `src/channels/x.ts`**

```ts
import type { ObituaryPost } from "../post.js";

/** ⚠️ X counts EVERY url as 23 characters, whatever its actual length (t.co wrapping), so the
 *  budget is fixed and does not vary with the slug. 280 - 23 - 4 (two "\n\n") = 253 for the
 *  headline and lede together. */
const TEXT_BUDGET = 280 - 23 - 4;

/** Below this, a trimmed lede says nothing worth the characters — drop it and let the OG card
 *  carry the story rather than posting a headline followed by a near-bare ellipsis. */
const MIN_LEDE = 24;

/** Code points, not X's weighted count (which charges 2 for CJK and emoji). The copy is English
 *  and the budget carries margin — a deliberate simplification, not an oversight. */
const len = (s: string): number => Array.from(s).length;
const cut = (s: string, n: number): string => Array.from(s).slice(0, n).join("");

/** Trim to `budget` code points INCLUDING the ellipsis, cutting at the last whole word. */
function trimToWord(s: string, budget: number): string {
  const slice = cut(s, budget - 1);
  const lastSpace = slice.lastIndexOf(" ");
  const body = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
  return `${body.replace(/[\s,;:.!?-]+$/u, "")}…`;
}

/** Unlike Facebook — where the url rides in a separate `link` field and length never binds —
 *  on X the url must be in the post text, so the body has to be made to fit 280. */
export function buildXText(post: ObituaryPost): string {
  const join = (...parts: string[]): string => parts.join("\n\n");
  if (len(post.headline) > TEXT_BUDGET) return join(trimToWord(post.headline, TEXT_BUDGET), post.url);

  const ledeBudget = TEXT_BUDGET - len(post.headline);
  if (len(post.lede) <= ledeBudget) return join(post.headline, post.lede, post.url);
  if (ledeBudget < MIN_LEDE) return join(post.headline, post.url);
  return join(post.headline, trimToWord(post.lede, ledeBudget), post.url);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @onelife/crier run test`
Expected: PASS — all five new cases, plus the existing discord and facebook suites still green.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @onelife/crier run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/crier/src/rate-limit.ts apps/crier/src/channels/x.ts apps/crier/test/channels.test.ts
git commit -m "feat(crier): fit an obituary into an X post, and a typed rate-limit error"
```

---

### Task 2: OAuth 1.0a signing and `postToX`

**Files:**
- Modify: `apps/crier/src/channels/x.ts`
- Test: `apps/crier/test/channels.test.ts`

**Interfaces:**
- Consumes: `buildXText` and `RateLimitError` from Task 1.
- Produces:
  - `type XCredentials = { apiKey: string; apiSecret: string; accessToken: string; accessSecret: string }`
  - `buildAuthHeader(creds: XCredentials, nonce: string, timestamp: number, url?: string): string`
  - `postToX(fetchFn: typeof fetch, creds: XCredentials, post: ObituaryPost, nonce: string, timestamp: number): Promise<void>`

`nonce` and `timestamp` are parameters rather than generated internally so a test can pin the exact header — the same reason `now` is already a dep in `CrierDeps`.

- [ ] **Step 1: Write the failing tests**

Extend the import in `apps/crier/test/channels.test.ts`:

```ts
import { buildXText, buildAuthHeader, postToX, type XCredentials } from "../src/channels/x.js";
import { RateLimitError } from "../src/rate-limit.js";
```

Append:

```ts
describe("x channel", () => {
  // Distinctive multi-character values on purpose: the secrets are asserted ABSENT from the
  // header, and a two-letter sentinel like "cs" could appear by chance inside a base64
  // signature and make the test flaky.
  const creds: XCredentials = {
    apiKey: "consumer-key", apiSecret: "SECRET-consumer",
    accessToken: "access-token", accessSecret: "SECRET-access",
  };

  it("builds an OAuth 1.0a header carrying the public params and never the secrets", () => {
    const header = buildAuthHeader(creds, "nonce123", 1_754_000_000);
    expect(header).toMatch(/^OAuth /);
    expect(header).toContain('oauth_consumer_key="consumer-key"');
    expect(header).toContain('oauth_nonce="nonce123"');
    expect(header).toContain('oauth_signature_method="HMAC-SHA1"');
    expect(header).toContain('oauth_timestamp="1754000000"');
    expect(header).toContain('oauth_token="access-token"');
    expect(header).toContain('oauth_version="1.0"');
    expect(header).toMatch(/oauth_signature="[^"]+"/);
    // The two secrets are signing keys — they must never be transmitted.
    expect(header).not.toContain("SECRET-consumer");
    expect(header).not.toContain("SECRET-access");
  });

  it("signs deterministically, and a different nonce yields a different signature", () => {
    const a = buildAuthHeader(creds, "nonce123", 1_754_000_000);
    expect(buildAuthHeader(creds, "nonce123", 1_754_000_000)).toBe(a);
    expect(buildAuthHeader(creds, "nonce999", 1_754_000_000)).not.toBe(a);
    expect(buildAuthHeader(creds, "nonce123", 1_754_000_001)).not.toBe(a);
  });

  it("POSTs JSON to /2/tweets with the fitted text and the signature in the header", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('{"data":{"id":"1"}}', { status: 201 }));
    await postToX(fetchFn, creds, post, "nonce123", 1_754_000_000);
    const [calledUrl, init] = fetchFn.mock.calls[0]!;
    expect(calledUrl).toBe("https://api.x.com/2/tweets");
    expect(init.method).toBe("POST");
    expect(init.headers["content-type"]).toBe("application/json");
    expect(init.headers.authorization).toBe(buildAuthHeader(creds, "nonce123", 1_754_000_000));
    expect(JSON.parse(init.body)).toEqual({ text: buildXText(post) });
    // Credentials must never reach the query string, where proxies log them.
    expect(String(calledUrl)).not.toContain("consumer-key");
    expect(String(calledUrl)).not.toContain("?");
  });

  it("throws RateLimitError — not a plain Error — on a 429", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("Too Many Requests", { status: 429 }));
    await expect(postToX(fetchFn, creds, post, "n", 1)).rejects.toBeInstanceOf(RateLimitError);
  });

  it("throws a plain Error with status and body text on any other non-2xx", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('{"title":"Unauthorized"}', { status: 401 }));
    const err = await postToX(fetchFn, creds, post, "n", 1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(RateLimitError);
    expect((err as Error).message).toMatch(/401.*Unauthorized/s);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @onelife/crier run test`
Expected: FAIL — `buildAuthHeader` and `postToX` are not exported.

- [ ] **Step 3: Add the signing and poster code to `src/channels/x.ts`**

Add this import at the top of the file:

```ts
import { createHmac } from "node:crypto";
import { RateLimitError } from "../rate-limit.js";
```

Append to the file:

```ts
const TWEETS_URL = "https://api.x.com/2/tweets";

export type XCredentials = {
  apiKey: string; apiSecret: string; accessToken: string; accessSecret: string;
};

/** RFC 3986 percent-encoding. ⚠️ Stricter than encodeURIComponent, which leaves !*'() alone —
 *  and an under-escaped signature base string produces a valid-looking header that 401s. */
const enc = (s: string): string =>
  encodeURIComponent(s).replace(/[!*'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** OAuth 1.0a, chosen because these four credentials never expire — operationally identical to
 *  the Facebook page token. OAuth 2.0's refresh token rotates on every use and would need
 *  durable storage plus a manual browser re-auth whenever a write raced.
 *
 *  ⚠️ The request body is JSON and there is no query string, so ONLY the oauth_* params are
 *  signed. Including the body here (as a form-encoded request would) yields a 401. */
export function buildAuthHeader(
  creds: XCredentials, nonce: string, timestamp: number, url: string = TWEETS_URL,
): string {
  const params: Record<string, string> = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(timestamp),
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };
  const pairs = (o: Record<string, string>): string[] =>
    Object.keys(o).sort().map((k) => `${enc(k)}=${enc(o[k]!)}`);
  const base = ["POST", enc(url), enc(pairs(params).join("&"))].join("&");
  const key = `${enc(creds.apiSecret)}&${enc(creds.accessSecret)}`;
  const signature = createHmac("sha1", key).update(base).digest("base64");
  const signed = { ...params, oauth_signature: signature };
  return `OAuth ${Object.keys(signed).sort().map((k) => `${enc(k)}="${enc(signed[k]!)}"`).join(", ")}`;
}

export async function postToX(
  fetchFn: typeof fetch, creds: XCredentials, post: ObituaryPost, nonce: string, timestamp: number,
): Promise<void> {
  const res = await fetchFn(TWEETS_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: buildAuthHeader(creds, nonce, timestamp),
    },
    body: JSON.stringify({ text: buildXText(post) }),
  });
  // 429 is throttling, not failure — a distinct type so the tick can back off without
  // spending one of the row's 5 attempts.
  if (res.status === 429) throw new RateLimitError(`x tweets 429: ${await res.text()}`);
  if (!res.ok) throw new Error(`x tweets ${res.status}: ${await res.text()}`);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @onelife/crier run test`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @onelife/crier run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/crier/src/channels/x.ts apps/crier/test/channels.test.ts
git commit -m "feat(crier): sign X requests with OAuth 1.0a and post to /2/tweets"
```

---

### Task 3: Config — four vars, all or nothing

**Files:**
- Modify: `apps/crier/src/config.ts`
- Test: `apps/crier/test/config.test.ts`

**Interfaces:**
- Consumes: `XCredentials` from Task 2.
- Produces: `Config.x: XCredentials | null`. Task 4 reads this.

A single nullable object rather than four flat fields: it makes the all-or-nothing rule structural (there is no way to represent a half-set), and it is exactly what `postToX` already takes.

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe("crier config")` block in `apps/crier/test/config.test.ts`:

```ts
  it("enables x only when all four credentials are present", () => {
    const all = {
      CRIER_X_API_KEY: "ck", CRIER_X_API_SECRET: "cs",
      CRIER_X_ACCESS_TOKEN: "at", CRIER_X_ACCESS_SECRET: "as",
    };
    expect(loadConfig({ ...base }).x).toBeNull();
    expect(loadConfig({ ...base, ...all }).x).toEqual({
      apiKey: "ck", apiSecret: "cs", accessToken: "at", accessSecret: "as",
    });
    // Every single omission must leave the channel off — half a credential set never half-posts.
    for (const k of Object.keys(all)) {
      const partial = { ...all, [k]: undefined };
      expect(loadConfig({ ...base, ...partial }).x, `missing ${k}`).toBeNull();
    }
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @onelife/crier run test`
Expected: FAIL — `Property 'x' does not exist on type 'Config'`.

- [ ] **Step 3: Modify `src/config.ts`**

Add to the zod `schema` object, after `CRIER_FB_PAGE_ACCESS_TOKEN`:

```ts
  CRIER_X_API_KEY: z.string().optional(),
  CRIER_X_API_SECRET: z.string().optional(),
  CRIER_X_ACCESS_TOKEN: z.string().optional(),
  CRIER_X_ACCESS_SECRET: z.string().optional(),
```

Add this import at the top:

```ts
import type { XCredentials } from "./channels/x.js";
```

Add to the `Config` type, after the `fbPageId` line:

```ts
  x: XCredentials | null;
```

And in `loadConfig`, after the `fbEnabled` line:

```ts
  // X needs ALL FOUR credentials; anything less stays disabled rather than half-posting.
  const x: XCredentials | null =
    p.CRIER_X_API_KEY && p.CRIER_X_API_SECRET && p.CRIER_X_ACCESS_TOKEN && p.CRIER_X_ACCESS_SECRET
      ? {
          apiKey: p.CRIER_X_API_KEY, apiSecret: p.CRIER_X_API_SECRET,
          accessToken: p.CRIER_X_ACCESS_TOKEN, accessSecret: p.CRIER_X_ACCESS_SECRET,
        }
      : null;
```

Then add `x,` to the returned object, after `fbPageAccessToken`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @onelife/crier run test`
Expected: FAIL in `tick.test.ts` only — its `cfg()` helper builds a `Config` literal that now lacks `x`. Add `x: null,` to that helper (after the `fbPageAccessToken` line) and re-run. Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @onelife/crier run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/crier/src/config.ts apps/crier/test/config.test.ts apps/crier/test/tick.test.ts
git commit -m "feat(crier): read the four X credentials, all-or-nothing"
```

---

### Task 4: Tick wiring — routing and the 429 path

**Files:**
- Modify: `apps/crier/src/tick.ts`
- Modify: `apps/crier/src/main.ts`
- Test: `apps/crier/test/tick.test.ts`

**Interfaces:**
- Consumes: `postToX` (Task 2), `RateLimitError` (Task 1), `Config.x` (Task 3).
- Produces: `CrierDeps.nonce: () => string` — one new dep. The OAuth timestamp is derived from the existing `deps.now`, so no second one is needed.

⚠️ **The highest-risk line in this feature.** The dispatch today ends `else await postToFacebook(...)`. Adding a third channel to an `if/else` whose final arm is a specific channel means any unrecognized channel posts to Facebook. This task replaces it with one explicit arm per channel and a `throw` default, so no channel can ever be mis-routed — in either direction.

- [ ] **Step 1: Write the failing tests**

In `apps/crier/test/tick.test.ts`, add to the `cfg()` helper (after `fbPageAccessToken`):

```ts
  x: { apiKey: "ck", apiSecret: "cs", accessToken: "at", accessSecret: "as" },
```

Add to the `deps()` helper, after `sleep`:

```ts
    nonce: () => "nonce123",
```

Add this import:

```ts
import { RateLimitError } from "../src/rate-limit.js";
```

Then append inside `describe("crierTick")`:

```ts
  it("routes an x target to the X API and NOT to facebook", async () => {
    const d = deps();
    d.store.findSyndicationTargets = vi.fn().mockResolvedValue([target("a", "x")]);
    const r = await crierTick(db, d);
    expect(r.posted).toBe(1);
    const urls = (d.fetchFn as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(urls).toEqual(["https://api.x.com/2/tweets"]);
    expect(urls.join()).not.toContain("facebook");
    expect(d.store.recordSuccess).toHaveBeenCalledWith(db, "a", "x", d.now);
  });

  it("records a failure for an unrecognized channel rather than posting it somewhere", async () => {
    const d = deps();
    d.store.findSyndicationTargets = vi.fn().mockResolvedValue([target("a", "mastodon")]);
    const r = await crierTick(db, d);
    expect(r.failed).toBe(1);
    expect(d.fetchFn).not.toHaveBeenCalled();
    expect(d.store.recordFailure).toHaveBeenCalledWith(db, "a", "mastodon", expect.stringContaining("mastodon"));
  });

  it("a 429 ends the tick WITHOUT burning an attempt, leaving later targets for the next tick", async () => {
    const d = deps();
    d.fetchFn = vi.fn(async (url: RequestInfo | URL) =>
      String(url).includes("api.x.com")
        ? new Response("Too Many Requests", { status: 429 })
        : new Response(null, { status: 204 }),
    ) as unknown as typeof fetch;
    d.store.findSyndicationTargets = vi.fn()
      .mockResolvedValue([target("a", "x"), target("b", "x"), target("c", "discord")]);
    const r = await crierTick(db, d);
    // The rate-limited row is neither posted nor failed — its attempts are untouched, so a
    // backfill self-paces instead of poisoning every row it touches.
    expect(r.posted).toBe(0);
    expect(r.failed).toBe(0);
    expect(d.store.recordFailure).not.toHaveBeenCalled();
    expect(d.store.recordSuccess).not.toHaveBeenCalled();
    // break, not continue: the rest of the batch is doomed too, so nothing else is attempted.
    expect((d.fetchFn as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    expect(d.log.warn).toHaveBeenCalled();
  });

  it("still records a failure for a non-429 x error, and still posts the other channel", async () => {
    const d = deps();
    d.fetchFn = vi.fn(async (url: RequestInfo | URL) =>
      String(url).includes("api.x.com")
        ? new Response("Unauthorized", { status: 401 })
        : new Response(null, { status: 204 }),
    ) as unknown as typeof fetch;
    d.store.findSyndicationTargets = vi.fn().mockResolvedValue([target("a", "x"), target("a", "discord")]);
    const r = await crierTick(db, d);
    expect(r.failed).toBe(1);
    expect(r.posted).toBe(1);
    expect(d.store.recordFailure).toHaveBeenCalledWith(db, "a", "x", expect.stringContaining("401"));
    expect(d.store.recordSuccess).toHaveBeenCalledWith(db, "a", "discord", d.now);
  });

  it("includes x in the channel list when its credentials are present", async () => {
    const d = deps();
    await crierTick(db, d);
    expect(d.store.findSyndicationTargets).toHaveBeenCalledWith(db, {
      channels: ["discord", "facebook", "x"], since: cfg().since, maxAttempts: 5, limit: 10,
    });
  });
```

Also update the existing `"does nothing when no channel is configured"` test to null out X too, or it will no longer exercise the empty case:

```ts
    const d = deps({ cfg: cfg({ discordWebhookUrl: null, fbPageId: null, fbPageAccessToken: null, x: null }) });
```

And the existing `"passes the enabled channel list…"` test, which asserts `channels: ["discord"]`:

```ts
    const d = deps({ cfg: cfg({ fbPageId: null, fbPageAccessToken: null, x: null }) });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @onelife/crier run test`
Expected: FAIL — `nonce` is not a property of `CrierDeps`, and the x target posts to Facebook.

- [ ] **Step 3: Modify `src/tick.ts`**

Add the imports:

```ts
import { postToX } from "./channels/x.js";
import { RateLimitError } from "./rate-limit.js";
```

Add to `CrierDeps`, after `sleep`:

```ts
  /** OAuth 1.0a nonce factory. Injected so a test can pin the signed header; the paired
   *  timestamp comes from `now`, which is already a dep. */
  nonce: () => string;
```

In the channel-enabling block, after the facebook line:

```ts
  if (cfg.x) channels.push("x");
```

Replace the dispatch inside the `try`:

```ts
      // ⚠️ One explicit arm per channel, and a throw for anything else. This used to end in a
      // bare `else await postToFacebook(...)`, which would silently post every X row to
      // Facebook the moment a third channel existed. Never reintroduce a catch-all arm.
      if (t.channel === "discord") await postToDiscord(deps.fetchFn, cfg.discordWebhookUrl!, post);
      else if (t.channel === "facebook") await postToFacebook(deps.fetchFn, cfg.fbPageId!, cfg.fbPageAccessToken!, post);
      else if (t.channel === "x") await postToX(deps.fetchFn, cfg.x!, post, deps.nonce(), Math.floor(deps.now.getTime() / 1000));
      else throw new Error(`unknown channel ${t.channel}`);
```

And extend the `catch`, as its first statement:

```ts
      // Throttling, not failure: do NOT record an attempt, and stop the tick — the rest of the
      // batch would be rate-limited too. The next tick resumes, so a backfill self-paces.
      if (err instanceof RateLimitError) {
        deps.log.warn({ slug: t.slug, channel: t.channel }, "rate limited — ending tick, attempts untouched");
        break;
      }
```

**Revised during implementation: per-channel pause, not a whole-tick `break`.** Review caught
that ending the whole tick on a 429 starves the *other* channels — since a rate-limited row's
attempts are deliberately never burned, it sits at the head of every future batch for as long as
X stays 429'd (weeks, on a monthly cap), and `break`ing on that row would silently halt Discord
and Facebook too. The shipped code instead tracks 429'd channels in a per-tick `Set<string>`:
hitting one adds its channel to the set and `continue`s (not `break`s), so later targets on other
channels in the same tick keep posting; only the throttled channel is skipped for the rest of
the tick. See `apps/crier/src/tick.ts` for the actual implementation.

- [ ] **Step 4: Modify `src/main.ts`**

Add the import:

```ts
import { randomBytes } from "node:crypto";
```

Change the no-credentials warning line to account for X:

```ts
  if (!cfg.discordWebhookUrl && !cfg.fbPageId && !cfg.x) log.warn("no channel credentials configured — nothing to post to");
```

And pass the new dep in the `crierTick` call:

```ts
      const r = await crierTick(db, { cfg, fetchFn: fetch, now: new Date(), log, store, sleep, nonce: () => randomBytes(16).toString("hex") });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @onelife/crier run test`
Expected: PASS — the whole crier suite.

- [ ] **Step 6: Typecheck the workspace**

Run: `pnpm turbo run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/crier/src/tick.ts apps/crier/src/main.ts apps/crier/test/tick.test.ts
git commit -m "feat(crier): route obituaries to X, and back off on a 429 without burning an attempt"
```

---

### Task 5: Operator docs and the changelog

**Files:**
- Create: `docs/crier-x-setup.md`
- Modify: `apps/crier/README.md`
- Modify: `CHANGELOG.md`

No code and no tests — this is the task that makes the feature deployable, and the changelog entry the repo's CI gate requires.

- [ ] **Step 1: Write `docs/crier-x-setup.md`**

```markdown
# X (Twitter) setup for crier

One-time setup to let crier post to the DayZ One Life X account. Prereq: you are logged in as
that account.

## ⚠️ It costs money

There is **no free tier** — X discontinued it in February 2026 and new developer accounts are
pay-per-use. Worse, in April 2026 X began charging **$0.20 for a post containing a link**,
versus $0.015 for a plain one. Every crier post carries an obituary URL, so **every X post
costs $0.20.** There is no way around it: moving the link into a self-reply just makes the
reply the link post.

Budget accordingly — and see "Rollout" below, which prices the first run before it happens.

## Steps

1. **Create the app**: https://developer.x.com → Developer Portal → create a project and app.
2. **Load credits**: Developer Console → Billing. No call succeeds until there is a balance.
   Set a low auto-recharge trigger so a runaway cannot spend much.
3. **Set app permissions to Read and Write.** Default is read-only, and posting will 403
   until you change it.
4. **⚠️ Regenerate the access token AFTER changing permissions.** A token minted while the app
   was read-only stays read-only forever, no matter what the app settings say afterwards. This
   is the single most common setup failure.
5. **Copy the four credentials** from Keys and Tokens:
   - API Key → `CRIER_X_API_KEY`
   - API Key Secret → `CRIER_X_API_SECRET`
   - Access Token → `CRIER_X_ACCESS_TOKEN`
   - Access Token Secret → `CRIER_X_ACCESS_SECRET`

   They do not expire. Copy them on your own machine, not the server, and prefix any shell
   command with a space so it stays out of history (with `HISTCONTROL=ignorespace`).
6. **Set all four env vars** on the server and restart crier — dry-run first, see Rollout.

## Rollout

`CRIER_DRY_RUN` defaults ON and logs one `dry-run: would post` line per row. Since X shares
`CRIER_SINCE` with the other channels and the ledger has no `x` rows yet, **the first live run
replays the entire back catalogue** to the account, oldest death first, 10 per 60s tick. That
is intended for a fresh timeline — but price it first:

1. Set the four vars, restart with dry-run still on.
2. Count the `would post` lines for channel `x`. Multiply by $0.20. That is the backfill bill.
3. Set `CRIER_DRY_RUN=false`, restart.
4. Watch for `rate limited — pausing this channel` warnings. These are expected and harmless
   during a backfill: X allows 100 posts per 15 minutes and crier runs faster than that, so X
   pauses for the rest of each tick while Discord and Facebook keep posting, and the X backfill
   drains over successive ticks without consuming any row's attempt budget.

   *(Note: as actually shipped — see `docs/crier-x-setup.md` and `apps/crier/README.md` for the
   corrected wording; this plan step predates the per-channel-pause revision above.)*

## If posting fails

- **403** — the app is read-only, or the token predates the permission change. Redo steps 3–4.
- **401** — a credential is wrong, or the server clock has drifted (OAuth 1.0a signatures carry
  a timestamp). Check `timedatectl` before re-minting keys.
- **Payment required / 402** — credits are exhausted.

After fixing the cause, revive the poisoned rows: see `apps/crier/README.md` Operations.
```

- [ ] **Step 2: Update `apps/crier/README.md`**

Change the opening line to name the third channel:

```markdown
Posts every published obituary to the configured channels (Discord webhook, Facebook Page,
X account), exactly once per (obituary, channel), recorded in the durable `syndications` table.
```

Add to the env table, after the Facebook row:

```markdown
| `CRIER_X_API_KEY` + `_API_SECRET` + `_ACCESS_TOKEN` + `_ACCESS_SECRET` | presence of ALL FOUR enables X — see `docs/crier-x-setup.md`. ⚠️ every X post costs $0.20 because it carries a link |
```

Add to Operations:

```markdown
- The revive query takes the channel name: `UPDATE syndications SET attempts = 0 WHERE channel = 'x' AND posted_at IS NULL;`
- A `rate limited — pausing this channel` warning is not an error. X allows 100 posts per 15
  minutes; crier pauses only that channel for the rest of the tick — Discord and Facebook keep
  posting — without recording an attempt, and resumes it on the next tick 60s later, so a
  backfill paces itself. Rows are never poisoned by throttling.
```

*(As with the Rollout step above, this Task 5 text predates the per-channel-pause revision noted
in Task 4; see the actual `docs/crier-x-setup.md` and `apps/crier/README.md` for the corrected
wording.)*

- [ ] **Step 3: Add the changelog entry**

Under `## [Unreleased]` in `CHANGELOG.md` — user-facing, in the repo's established voice:

```markdown
### Added

- Obituaries now post to X as well as Discord and Facebook. Each one goes out once, trimmed to
  fit X's 280 characters at a word boundary, with the obituary card unfurling underneath. The
  channel stays switched off until all four X credentials are set — see `docs/crier-x-setup.md`,
  which also covers what it costs, since X charges $0.20 for every post that carries a link.
```

- [ ] **Step 4: Run the full suite and typecheck**

Run: `pnpm turbo run test --concurrency=1 && pnpm turbo run typecheck`
Expected: PASS. (DB suites need `TEST_DATABASE_URL`; crier's own suite does not.)

- [ ] **Step 5: Commit**

```bash
git add docs/crier-x-setup.md apps/crier/README.md CHANGELOG.md
git commit -m "docs(crier): X setup, rollout pricing, and the changelog entry"
```

---

## Verification before the PR

- [ ] `pnpm turbo run test --concurrency=1` passes.
- [ ] `pnpm turbo run typecheck` passes.
- [ ] `grep -rn "postToFacebook" apps/crier/src/tick.ts` shows it reachable **only** from the `t.channel === "facebook"` arm.
- [ ] `CHANGELOG.md` has an Unreleased entry, committed.
- [ ] Then `keel:finish-work`.

## Deliberately not verified by this plan

A live post to X cannot be tested without real credentials and real spend. These stay open
until the operator runs the rollout:

- That the OAuth 1.0a signature is accepted by X at all. Every test here is structural —
  determinism, field presence, secrets absent — because a correct HMAC cannot be asserted
  without a golden value from the real service. **A 401 on the first live attempt is the
  expected failure mode if signing is wrong**, and step 4 of the setup doc's troubleshooting
  is the first thing to check.
- That the obituary URL actually unfurls into the OG card on X.
- That a trimmed lede reads well at the cut point on a real post.
