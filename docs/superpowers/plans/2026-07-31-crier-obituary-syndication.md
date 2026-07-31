# Crier Obituary Syndication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new `apps/crier` worker that posts every published obituary to a Discord webhook and a Facebook Page, exactly once per channel, dry-run by default.

**Architecture:** Tick-loop worker in the `notifier`/`newsdesk` mold over the shared Postgres. A durable `syndications` table (`UNIQUE(slug, channel)`) is the delivery ledger; targets are `articles` rows (`kind='obituary'`, `status='published'`) with `death_at > CRIER_SINCE` lacking a successful row for an enabled channel. Channels are pure payload builders + a fetch POST; each degrades independently.

**Tech Stack:** TS/ESM, Drizzle, zod, pino, vitest (`@onelife/test-support` for the DB suite), no new external deps.

**Spec:** `docs/superpowers/specs/2026-07-31-crier-obituary-syndication-design.md`

## Global Constraints

- Branch: `feature/crier-obituary-syndication` (already checked out; spec committed on it).
- `CRIER_DRY_RUN` unset/junk ⇒ dry-run ON (`!== "false"` idiom); `CRIER_SINCE` unset/unparseable ⇒ worker does nothing. Never an epoch default.
- The `syndications` table is **durable**: it must NEVER appear in `REBUILD_TRUNCATE_TABLES` (`apps/projector/src/rebuild.ts`), and it references no projection table (no FK to `articles` — join by slug).
- ⚠️ Migration journal: the new entry's `when` MUST exceed `1786170000000` (entry 0032's fabricated future timestamp) or drizzle-kit silently applies nothing. Verify by table existence, never by CLI success output.
- ⚠️ `drizzle-kit` reads `DATABASE_URL` only. Migrate the test DB with `DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @onelife/db run db:migrate`.
- Message body on both channels is exactly `{headline}\n\n{lede}\n\n{url}`; Facebook's `message` param carries `{headline}\n\n{lede}` with the URL passed separately as `link`.
- Facebook Graph endpoint: `https://graph.facebook.com/v21.0/{pageId}/feed`, form-encoded body, token in the body (never the query string, where proxies log it).
- Channel failures are independent: one channel's throw must not skip the other channel or abort the tick.
- Any new env var a test suite reads must be added to `turbo.json`'s `test.env` array.
- Run tests from `apps/crier` (or the touched package) with `pnpm vitest run <file>`; repo-wide: `pnpm turbo run test --concurrency=1`. DB suites need `TEST_DATABASE_URL`. Never source `.env`.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: `syndications` table (schema + migration)

**Files:**
- Modify: `packages/db/src/schema.ts` (append after the `notifications` section)
- Create (generated): `packages/db/drizzle/0033_*.sql` via drizzle-kit
- Modify (generated): `packages/db/drizzle/meta/_journal.json` — verify `when` ordering

**Interfaces:**
- Produces: exported Drizzle table `syndications` with columns `id, slug, channel, postedAt, attempts, lastError, createdAt` and `UNIQUE(slug, channel)`.

- [ ] **Step 1: Add the schema** — append to `packages/db/src/schema.ts`:

```ts
// ── Obituary syndication ledger. Durable: records real external side effects (Discord/Facebook
// posts), so it must survive --rebuild — NEVER list it in REBUILD_TRUNCATE_TABLES. Joins
// `articles` by slug with NO FK: a projector rebuild must neither wipe nor invalidate it.
// One row per (slug, channel); posted_at NULL until the post succeeds; attempts bounds retries.
export const syndications = pgTable("syndications", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  slug: text("slug").notNull(),
  channel: text("channel").notNull(),                 // 'discord' | 'facebook'
  postedAt: timestamp("posted_at", { withTimezone: true }),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqSlugChannel: uniqueIndex("syndications_slug_channel_uniq").on(t.slug, t.channel),
}));
```

- [ ] **Step 2: Generate the migration**

```bash
cd packages/db && DATABASE_URL="${TEST_DATABASE_URL:-postgres://onelife:onelife@localhost:5434/onelife_test}" pnpm run db:generate
```

Expected: a new `drizzle/0033_*.sql` containing `CREATE TABLE "syndications"` and the unique index.

- [ ] **Step 3: Fix the journal `when` if needed** — open `packages/db/drizzle/meta/_journal.json`; the new entry's `when` must be `> 1786170000000`. drizzle-kit stamps wall-clock (`date +%s%3N` ≈ 1785…), which is EARLIER than 0032's fabricated future stamp — so edit the new entry's `when` to `1786180000000`. This is the one sanctioned edit of a generated file here; the journal ordering bug is documented in CLAUDE.md.

- [ ] **Step 4: Migrate the test database and VERIFY the table exists**

```bash
cd ../.. && DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @onelife/db run db:migrate
psql "$TEST_DATABASE_URL" -c '\d syndications'
```

Expected: `\d syndications` prints the table with the `syndications_slug_channel_uniq` unique index. If it prints "did not find any relation", the journal ordering is wrong — return to Step 3.

- [ ] **Step 5: Typecheck** — `pnpm --filter @onelife/db run typecheck` clean.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema.ts packages/db/drizzle
git commit -m "feat(db): syndications ledger for obituary channel posts"
```

---

### Task 2: `apps/crier` scaffold + config

**Files:**
- Create: `apps/crier/package.json`, `apps/crier/tsconfig.json`, `apps/crier/vitest.config.ts`, `apps/crier/src/config.ts`
- Test: `apps/crier/test/config.test.ts`

**Interfaces:**
- Produces: `loadConfig(env): Config` where `Config = { databaseUrl, siteUrl, intervalSeconds, since: Date | null, dryRun: boolean, batchCap, maxAttempts, discordWebhookUrl: string | null, fbPageId: string | null, fbPageAccessToken: string | null, logLevel }`.

- [ ] **Step 1: Scaffold the package** — three files, copied from notifier's shape:

`apps/crier/package.json`:
```json
{
  "name": "@onelife/crier",
  "version": "0.0.0",
  "type": "module",
  "main": "src/main.ts",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "start": "tsx src/main.ts"
  },
  "dependencies": {
    "@onelife/db": "workspace:*",
    "drizzle-orm": "^0.36.0",
    "pino": "^10.3.1",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@onelife/test-support": "workspace:*",
    "postgres": "^3.4.4",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

`apps/crier/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

`apps/crier/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import { GLOBAL_SETUP_PATH } from "@onelife/test-support/setup-path";

export default defineConfig({
  test: { globalSetup: [GLOBAL_SETUP_PATH], fileParallelism: false },
});
```

Then `pnpm install` at the repo root to link the workspace.

- [ ] **Step 2: Write the failing config test** — `apps/crier/test/config.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

const base = { DATABASE_URL: "postgres://x/y" };

describe("crier config", () => {
  it("defaults to dry-run for anything except the literal string false", () => {
    expect(loadConfig({ ...base }).dryRun).toBe(true);
    expect(loadConfig({ ...base, CRIER_DRY_RUN: "0" }).dryRun).toBe(true);
    expect(loadConfig({ ...base, CRIER_DRY_RUN: "FALSE" }).dryRun).toBe(true);
    expect(loadConfig({ ...base, CRIER_DRY_RUN: "false" }).dryRun).toBe(false);
  });

  it("treats unset or unparseable CRIER_SINCE as OFF (null), never an epoch", () => {
    expect(loadConfig({ ...base }).since).toBeNull();
    expect(loadConfig({ ...base, CRIER_SINCE: "not a date" }).since).toBeNull();
    expect(loadConfig({ ...base, CRIER_SINCE: "2026-07-31T00:00:00Z" }).since).toEqual(new Date("2026-07-31T00:00:00Z"));
  });

  it("enables a channel only when its full credential set is present", () => {
    const none = loadConfig({ ...base });
    expect(none.discordWebhookUrl).toBeNull();
    expect(none.fbPageId).toBeNull();
    const half = loadConfig({ ...base, CRIER_FB_PAGE_ID: "123" });
    expect(half.fbPageId).toBeNull(); // page id without token is NOT an enabled channel
    const full = loadConfig({
      ...base,
      CRIER_DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/1/x",
      CRIER_FB_PAGE_ID: "123", CRIER_FB_PAGE_ACCESS_TOKEN: "tok",
    });
    expect(full.discordWebhookUrl).toBe("https://discord.com/api/webhooks/1/x");
    expect(full.fbPageId).toBe("123");
    expect(full.fbPageAccessToken).toBe("tok");
  });

  it("applies defaults: 60s interval, batch cap 10, max attempts 5, prod site URL", () => {
    const c = loadConfig({ ...base });
    expect(c.intervalSeconds).toBe(60);
    expect(c.batchCap).toBe(10);
    expect(c.maxAttempts).toBe(5);
    expect(c.siteUrl).toBe("https://dayzonelife.com");
  });
});
```

- [ ] **Step 3: Run to verify it fails** — from `apps/crier`: `pnpm vitest run test/config.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 4: Implement `src/config.ts`**

```ts
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  SITE_URL: z.string().default("https://dayzonelife.com"),
  CRIER_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
  CRIER_SINCE: z.string().optional(),
  CRIER_DRY_RUN: z.string().optional(),
  CRIER_BATCH_CAP: z.coerce.number().int().positive().default(10),
  CRIER_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  CRIER_DISCORD_WEBHOOK_URL: z.string().optional(),
  CRIER_FB_PAGE_ID: z.string().optional(),
  CRIER_FB_PAGE_ACCESS_TOKEN: z.string().optional(),
  LOG_LEVEL: z.string().default("info"),
});

export type Config = {
  databaseUrl: string; siteUrl: string; intervalSeconds: number;
  since: Date | null; dryRun: boolean; batchCap: number; maxAttempts: number;
  discordWebhookUrl: string | null;
  fbPageId: string | null; fbPageAccessToken: string | null;
  logLevel: string;
};

/** An unset, empty, or unparseable CRIER_SINCE means the worker does nothing — never a silent
 *  epoch default, which would blast every historical obituary into a fresh channel. */
function parseSince(raw: string | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const p = schema.parse(env);
  // Facebook needs BOTH creds; half a credential set stays disabled rather than half-posting.
  const fbEnabled = Boolean(p.CRIER_FB_PAGE_ID && p.CRIER_FB_PAGE_ACCESS_TOKEN);
  return {
    databaseUrl: p.DATABASE_URL,
    siteUrl: p.SITE_URL,
    intervalSeconds: p.CRIER_INTERVAL_SECONDS,
    since: parseSince(p.CRIER_SINCE),
    // SAFE DEFAULT: dry-run unless explicitly disabled with "false". Deliberately NOT an enum —
    // a blank, mis-cased, or junk value must land on the safe side. Mirrors notifier/newsdesk.
    dryRun: p.CRIER_DRY_RUN !== "false",
    batchCap: p.CRIER_BATCH_CAP,
    maxAttempts: p.CRIER_MAX_ATTEMPTS,
    discordWebhookUrl: p.CRIER_DISCORD_WEBHOOK_URL || null,
    fbPageId: fbEnabled ? p.CRIER_FB_PAGE_ID! : null,
    fbPageAccessToken: fbEnabled ? p.CRIER_FB_PAGE_ACCESS_TOKEN! : null,
    logLevel: p.LOG_LEVEL,
  };
}
```

- [ ] **Step 5: Run to verify it passes** — `pnpm vitest run test/config.test.ts`. Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/crier pnpm-lock.yaml
git commit -m "feat(crier): scaffold worker app with config"
```

---

### Task 3: channel modules (Discord + Facebook)

**Files:**
- Create: `apps/crier/src/channels/discord.ts`, `apps/crier/src/channels/facebook.ts`, `apps/crier/src/post.ts`
- Test: `apps/crier/test/channels.test.ts`

**Interfaces:**
- Produces: `type ObituaryPost = { headline: string; lede: string; url: string }` (in `post.ts`, with `postBody(post): string`);
  `buildDiscordPayload(post): { content: string }` and `postToDiscord(fetchFn, webhookUrl, post): Promise<void>` (throws on non-2xx);
  `buildFacebookParams(post): URLSearchParams` (message + link, NO token) and `postToFacebook(fetchFn, pageId, token, post): Promise<void>` (appends token, throws on non-2xx).
- `fetchFn` is the global `fetch` type: `typeof fetch`.

- [ ] **Step 1: Write the failing tests** — `apps/crier/test/channels.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { buildDiscordPayload, postToDiscord } from "../src/channels/discord.js";
import { buildFacebookParams, postToFacebook } from "../src/channels/facebook.js";

const post = {
  headline: "RonaldRaygun552's Seventh Sakhal File Closes",
  lede: "He simply stopped being alive.",
  url: "https://dayzonelife.com/obituaries/ronaldraygun552-7",
};

describe("discord channel", () => {
  it("builds content as headline, lede, url separated by blank lines", () => {
    expect(buildDiscordPayload(post)).toEqual({
      content: "RonaldRaygun552's Seventh Sakhal File Closes\n\nHe simply stopped being alive.\n\nhttps://dayzonelife.com/obituaries/ronaldraygun552-7",
    });
  });

  it("POSTs JSON to the webhook and resolves on 204", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await postToDiscord(fetchFn, "https://discord.test/hook", post);
    expect(fetchFn).toHaveBeenCalledWith("https://discord.test/hook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildDiscordPayload(post)),
    });
  });

  it("throws with status and body text on a non-2xx response", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("rate limited", { status: 429 }));
    await expect(postToDiscord(fetchFn, "https://discord.test/hook", post)).rejects.toThrow(/429.*rate limited/s);
  });
});

describe("facebook channel", () => {
  it("builds message (headline + lede, no url) and link params, without the token", () => {
    const params = buildFacebookParams(post);
    expect(params.get("message")).toBe("RonaldRaygun552's Seventh Sakhal File Closes\n\nHe simply stopped being alive.");
    expect(params.get("link")).toBe(post.url);
    expect(params.has("access_token")).toBe(false);
  });

  it("POSTs form-encoded to the page feed with the token in the body", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('{"id":"1_2"}', { status: 200 }));
    await postToFacebook(fetchFn, "990", "tok-abc", post);
    const [calledUrl, init] = fetchFn.mock.calls[0]!;
    expect(calledUrl).toBe("https://graph.facebook.com/v21.0/990/feed");
    const body = init.body as URLSearchParams;
    expect(body.get("access_token")).toBe("tok-abc");
    expect(body.get("link")).toBe(post.url);
    expect(init.method).toBe("POST");
  });

  it("throws with status and body text on a Graph error", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('{"error":{"message":"expired token"}}', { status: 400 }));
    await expect(postToFacebook(fetchFn, "990", "tok", post)).rejects.toThrow(/400.*expired token/s);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm vitest run test/channels.test.ts`. Expected: FAIL (modules not found).

- [ ] **Step 3: Implement.**

`apps/crier/src/post.ts`:
```ts
export type ObituaryPost = { headline: string; lede: string; url: string };

export const postBody = (p: ObituaryPost): string => `${p.headline}\n\n${p.lede}\n\n${p.url}`;
```

`apps/crier/src/channels/discord.ts`:
```ts
import { postBody, type ObituaryPost } from "../post.js";

export function buildDiscordPayload(post: ObituaryPost): { content: string } {
  return { content: postBody(post) };
}

export async function postToDiscord(fetchFn: typeof fetch, webhookUrl: string, post: ObituaryPost): Promise<void> {
  const res = await fetchFn(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildDiscordPayload(post)),
  });
  if (!res.ok) throw new Error(`discord webhook ${res.status}: ${await res.text()}`);
}
```

`apps/crier/src/channels/facebook.ts`:
```ts
import type { ObituaryPost } from "../post.js";

const GRAPH = "https://graph.facebook.com/v21.0";

/** message carries headline + lede only; the URL rides in `link`, which drives FB's OG unfurl. */
export function buildFacebookParams(post: ObituaryPost): URLSearchParams {
  return new URLSearchParams({ message: `${post.headline}\n\n${post.lede}`, link: post.url });
}

export async function postToFacebook(fetchFn: typeof fetch, pageId: string, token: string, post: ObituaryPost): Promise<void> {
  const body = buildFacebookParams(post);
  // Token in the form body, never the query string — query strings end up in proxy logs.
  body.set("access_token", token);
  const res = await fetchFn(`${GRAPH}/${pageId}/feed`, { method: "POST", body });
  if (!res.ok) throw new Error(`facebook feed ${res.status}: ${await res.text()}`);
}
```

- [ ] **Step 4: Run to verify it passes** — `pnpm vitest run test/channels.test.ts`. Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/crier/src/post.ts apps/crier/src/channels apps/crier/test/channels.test.ts
git commit -m "feat(crier): discord and facebook channel modules"
```

---

### Task 4: `pg-store` (targets query + ledger upserts)

**Files:**
- Create: `apps/crier/src/pg-store.ts`
- Test: `apps/crier/test/pg-store.test.ts`
- Reference (read only): `apps/newsdesk/test/pg-store.test.ts` for the DB-suite seeding style, `packages/db/src/schema.ts` `articles` + `syndications` tables.

**Interfaces:**
- Consumes: `syndications` table (Task 1); `articles` table (existing: `kind`, `status`, `slug`, `headline`, `lede`, `deathAt`).
- Produces:
  `type SyndicationTarget = { slug: string; headline: string; lede: string; channel: string }`;
  `findSyndicationTargets(db, { channels: string[], since: Date, maxAttempts: number, limit: number }): Promise<SyndicationTarget[]>`;
  `recordSuccess(db, slug: string, channel: string, now: Date): Promise<void>`;
  `recordFailure(db, slug: string, channel: string, error: string): Promise<void>`.

- [ ] **Step 1: Write the failing DB-suite test** — `apps/crier/test/pg-store.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { articles, syndications } from "@onelife/db";
import { inArray } from "drizzle-orm";
import { findSyndicationTargets, recordSuccess, recordFailure } from "../src/pg-store.js";

const { db, sql } = getTestDb();
const t0 = new Date("2026-07-31T00:00:00Z");
const hrs = (h: number) => new Date(t0.getTime() + h * 3600_000);
const run = Math.random().toString(36).slice(2, 8);
const slugOf = (n: string) => `crier-${run}-${n}`;
const slugs: string[] = [];

async function seedObit(name: string, over: Partial<typeof articles.$inferInsert> = {}) {
  const slug = slugOf(name);
  slugs.push(slug);
  await db.insert(articles).values({
    kind: "obituary", status: "published", slug,
    headline: `H ${name}`, lede: `L ${name}`, deathAt: hrs(1), ...over,
  });
  return slug;
}

beforeAll(async () => {
  await seedObit("fresh");
  await seedObit("old", { deathAt: hrs(-48) });                       // before since
  await seedObit("failed-stub", { status: "failed", slug: slugOf("failed-stub") });
  await seedObit("posted");
  await seedObit("capped");
  await db.insert(syndications).values([
    { slug: slugOf("posted"), channel: "discord", postedAt: hrs(2), attempts: 1 },
    { slug: slugOf("capped"), channel: "discord", attempts: 5, lastError: "x" },
  ]);
});

afterAll(async () => {
  await db.delete(syndications).where(inArray(syndications.slug, slugs));
  await db.delete(articles).where(inArray(articles.slug, slugs));
  await sql.end();
});

const opts = { channels: ["discord"], since: hrs(0), maxAttempts: 5, limit: 10 };

describe("findSyndicationTargets", () => {
  it("returns published obituaries after since lacking a successful row, per channel", async () => {
    const targets = await findSyndicationTargets(db, opts);
    const mine = targets.filter((t) => t.slug.startsWith(`crier-${run}`));
    expect(mine.map((t) => t.slug)).toEqual([slugOf("fresh")]);
  });

  it("excludes rows at the attempt cap", async () => {
    const targets = await findSyndicationTargets(db, opts);
    expect(targets.some((t) => t.slug === slugOf("capped"))).toBe(false);
  });

  it("excludes non-published and pre-since rows", async () => {
    const targets = await findSyndicationTargets(db, opts);
    expect(targets.some((t) => t.slug === slugOf("failed-stub"))).toBe(false);
    expect(targets.some((t) => t.slug === slugOf("old"))).toBe(false);
  });

  it("returns a target per missing channel", async () => {
    const targets = await findSyndicationTargets(db, { ...opts, channels: ["discord", "facebook"] });
    const fresh = targets.filter((t) => t.slug === slugOf("fresh"));
    expect(fresh.map((t) => t.channel).sort()).toEqual(["discord", "facebook"]);
    // 'posted' was posted to discord only — facebook is still missing:
    const posted = targets.filter((t) => t.slug === slugOf("posted"));
    expect(posted.map((t) => t.channel)).toEqual(["facebook"]);
  });
});

describe("ledger transitions", () => {
  it("failure inserts then increments; success stamps posted_at", async () => {
    const s = slugOf("fresh");
    await recordFailure(db, s, "discord", "boom");
    await recordFailure(db, s, "discord", "boom again");
    let [row] = await db.select().from(syndications).where(inArray(syndications.slug, [s]));
    expect(row!.attempts).toBe(2);
    expect(row!.lastError).toBe("boom again");
    expect(row!.postedAt).toBeNull();
    await recordSuccess(db, s, "discord", hrs(3));
    [row] = await db.select().from(syndications).where(inArray(syndications.slug, [s]));
    expect(row!.postedAt).toEqual(hrs(3));
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `TEST_DATABASE_URL` must be exported; from `apps/crier`: `pnpm vitest run test/pg-store.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/pg-store.ts`**

```ts
import { and, asc, eq, gt, isNull, lt, or, sql as dsql } from "drizzle-orm";
import { articles, syndications, type Database } from "@onelife/db";

export type SyndicationTarget = { slug: string; headline: string; lede: string; channel: string };

/** Published obituaries newer than `since` that an enabled channel has not successfully posted
 *  and has not exhausted (attempts < maxAttempts). One row per (article, missing channel).
 *  Cross join against the channel list, anti-matched on the ledger — the ledger has NO FK to
 *  articles (durable vs projection), so the join is by slug. Oldest death first: a backfill
 *  reads chronologically. */
export async function findSyndicationTargets(
  db: Database,
  opts: { channels: string[]; since: Date; maxAttempts: number; limit: number },
): Promise<SyndicationTarget[]> {
  if (opts.channels.length === 0) return [];
  const ch = dsql`unnest(${dsql.raw(`ARRAY[${opts.channels.map((c) => `'${c.replace(/'/g, "''")}'`).join(",")}]::text[]`)})`;
  const rows = await db
    .select({
      slug: articles.slug,
      headline: articles.headline,
      lede: articles.lede,
      channel: dsql<string>`ch.channel`,
    })
    .from(articles)
    .innerJoin(dsql`(SELECT ${ch} AS channel) AS ch`, dsql`true`)
    .leftJoin(syndications, and(eq(syndications.slug, articles.slug), dsql`${syndications.channel} = ch.channel`))
    .where(and(
      eq(articles.kind, "obituary"),
      eq(articles.status, "published"),
      gt(articles.deathAt, opts.since),
      isNull(syndications.postedAt),
      or(isNull(syndications.attempts), lt(syndications.attempts, opts.maxAttempts)),
    ))
    .orderBy(asc(articles.deathAt))
    .limit(opts.limit);
  return rows.filter((r): r is SyndicationTarget => r.slug !== null && r.headline !== null && r.lede !== null);
}

export async function recordSuccess(db: Database, slug: string, channel: string, now: Date): Promise<void> {
  await db.insert(syndications)
    .values({ slug, channel, postedAt: now, attempts: 1 })
    .onConflictDoUpdate({
      target: [syndications.slug, syndications.channel],
      set: { postedAt: now, attempts: dsql`${syndications.attempts} + 1`, lastError: null },
    });
}

export async function recordFailure(db: Database, slug: string, channel: string, error: string): Promise<void> {
  await db.insert(syndications)
    .values({ slug, channel, attempts: 1, lastError: error })
    .onConflictDoUpdate({
      target: [syndications.slug, syndications.channel],
      set: { attempts: dsql`${syndications.attempts} + 1`, lastError: error },
    });
}
```

Note: if the drizzle `innerJoin`-on-SQL-subquery shape fights the type system, an equivalent per-channel loop (`for (const channel of opts.channels)` running a plain two-table left-join query, concatenating, sorting by `deathAt`, slicing to `limit`) is an acceptable implementation — the TESTS are the contract, not the join strategy. Keep it one round-trip per channel at most.

- [ ] **Step 4: Run to verify it passes** — `pnpm vitest run test/pg-store.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/crier/src/pg-store.ts apps/crier/test/pg-store.test.ts
git commit -m "feat(crier): syndication targets query and ledger upserts"
```

---

### Task 5: the tick

**Files:**
- Create: `apps/crier/src/tick.ts`
- Test: `apps/crier/test/tick.test.ts`

**Interfaces:**
- Consumes: `SyndicationTarget`, store functions (Task 4 signatures), channel post functions (Task 3 signatures), `Config` (Task 2), `obituaryUrl` (Step 3 below).
- Produces: `crierTick(db, deps): Promise<{ posted: number; failed: number; skipped: number; dryRun: boolean }>` with `deps = { cfg: Config, fetchFn: typeof fetch, now: Date, log, store, sleep }` where `store = { findSyndicationTargets, recordSuccess, recordFailure }` and `sleep: (ms: number) => Promise<void>`.

- [ ] **Step 1: Write the failing tests** — `apps/crier/test/tick.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { crierTick, type CrierDeps } from "../src/tick.js";
import type { Config } from "../src/config.js";

const cfg = (over: Partial<Config> = {}): Config => ({
  databaseUrl: "x", siteUrl: "https://dayzonelife.com", intervalSeconds: 60,
  since: new Date("2026-07-31T00:00:00Z"), dryRun: false, batchCap: 10, maxAttempts: 5,
  discordWebhookUrl: "https://discord.test/hook",
  fbPageId: "990", fbPageAccessToken: "tok",
  logLevel: "silent", ...over,
});

const target = (slug: string, channel: string) => ({ slug, headline: `H ${slug}`, lede: `L ${slug}`, channel });

function deps(over: Partial<CrierDeps> = {}): CrierDeps {
  return {
    cfg: cfg(),
    fetchFn: vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    now: new Date("2026-07-31T12:00:00Z"),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    store: {
      findSyndicationTargets: vi.fn().mockResolvedValue([]),
      recordSuccess: vi.fn().mockResolvedValue(undefined),
      recordFailure: vi.fn().mockResolvedValue(undefined),
    },
    sleep: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

const db = {} as never;

describe("crierTick", () => {
  it("does nothing when since is null", async () => {
    const d = deps({ cfg: cfg({ since: null }) });
    const r = await crierTick(db, d);
    expect(r).toEqual({ posted: 0, failed: 0, skipped: 0, dryRun: false });
    expect(d.store.findSyndicationTargets).not.toHaveBeenCalled();
  });

  it("does nothing when no channel is configured", async () => {
    const d = deps({ cfg: cfg({ discordWebhookUrl: null, fbPageId: null, fbPageAccessToken: null }) });
    await crierTick(db, d);
    expect(d.store.findSyndicationTargets).not.toHaveBeenCalled();
  });

  it("dry-run: logs targets, makes zero external calls and zero writes", async () => {
    const d = deps({ cfg: cfg({ dryRun: true }) });
    d.store.findSyndicationTargets = vi.fn().mockResolvedValue([target("a", "discord"), target("a", "facebook")]);
    const r = await crierTick(db, d);
    expect(r).toEqual({ posted: 0, failed: 0, skipped: 2, dryRun: true });
    expect(d.fetchFn).not.toHaveBeenCalled();
    expect(d.store.recordSuccess).not.toHaveBeenCalled();
    expect(d.store.recordFailure).not.toHaveBeenCalled();
  });

  it("posts each target to its channel with the obituary URL and records success", async () => {
    const d = deps();
    d.store.findSyndicationTargets = vi.fn().mockResolvedValue([target("a", "discord"), target("a", "facebook")]);
    const r = await crierTick(db, d);
    expect(r.posted).toBe(2);
    const urls = (d.fetchFn as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(urls).toContain("https://discord.test/hook");
    expect(urls).toContain("https://graph.facebook.com/v21.0/990/feed");
    const discordBody = JSON.parse((d.fetchFn as ReturnType<typeof vi.fn>).mock.calls
      .find((c) => String(c[0]).includes("discord"))![1].body);
    expect(discordBody.content).toContain("https://dayzonelife.com/obituaries/a");
    expect(d.store.recordSuccess).toHaveBeenCalledWith(db, "a", "discord", d.now);
    expect(d.store.recordSuccess).toHaveBeenCalledWith(db, "a", "facebook", d.now);
  });

  it("a discord failure records failure but still posts facebook (independent channels)", async () => {
    const d = deps();
    d.fetchFn = vi.fn(async (url: RequestInfo | URL) =>
      String(url).includes("discord") ? new Response("boom", { status: 500 }) : new Response("{}", { status: 200 }),
    ) as unknown as typeof fetch;
    d.store.findSyndicationTargets = vi.fn().mockResolvedValue([target("a", "discord"), target("a", "facebook")]);
    const r = await crierTick(db, d);
    expect(r.posted).toBe(1);
    expect(r.failed).toBe(1);
    expect(d.store.recordFailure).toHaveBeenCalledWith(db, "a", "discord", expect.stringContaining("500"));
    expect(d.store.recordSuccess).toHaveBeenCalledWith(db, "a", "facebook", d.now);
  });

  it("sleeps between consecutive live posts", async () => {
    const d = deps();
    d.store.findSyndicationTargets = vi.fn().mockResolvedValue([target("a", "discord"), target("b", "discord")]);
    await crierTick(db, d);
    expect(d.sleep).toHaveBeenCalledTimes(1); // between the two posts, not after the last
    expect(d.sleep).toHaveBeenCalledWith(2000);
  });

  it("passes the enabled channel list, cap, attempts and since through to the store", async () => {
    const d = deps({ cfg: cfg({ fbPageId: null, fbPageAccessToken: null }) });
    await crierTick(db, d);
    expect(d.store.findSyndicationTargets).toHaveBeenCalledWith(db, {
      channels: ["discord"], since: cfg().since, maxAttempts: 5, limit: 10,
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm vitest run test/tick.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `src/tick.ts`** (plus the URL helper inside it):

```ts
import type { Database } from "@onelife/db";
import type { Config } from "./config.js";
import type { SyndicationTarget } from "./pg-store.js";
import { postToDiscord } from "./channels/discord.js";
import { postToFacebook } from "./channels/facebook.js";
import type { ObituaryPost } from "./post.js";

/** Mirrors apps/newsdesk obituary-url.ts and apps/web obituaryHref: SITE_URL + /obituaries/slug. */
const obituaryUrl = (siteUrl: string, slug: string): string =>
  `${siteUrl.replace(/\/$/, "")}/obituaries/${slug}`;

export type CrierStore = {
  findSyndicationTargets(db: Database, opts: { channels: string[]; since: Date; maxAttempts: number; limit: number }): Promise<SyndicationTarget[]>;
  recordSuccess(db: Database, slug: string, channel: string, now: Date): Promise<void>;
  recordFailure(db: Database, slug: string, channel: string, error: string): Promise<void>;
};

export type CrierDeps = {
  cfg: Config;
  fetchFn: typeof fetch;
  now: Date;
  log: { info: (obj: unknown, msg?: string) => void; warn: (obj: unknown, msg?: string) => void; error: (obj: unknown, msg?: string) => void };
  store: CrierStore;
  sleep: (ms: number) => Promise<void>;
};

export type CrierResult = { posted: number; failed: number; skipped: number; dryRun: boolean };

/** Pause between consecutive live posts — rate courtesy toward both platforms, and the pacing
 *  that keeps a deliberate backfill (CRIER_SINCE pointed backwards) from flooding a channel. */
const INTER_POST_MS = 2000;

export async function crierTick(db: Database, deps: CrierDeps): Promise<CrierResult> {
  const { cfg } = deps;
  const none: CrierResult = { posted: 0, failed: 0, skipped: 0, dryRun: cfg.dryRun };
  // SINCE gate: unset means OFF — never an epoch default that would blast all history.
  if (cfg.since === null) return none;
  const channels: string[] = [];
  if (cfg.discordWebhookUrl) channels.push("discord");
  if (cfg.fbPageId && cfg.fbPageAccessToken) channels.push("facebook");
  if (channels.length === 0) return none;

  const targets = await deps.store.findSyndicationTargets(db, {
    channels, since: cfg.since, maxAttempts: cfg.maxAttempts, limit: cfg.batchCap,
  });

  let posted = 0, failed = 0, skipped = 0, live = 0;
  for (const t of targets) {
    const post: ObituaryPost = { headline: t.headline, lede: t.lede, url: obituaryUrl(cfg.siteUrl, t.slug) };
    if (cfg.dryRun) {
      skipped++;
      deps.log.info({ slug: t.slug, channel: t.channel, post }, "dry-run: would post");
      continue;
    }
    if (live > 0) await deps.sleep(INTER_POST_MS);
    live++;
    // Channels are independent: a throw here records THIS row's failure and moves on — it must
    // never skip the same article's other channel or abort the tick.
    try {
      if (t.channel === "discord") await postToDiscord(deps.fetchFn, cfg.discordWebhookUrl!, post);
      else await postToFacebook(deps.fetchFn, cfg.fbPageId!, cfg.fbPageAccessToken!, post);
      await deps.store.recordSuccess(db, t.slug, t.channel, deps.now);
      posted++;
      deps.log.info({ slug: t.slug, channel: t.channel }, "posted");
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      await deps.store.recordFailure(db, t.slug, t.channel, msg);
      deps.log.error({ slug: t.slug, channel: t.channel, err: msg }, "post failed");
    }
  }
  return { posted, failed, skipped, dryRun: cfg.dryRun };
}
```

- [ ] **Step 4: Run to verify it passes** — `pnpm vitest run test/tick.test.ts`. Expected: PASS (7 tests). Then the whole app: `pnpm vitest run` — all crier suites pass.

- [ ] **Step 5: Commit**

```bash
git add apps/crier/src/tick.ts apps/crier/test/tick.test.ts
git commit -m "feat(crier): syndication tick with independent channels and dry-run gate"
```

---

### Task 6: main loop, ops wiring, docs, changelog

**Files:**
- Create: `apps/crier/src/main.ts`, `docs/crier-facebook-setup.md`, `apps/crier/README.md`
- Modify: `deploy/deploy.sh:31` (SERVICES array), `docs/architecture/monorepo.md` (app + env listing), `CHANGELOG.md`
- No turbo.json change: crier's suites read only `TEST_DATABASE_URL`/`DATABASE_URL`, already in `test.env`. If any step added a new env var to a test, add it there now.

**Interfaces:**
- Consumes: `loadConfig`, `crierTick`, store module (Tasks 2/4/5).

- [ ] **Step 1: Write `src/main.ts`** (no unit test — it's the same untested composition-root shape as notifier's `main.ts`; the tick carries the logic):

```ts
import pino from "pino";
import { getDb } from "@onelife/db";
import { loadConfig } from "./config.js";
import { crierTick } from "./tick.js";
import * as store from "./pg-store.js";

const cfg = loadConfig(process.env);
const log = pino({ level: cfg.logLevel });
const { db } = getDb(cfg.databaseUrl);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function loop(): Promise<void> {
  log.info({ interval: cfg.intervalSeconds, dryRun: cfg.dryRun, since: cfg.since?.toISOString() ?? null }, "crier starting");
  if (cfg.dryRun) log.warn("CRIER_DRY_RUN is true — nothing will be posted");
  if (!cfg.since) log.warn("CRIER_SINCE is unset — syndication is OFF");
  if (!cfg.discordWebhookUrl && !cfg.fbPageId) log.warn("no channel credentials configured — nothing to post to");

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const r = await crierTick(db, { cfg, fetchFn: fetch, now: new Date(), log, store, sleep });
      if (r.posted || r.failed || r.skipped) log.info(r, "crier tick");
    } catch (err) {
      log.error({ err }, "crier tick failed");
    }
    await sleep(cfg.intervalSeconds * 1000);
  }
}

loop();
```

- [ ] **Step 2: Typecheck + full app suite** — from `apps/crier`: `pnpm typecheck && pnpm vitest run`. Expected: clean, all suites green.

- [ ] **Step 3: Register in the deploy fleet** — in `deploy/deploy.sh`, change line 31:

```bash
SERVICES=(web api verifier enforcer granter rebooter notifier newsdesk crier ingest projector)
```

(crier before ingest/projector: it is a consumer of projections' output like newsdesk, stopped in the same band, started after the projector.) ⚠️ Known self-application caveat, note it in the PR body: the deploy that ships this change runs the PREVIOUS script, which neither stops nor starts a `onelife-crier` unit — harmless, since the unit won't exist until the operator creates it (README below); it is managed from the NEXT deploy onward.

- [ ] **Step 4: Write `apps/crier/README.md`**

```markdown
# crier

Posts every published obituary to the configured channels (Discord webhook, Facebook Page),
exactly once per (obituary, channel), recorded in the durable `syndications` table.

## Env

| Var | Meaning |
| --- | --- |
| `CRIER_DRY_RUN` | default ON; set the literal string `false` to post for real |
| `CRIER_SINCE` | ISO instant; **unset = worker does nothing**. Set to the enablement time to skip history; point it backwards deliberately to backfill (posts pace at one per 2s) |
| `CRIER_DISCORD_WEBHOOK_URL` | presence enables Discord (channel settings → Integrations → Webhooks) |
| `CRIER_FB_PAGE_ID` + `CRIER_FB_PAGE_ACCESS_TOKEN` | presence of BOTH enables Facebook — see `docs/crier-facebook-setup.md` |
| `CRIER_INTERVAL_SECONDS` / `CRIER_BATCH_CAP` / `CRIER_MAX_ATTEMPTS` | 60 / 10 / 5 |
| `DATABASE_URL`, `SITE_URL` | as every worker |

## Operations

- A row at the attempt cap is poisoned and skipped; after fixing the cause (e.g. a new FB
  token), revive with: `UPDATE syndications SET attempts = 0 WHERE channel = 'facebook' AND posted_at IS NULL;`
- Rollout: set `CRIER_SINCE`, leave dry-run on, watch the logs for "dry-run: would post" lines,
  then set `CRIER_DRY_RUN=false`.
- The systemd unit (`onelife-crier`) is created once by the operator, copying any sibling
  worker unit (e.g. `onelife-notifier`) with the ExecStart pointed at `apps/crier`.
```

- [ ] **Step 5: Write `docs/crier-facebook-setup.md`** — the walkthrough (Steve has the Page; app + token needed):

```markdown
# Facebook setup for crier

One-time setup to let crier post to the DayZ One Life Facebook Page. Prereq: you are an admin
of the Page.

1. **Create the app**: https://developers.facebook.com → My Apps → Create App → type
   "Business" → name it (e.g. "One Life Crier"). No review/publishing needed — the app only
   posts to a Page you admin, which works in Development mode.
2. **Get a short-lived User token**: Tools → Graph API Explorer → select the app → Add
   permissions: `pages_manage_posts`, `pages_read_engagement` → Generate Access Token (log in
   as the Page admin).
3. **Exchange for a long-lived User token** (60 days):
   `curl "https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id={APP_ID}&client_secret={APP_SECRET}&fb_exchange_token={SHORT_TOKEN}"`
4. **Get the Page ID and a Page token** (Page tokens minted from a long-lived User token do
   not expire):
   `curl "https://graph.facebook.com/v21.0/me/accounts?access_token={LONG_USER_TOKEN}"`
   → the entry for the Page carries `id` (→ `CRIER_FB_PAGE_ID`) and `access_token`
   (→ `CRIER_FB_PAGE_ACCESS_TOKEN`).
5. **Verify without posting**: `curl "https://graph.facebook.com/v21.0/{PAGE_ID}?fields=name&access_token={PAGE_TOKEN}"`
   should return the Page name.
6. Set both env vars on the server and restart crier (dry-run first — see apps/crier/README.md).

If posting ever 400s with an expired-token error, repeat steps 2–4 and revive the poisoned
rows (README "Operations").
```

- [ ] **Step 6: Update `docs/architecture/monorepo.md`** — add a `crier` line to the apps list, matching the file's existing one-line-per-app format, naming its env vars (`CRIER_DRY_RUN`, `CRIER_SINCE`, `CRIER_DISCORD_WEBHOOK_URL`, `CRIER_FB_PAGE_ID`, `CRIER_FB_PAGE_ACCESS_TOKEN`, `CRIER_INTERVAL_SECONDS`, `CRIER_BATCH_CAP`, `CRIER_MAX_ATTEMPTS`, `DATABASE_URL`, `SITE_URL`). Read the file first and match its style exactly.

- [ ] **Step 7: Changelog** — under `## [Unreleased]`:

```markdown
### Added

- Every published obituary is now announced to Discord (via a channel webhook) and to the
  Facebook Page: headline, lede, and a link that unfurls with the obituary's share card. The
  new `crier` worker posts each obituary exactly once per channel, ships dry-run by default,
  and does nothing until `CRIER_SINCE` is set.
```

- [ ] **Step 8: Repo-wide gate** — from the repo root: `pnpm turbo run test --concurrency=1` and `pnpm turbo run typecheck`. Expected: all green (crier included in both).

- [ ] **Step 9: Commit**

```bash
git add apps/crier deploy/deploy.sh docs/crier-facebook-setup.md docs/architecture/monorepo.md CHANGELOG.md
git commit -m "feat(crier): main loop, fleet registration, setup docs, changelog"
```

Then the controller opens the PR (after the final branch review), noting: migration 0033 (no `--rebuild`), the deploy.sh self-application caveat, and the operator rollout steps (systemd unit, webhook URL, FB token, `CRIER_SINCE`, dry-run watch, then live).
