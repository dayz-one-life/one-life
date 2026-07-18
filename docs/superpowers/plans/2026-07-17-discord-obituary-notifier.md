# Discord Obituary Notifier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When `apps/newsdesk` publishes an obituary, post a plain link to it into a Discord channel via an incoming webhook, with tracked-and-retried delivery so no obituary is silently dropped and the existing back-catalogue drains on first live run.

**Architecture:** Generation and delivery stay separate. `newsdeskTick` is unchanged (publishes `articles` rows with `discord_posted_at = NULL`). A new `notifyDiscord` sweep, called as a sibling in the same `main.ts` loop (its own try/catch), reads *published-but-unposted* obituaries from the table, posts each link, and stamps `discord_posted_at`. Reading delivery state from the table (not the tick's return value) makes the sweep idempotent, self-retrying, and backlog-draining from one code path.

**Tech Stack:** TypeScript ESM (`"type":"module"`), Node 20+ global `fetch` (no node-fetch), Drizzle ORM + Postgres, drizzle-kit migrations, Vitest, pino, zod.

## Global Constraints

Every task's requirements implicitly include these:

- **ESM `.js` extensions** on all relative/workspace imports (e.g. `./config.js`, `../src/discord.js`) — source is `.ts` but imports carry `.js`.
- **Global `fetch`** — Node 20+; do NOT add `node-fetch`/`undici`. Mirror `apps/newsdesk/src/openrouter.ts` (`await fetch(url, {...})`, guard `!res.ok`).
- **pino positional logging**: `log.info(obj, "msg")`, `log.warn("msg")` or `log.warn(obj, "msg")`, `log.error({ err }, "msg")` — object first, message second. Never string-interpolate.
- **`now: Date` is injected** via deps — never call `new Date()` inside a sweep or store function (testability; matches `newsdeskTick`).
- **Dry-run gate is the EXISTING `NEWSDESK_DRY_RUN`** (`cfg.dryRun`, default `true` via `p.NEWSDESK_DRY_RUN !== "false"`). No new dry-run flag. In dry-run the sweep logs `DRY RUN: would post <url>` and neither posts nor stamps.
- **Enable gate** = empty `DISCORD_OBITUARY_WEBHOOK_URL` ⇒ the sweep is a no-op returning `{ posted: 0, failed: 0, disabled: true }`.
- **Migrations are drizzle-kit generated** into `packages/db/drizzle/` — edit `schema.ts`, then `pnpm --filter @onelife/db run db:generate`. NEVER hand-write the SQL or edit `_journal.json`/snapshots. The next migration is **0010** (0009 already exists).
- **Store/tick functions dependency-inject `db` as the first parameter.**
- **DB tests** use `@onelife/test-support`'s `getTestDb()` at module scope, isolate with a random `svc` id, delete children-before-parents in `afterAll`, and end with `await sql.end()`. Need `TEST_DATABASE_URL` ending in `_test` (this dev box may remap Postgres to host port **5434**).
- **Test runner is Vitest.** One file: `pnpm --filter @onelife/newsdesk exec vitest run test/<file>`. Whole suite (repo): `pnpm turbo run test --concurrency=1`. Typecheck: `pnpm turbo run typecheck`.

---

## File Structure

**Create:**
- `apps/newsdesk/src/obituary-url.ts` — pure obituary-URL builder.
- `apps/newsdesk/src/discord.ts` — generic Discord webhook client (injected `fetch`).
- `apps/newsdesk/src/notify.ts` — the `notifyDiscord` sweep (orchestrates store + discord + url).
- `apps/newsdesk/test/obituary-url.test.ts`, `apps/newsdesk/test/discord.test.ts`, `apps/newsdesk/test/notify.test.ts`.

**Modify:**
- `packages/db/src/schema.ts` — add `discordPostedAt` column + `discordUnpostedIdx` partial index.
- `packages/db/drizzle/` — generated `0010_*.sql` + meta (via drizzle-kit).
- `apps/newsdesk/src/config.ts` — 3 new env fields.
- `apps/newsdesk/src/pg-store.ts` — `UnpostedObituary` type + `findUnpostedObituaries` + `markObituaryPosted`.
- `apps/newsdesk/src/main.ts` — wire the sweep into the loop.
- `apps/newsdesk/test/config.test.ts`, `apps/newsdesk/test/pg-store.test.ts` — extend.
- `.env.example`, `deploy/README.md`, `CHANGELOG.md`, `CLAUDE.md`.

---

## Task 1: Schema column + partial index + migration 0010

**Files:**
- Modify: `packages/db/src/schema.ts` (articles table, ~line 384 + index block ~line 389)
- Generate: `packages/db/drizzle/0010_discord_posted_at.sql` + `packages/db/drizzle/meta/*`

**Interfaces:**
- Produces: DB column `articles.discord_posted_at timestamptz` (nullable); Drizzle field `articles.discordPostedAt`; partial index `articles_discord_unposted_idx`.

- [ ] **Step 1: Add the column to the `articles` table.** In `packages/db/src/schema.ts`, add the new column immediately after the `generatedAt` line (nullable timestamptz — NO `.notNull()`):

```ts
  generatedAt: timestamp("generated_at", { withTimezone: true }),
  discordPostedAt: timestamp("discord_posted_at", { withTimezone: true }), // set when the obituary link was posted to Discord; NULL = unposted
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
```

- [ ] **Step 2: Add the partial index to the index callback.** In the same table's `(t) => ({ ... })` block, add a key alongside `feedIdx` (mirrors the `gamertagLinks` `.where(sql\`...\`)` pattern at schema.ts:234):

```ts
}, (t) => ({
  uniqLife: uniqueIndex("articles_kind_server_gamertag_life_uniq").on(t.kind, t.serverId, t.gamertag, t.lifeStartedAt),
  uniqSlug: uniqueIndex("articles_slug_uniq").on(t.slug),
  feedIdx: index("articles_kind_status_death_idx").on(t.kind, t.status, t.deathAt),
  discordUnpostedIdx: index("articles_discord_unposted_idx").on(t.deathAt).where(sql`${t.status} = 'published' AND ${t.discordPostedAt} IS NULL`),
}));
```

(`index`, `uniqueIndex`, `timestamp` are already imported from `drizzle-orm/pg-core`; `sql` from `drizzle-orm`. No import edit needed.)

- [ ] **Step 3: Typecheck the schema.**

Run: `pnpm --filter @onelife/db run typecheck`
Expected: PASS (no errors).

- [ ] **Step 4: Generate the migration.**

Run: `pnpm --filter @onelife/db run db:generate --name discord_posted_at`
Expected: creates `packages/db/drizzle/0010_discord_posted_at.sql`, `packages/db/drizzle/meta/0010_snapshot.json`, and appends an `idx: 10` entry to `packages/db/drizzle/meta/_journal.json`.

- [ ] **Step 5: Verify the generated SQL contains BOTH the column add and the partial `WHERE`.**

Run: `cat packages/db/drizzle/0010_discord_posted_at.sql`
Expected: an `ALTER TABLE "articles" ADD COLUMN "discord_posted_at" timestamp with time zone;` statement AND a `CREATE INDEX ... "articles_discord_unposted_idx" ON "articles" ... ("death_at") WHERE "status" = 'published' AND "discord_posted_at" IS NULL;` statement (separated by `--> statement-breakpoint`). If the `WHERE` clause is absent, STOP — the drizzle-kit version did not emit the partial predicate; do not proceed.

- [ ] **Step 6: Apply the migration to the local DB (smoke — confirms the SQL is valid Postgres).**

Run: `DATABASE_URL="${TEST_DATABASE_URL:-postgres://onelife:onelife@localhost:5434/onelife_test}" pnpm --filter @onelife/db run db:migrate`
Expected: migration applies cleanly (no error). (Uses the `_test` DB so it doesn't touch dev data; adjust host port if not 5434.)

- [ ] **Step 7: Commit.**

```bash
git add packages/db/src/schema.ts packages/db/drizzle/0010_discord_posted_at.sql packages/db/drizzle/meta/
git commit -m "feat(db): add articles.discord_posted_at + partial unposted index (migration 0010)"
```

---

## Task 2: `obituary-url.ts` — pure URL builder

**Files:**
- Create: `apps/newsdesk/src/obituary-url.ts`
- Test: `apps/newsdesk/test/obituary-url.test.ts`

**Interfaces:**
- Produces: `obituaryUrl(siteUrl: string, slug: string): string` → `` `${siteUrl-without-trailing-slash}/obituaries/${slug}` ``.

- [ ] **Step 1: Write the failing test.** Create `apps/newsdesk/test/obituary-url.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { obituaryUrl } from "../src/obituary-url.js";

describe("obituaryUrl", () => {
  it("composes the interior obituary URL", () => {
    expect(obituaryUrl("https://dayzonelife.com", "the-king-is-dead-7-4")).toBe(
      "https://dayzonelife.com/obituaries/the-king-is-dead-7-4",
    );
  });

  it("strips exactly one trailing slash from siteUrl (mirrors seo.ts SITE_URL)", () => {
    expect(obituaryUrl("https://dayzonelife.com/", "abc")).toBe("https://dayzonelife.com/obituaries/abc");
  });
});
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `pnpm --filter @onelife/newsdesk exec vitest run test/obituary-url.test.ts`
Expected: FAIL — cannot resolve `../src/obituary-url.js` / `obituaryUrl is not a function`.

- [ ] **Step 3: Write the implementation.** Create `apps/newsdesk/src/obituary-url.ts`:

```ts
/** Absolute URL of an obituary's interior page. Mirrors apps/web seo.ts SITE_URL trailing-slash
 *  handling (single trailing slash stripped) and obituaryHref (`/obituaries/${slug}`). */
export function obituaryUrl(siteUrl: string, slug: string): string {
  return `${siteUrl.replace(/\/$/, "")}/obituaries/${slug}`;
}
```

- [ ] **Step 4: Run test to verify it passes.**

Run: `pnpm --filter @onelife/newsdesk exec vitest run test/obituary-url.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit.**

```bash
git add apps/newsdesk/src/obituary-url.ts apps/newsdesk/test/obituary-url.test.ts
git commit -m "feat(newsdesk): add obituaryUrl pure builder"
```

---

## Task 3: `discord.ts` — webhook client

**Files:**
- Create: `apps/newsdesk/src/discord.ts`
- Test: `apps/newsdesk/test/discord.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type DiscordPostResult =
    | { ok: true }
    | { ok: false; rateLimited: true; retryAfterSeconds: number }
    | { ok: false; rateLimited: false; error: string };
  export function postToDiscordWebhook(webhookUrl: string, content: string, deps: { fetch: typeof fetch }): Promise<DiscordPostResult>;
  ```

- [ ] **Step 1: Write the failing test.** Create `apps/newsdesk/test/discord.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { postToDiscordWebhook } from "../src/discord.js";

function fakeFetch(response: Partial<Response> & { throws?: unknown }, calls: unknown[]) {
  return (async (url: unknown, init: unknown) => {
    calls.push({ url, init });
    if (response.throws) throw response.throws;
    return response as Response;
  }) as unknown as typeof fetch;
}

describe("postToDiscordWebhook", () => {
  it("POSTs JSON { content } and returns ok on 204", async () => {
    const calls: any[] = [];
    const res = await postToDiscordWebhook("https://hook", "https://site/obituaries/x", {
      fetch: fakeFetch({ ok: true, status: 204 }, calls),
    });
    expect(res).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://hook");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(calls[0].init.body)).toEqual({ content: "https://site/obituaries/x" });
  });

  it("maps 429 to rateLimited with retry_after seconds", async () => {
    const res = await postToDiscordWebhook("https://hook", "u", {
      fetch: fakeFetch({ ok: false, status: 429, json: async () => ({ retry_after: 1.5 }) } as any, []),
    });
    expect(res).toEqual({ ok: false, rateLimited: true, retryAfterSeconds: 1.5 });
  });

  it("maps other non-2xx to a non-rate-limited error", async () => {
    const res = await postToDiscordWebhook("https://hook", "u", {
      fetch: fakeFetch({ ok: false, status: 400, text: async () => "Bad Request" } as any, []),
    });
    expect(res.ok).toBe(false);
    if (res.ok === false) {
      expect(res.rateLimited).toBe(false);
      if (res.rateLimited === false) expect(res.error).toContain("400");
    }
  });

  it("maps a network throw to a non-rate-limited error", async () => {
    const res = await postToDiscordWebhook("https://hook", "u", {
      fetch: fakeFetch({ throws: new Error("ECONNREFUSED") }, []),
    });
    expect(res).toEqual({ ok: false, rateLimited: false, error: "ECONNREFUSED" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `pnpm --filter @onelife/newsdesk exec vitest run test/discord.test.ts`
Expected: FAIL — `postToDiscordWebhook` not found.

- [ ] **Step 3: Write the implementation.** Create `apps/newsdesk/src/discord.ts`:

```ts
/** Result of a single Discord webhook POST. */
export type DiscordPostResult =
  | { ok: true }
  | { ok: false; rateLimited: true; retryAfterSeconds: number }
  | { ok: false; rateLimited: false; error: string };

/** POST { content } to a Discord incoming webhook. Discord returns 204 on success. `fetch` is
 *  injected for testing. Mirrors openrouter.ts: global fetch, JSON body, !res.ok handling. */
export async function postToDiscordWebhook(
  webhookUrl: string,
  content: string,
  deps: { fetch: typeof fetch },
): Promise<DiscordPostResult> {
  let res: Response;
  try {
    res = await deps.fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
  } catch (e) {
    return { ok: false, rateLimited: false, error: e instanceof Error ? e.message : String(e) };
  }

  if (res.ok) return { ok: true }; // 204 No Content (and any 2xx)

  if (res.status === 429) {
    let retryAfterSeconds = 1;
    try {
      const body = (await res.json()) as { retry_after?: number };
      if (typeof body?.retry_after === "number") retryAfterSeconds = body.retry_after;
    } catch {
      // keep default
    }
    return { ok: false, rateLimited: true, retryAfterSeconds };
  }

  let detail = "";
  try {
    detail = await res.text();
  } catch {
    detail = "";
  }
  return { ok: false, rateLimited: false, error: `Discord webhook failed (${res.status}): ${detail}` };
}
```

- [ ] **Step 4: Run test to verify it passes.**

Run: `pnpm --filter @onelife/newsdesk exec vitest run test/discord.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit.**

```bash
git add apps/newsdesk/src/discord.ts apps/newsdesk/test/discord.test.ts
git commit -m "feat(newsdesk): add Discord webhook client"
```

---

## Task 4: `config.ts` — three new env fields

**Files:**
- Modify: `apps/newsdesk/src/config.ts`
- Test: `apps/newsdesk/test/config.test.ts` (extend)

**Interfaces:**
- Produces: `Config` gains `discordWebhookUrl: string`, `siteUrl: string`, `discordMaxPerTick: number`.

- [ ] **Step 1: Write the failing test.** Append to `apps/newsdesk/test/config.test.ts` (inside the file, a new `describe`):

```ts
describe("newsdesk config — Discord notifier fields", () => {
  it("defaults webhook empty, siteUrl to prod, maxPerTick to 10", () => {
    const c = loadConfig({ DATABASE_URL: "postgres://x/y" });
    expect(c.discordWebhookUrl).toBe("");
    expect(c.siteUrl).toBe("https://dayzonelife.com");
    expect(c.discordMaxPerTick).toBe(10);
  });

  it("reads the three Discord env vars when set", () => {
    const c = loadConfig({
      DATABASE_URL: "postgres://x/y",
      DISCORD_OBITUARY_WEBHOOK_URL: "https://discord.com/api/webhooks/1/abc",
      SITE_URL: "https://staging.example.com",
      NEWSDESK_DISCORD_MAX_PER_TICK: "5",
    });
    expect(c.discordWebhookUrl).toBe("https://discord.com/api/webhooks/1/abc");
    expect(c.siteUrl).toBe("https://staging.example.com");
    expect(c.discordMaxPerTick).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `pnpm --filter @onelife/newsdesk exec vitest run test/config.test.ts`
Expected: FAIL — `c.discordWebhookUrl` etc. are `undefined`.

- [ ] **Step 3: Add the three fields.** In `apps/newsdesk/src/config.ts`, add to the zod `schema` object (after `NEWSDESK_TEMPERATURE`):

```ts
  DISCORD_OBITUARY_WEBHOOK_URL: z.string().default(""),
  SITE_URL: z.string().default("https://dayzonelife.com"),
  NEWSDESK_DISCORD_MAX_PER_TICK: z.coerce.number().int().positive().default(10),
```

Add to the `Config` type (after `temperature: number;`):

```ts
  discordWebhookUrl: string;
  siteUrl: string;
  discordMaxPerTick: number;
```

Add to the `loadConfig` return object (after `temperature: p.NEWSDESK_TEMPERATURE,`):

```ts
    discordWebhookUrl: p.DISCORD_OBITUARY_WEBHOOK_URL,
    siteUrl: p.SITE_URL,
    discordMaxPerTick: p.NEWSDESK_DISCORD_MAX_PER_TICK,
```

- [ ] **Step 4: Run test to verify it passes.**

Run: `pnpm --filter @onelife/newsdesk exec vitest run test/config.test.ts`
Expected: PASS (existing + 2 new tests).

- [ ] **Step 5: Commit.**

```bash
git add apps/newsdesk/src/config.ts apps/newsdesk/test/config.test.ts
git commit -m "feat(newsdesk): config for Discord webhook, site URL, per-tick cap"
```

---

## Task 5: `pg-store.ts` — `findUnpostedObituaries` + `markObituaryPosted`

**Files:**
- Modify: `apps/newsdesk/src/pg-store.ts`
- Test: `apps/newsdesk/test/pg-store.test.ts` (extend)

**Interfaces:**
- Consumes: `articles` table (Task 1's `discordPostedAt` column), `Database` from `@onelife/db`.
- Produces:
  ```ts
  export interface UnpostedObituary { id: number; slug: string; headline: string | null; gamertag: string; }
  export function findUnpostedObituaries(db: Database, opts: { limit: number }): Promise<UnpostedObituary[]>;
  export function markObituaryPosted(db: Database, id: number, now: Date): Promise<void>;
  ```

- [ ] **Step 1: Write the failing test.** Append to `apps/newsdesk/test/pg-store.test.ts`. First extend the top import to include the new symbols:

```ts
import { findObituaryTargets, publishObituary, recordObituaryFailure, obituarySlug, findUnpostedObituaries, markObituaryPosted, type ObituaryTarget } from "../src/pg-store.js";
```

Then add a new `describe` block (after the existing ones). It seeds four `articles` rows directly on the already-seeded `serverId` and asserts selection/ordering/stamping. Add `asc`/`gte`-free — uses the harness `db`/`serverId` already in scope:

```ts
describe("findUnpostedObituaries + markObituaryPosted", () => {
  const dtag = `nd-d-${svc}`;
  const idsToClean: number[] = [];

  async function seedArticle(over: Record<string, unknown>) {
    const [a] = await db
      .insert(articles)
      .values({
        kind: "obituary",
        status: "published",
        serverId,
        gamertag: dtag,
        map: "chernarusplus",
        lifeNumber: 1,
        lifeStartedAt: hrs(0),
        deathAt: hrs(1),
        ...over,
      })
      .returning();
    idsToClean.push(a!.id);
    return a!.id;
  }

  it("selects only published+slugged+unposted rows, oldest death first, capped", async () => {
    const older = await seedArticle({ slug: `older-${svc}`, deathAt: hrs(1) });
    const newer = await seedArticle({ slug: `newer-${svc}`, deathAt: hrs(5) });
    await seedArticle({ slug: `posted-${svc}`, deathAt: hrs(2), discordPostedAt: hrs(3) }); // already posted → excluded
    await seedArticle({ slug: `failed-${svc}`, deathAt: hrs(2), status: "failed" });        // not published → excluded
    await seedArticle({ slug: null, deathAt: hrs(2) });                                     // no slug → excluded

    const rows = await findUnpostedObituaries(db, { limit: 10 });
    const mine = rows.filter((r) => r.gamertag === dtag);
    expect(mine.map((r) => r.id)).toEqual([older, newer]); // oldest death first
    expect(mine[0]!.slug).toBe(`older-${svc}`);

    const capped = await findUnpostedObituaries(db, { limit: 1 });
    expect(capped.filter((r) => r.gamertag === dtag).map((r) => r.id)).toEqual([older]);
  });

  it("markObituaryPosted stamps the row so it is not re-selected", async () => {
    const id = await seedArticle({ slug: `mark-${svc}`, deathAt: hrs(9) });
    expect((await findUnpostedObituaries(db, { limit: 50 })).some((r) => r.id === id)).toBe(true);
    await markObituaryPosted(db, id, hrs(10));
    expect((await findUnpostedObituaries(db, { limit: 50 })).some((r) => r.id === id)).toBe(false);
  });

  afterAll(async () => {
    if (idsToClean.length) await db.delete(articles).where(inArray(articles.id, idsToClean));
  });
});
```

(Note: `svc`, `hrs`, `db`, `serverId`, `articles`, `inArray` are all already in scope from the existing test file header.)

- [ ] **Step 2: Run test to verify it fails.**

Run: `pnpm --filter @onelife/newsdesk exec vitest run test/pg-store.test.ts`
Expected: FAIL — `findUnpostedObituaries`/`markObituaryPosted` not exported.

- [ ] **Step 3: Add the implementation.** In `apps/newsdesk/src/pg-store.ts`, extend the drizzle import to add `asc` and `isNull`:

```ts
import { and, eq, desc, asc, isNull, isNotNull, notExists, sql } from "drizzle-orm";
```

Append at the end of the file:

```ts
export interface UnpostedObituary {
  id: number;
  slug: string;          // filtered NOT NULL below
  headline: string | null;
  gamertag: string;
}

/** Published obituaries not yet posted to Discord — oldest death first (backlog replays in order). */
export async function findUnpostedObituaries(
  db: Database,
  opts: { limit: number },
): Promise<UnpostedObituary[]> {
  const rows = await db
    .select({ id: articles.id, slug: articles.slug, headline: articles.headline, gamertag: articles.gamertag })
    .from(articles)
    .where(
      and(
        eq(articles.kind, "obituary"),
        eq(articles.status, "published"),
        isNotNull(articles.slug),
        isNull(articles.discordPostedAt),
      ),
    )
    .orderBy(asc(articles.deathAt))
    .limit(opts.limit);
  return rows.map((r) => ({ ...r, slug: r.slug! }));
}

/** Stamp an obituary as posted to Discord. Never overwrites an existing stamp elsewhere; the sweep
 *  only calls this on a successful post. */
export async function markObituaryPosted(db: Database, id: number, now: Date): Promise<void> {
  await db.update(articles).set({ discordPostedAt: now }).where(eq(articles.id, id));
}
```

- [ ] **Step 4: Run test to verify it passes.**

Run: `pnpm --filter @onelife/newsdesk exec vitest run test/pg-store.test.ts`
Expected: PASS (existing + 2 new tests).

- [ ] **Step 5: Commit.**

```bash
git add apps/newsdesk/src/pg-store.ts apps/newsdesk/test/pg-store.test.ts
git commit -m "feat(newsdesk): findUnpostedObituaries + markObituaryPosted store fns"
```

---

## Task 6: `notify.ts` — the sweep

**Files:**
- Create: `apps/newsdesk/src/notify.ts`
- Test: `apps/newsdesk/test/notify.test.ts`

**Interfaces:**
- Consumes: `UnpostedObituary` (Task 5, type-only import), `DiscordPostResult` (Task 3, type-only import), `obituaryUrl` (Task 2), `Database` (`@onelife/db`).
- Produces:
  ```ts
  export interface NotifyStore {
    findUnpostedObituaries(db: Database, opts: { limit: number }): Promise<UnpostedObituary[]>;
    markObituaryPosted(db: Database, id: number, now: Date): Promise<void>;
  }
  export type NotifyDeps = {
    webhookUrl: string; siteUrl: string; maxPerTick: number; dryRun: boolean; now: Date;
    log: { info: (o: unknown, m?: string) => void; warn?: (o: unknown, m?: string) => void };
    store: NotifyStore;
    post: (webhookUrl: string, content: string) => Promise<DiscordPostResult>;
  };
  export type NotifyResult = { posted: number; failed: number; disabled: boolean };
  export function notifyDiscord(db: Database, deps: NotifyDeps): Promise<NotifyResult>;
  ```
  Collaborators (`store`, `post`) are injected so the sweep is unit-testable with fakes and no DB. `main.ts` (Task 7) wires the real implementations.

- [ ] **Step 1: Write the failing test.** Create `apps/newsdesk/test/notify.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { notifyDiscord, type NotifyDeps } from "../src/notify.js";
import type { UnpostedObituary } from "../src/pg-store.js";
import type { DiscordPostResult } from "../src/discord.js";

const FAKE_DB = {} as any; // fake store ignores db

function row(id: number, slug: string): UnpostedObituary {
  return { id, slug, headline: "H", gamertag: "Tag" };
}

function makeDeps(over: Partial<NotifyDeps> & { rows?: UnpostedObituary[]; postResults?: DiscordPostResult[] }) {
  const marked: number[] = [];
  const logs: { level: string; obj: unknown; msg?: string }[] = [];
  const seenLimits: number[] = [];
  let postCalls = 0;
  const results = over.postResults ?? [];
  const deps: NotifyDeps = {
    webhookUrl: over.webhookUrl ?? "https://hook",
    siteUrl: over.siteUrl ?? "https://site",
    maxPerTick: over.maxPerTick ?? 10,
    dryRun: over.dryRun ?? false,
    now: over.now ?? new Date("2026-07-17T00:00:00Z"),
    log: {
      info: (obj, msg) => logs.push({ level: "info", obj, msg }),
      warn: (obj, msg) => logs.push({ level: "warn", obj, msg }),
    },
    store: {
      findUnpostedObituaries: async (_db, opts) => {
        seenLimits.push(opts.limit);
        return (over.rows ?? []).slice(0, opts.limit);
      },
      markObituaryPosted: async (_db, id) => {
        marked.push(id);
      },
    },
    post: async () => results[postCalls++] ?? { ok: true },
  };
  return { deps, marked, logs, seenLimits, getPostCalls: () => postCalls };
}

describe("notifyDiscord", () => {
  it("is a no-op when the webhook URL is empty", async () => {
    const { deps, getPostCalls } = makeDeps({ webhookUrl: "", rows: [row(1, "a")] });
    const res = await notifyDiscord(FAKE_DB, deps);
    expect(res).toEqual({ posted: 0, failed: 0, disabled: true });
    expect(getPostCalls()).toBe(0);
  });

  it("dry-run logs but does not post or stamp", async () => {
    const { deps, marked, logs, getPostCalls } = makeDeps({ dryRun: true, rows: [row(1, "a")] });
    const res = await notifyDiscord(FAKE_DB, deps);
    expect(res).toEqual({ posted: 0, failed: 0, disabled: false });
    expect(getPostCalls()).toBe(0);
    expect(marked).toEqual([]);
    expect(logs.some((l) => String(l.msg).includes("DRY RUN"))).toBe(true);
  });

  it("posts and stamps on success", async () => {
    const { deps, marked } = makeDeps({ rows: [row(1, "a"), row(2, "b")], postResults: [{ ok: true }, { ok: true }] });
    const res = await notifyDiscord(FAKE_DB, deps);
    expect(res).toEqual({ posted: 2, failed: 0, disabled: false });
    expect(marked).toEqual([1, 2]);
  });

  it("counts a failure and leaves the row unstamped, continuing", async () => {
    const { deps, marked } = makeDeps({
      rows: [row(1, "a"), row(2, "b")],
      postResults: [{ ok: false, rateLimited: false, error: "boom" }, { ok: true }],
    });
    const res = await notifyDiscord(FAKE_DB, deps);
    expect(res).toEqual({ posted: 1, failed: 1, disabled: false });
    expect(marked).toEqual([2]);
  });

  it("passes maxPerTick as the store limit", async () => {
    const { deps, seenLimits } = makeDeps({ maxPerTick: 3, rows: [] });
    await notifyDiscord(FAKE_DB, deps);
    expect(seenLimits).toEqual([3]);
  });

  it("stops posting on a 429 and does not touch remaining rows", async () => {
    const { deps, marked, getPostCalls } = makeDeps({
      rows: [row(1, "a"), row(2, "b")],
      postResults: [{ ok: false, rateLimited: true, retryAfterSeconds: 2 }],
    });
    const res = await notifyDiscord(FAKE_DB, deps);
    expect(res).toEqual({ posted: 0, failed: 0, disabled: false });
    expect(getPostCalls()).toBe(1); // stopped after the first row
    expect(marked).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `pnpm --filter @onelife/newsdesk exec vitest run test/notify.test.ts`
Expected: FAIL — `notifyDiscord` not found.

- [ ] **Step 3: Write the implementation.** Create `apps/newsdesk/src/notify.ts`:

```ts
import type { Database } from "@onelife/db";
import type { UnpostedObituary } from "./pg-store.js";
import type { DiscordPostResult } from "./discord.js";
import { obituaryUrl } from "./obituary-url.js";

export interface NotifyStore {
  findUnpostedObituaries(db: Database, opts: { limit: number }): Promise<UnpostedObituary[]>;
  markObituaryPosted(db: Database, id: number, now: Date): Promise<void>;
}

export type NotifyDeps = {
  webhookUrl: string; // "" ⇒ feature disabled
  siteUrl: string;
  maxPerTick: number;
  dryRun: boolean;
  now: Date;
  log: { info: (obj: unknown, msg?: string) => void; warn?: (obj: unknown, msg?: string) => void };
  store: NotifyStore;
  post: (webhookUrl: string, content: string) => Promise<DiscordPostResult>;
};

export type NotifyResult = { posted: number; failed: number; disabled: boolean };

/** Post published-but-unposted obituary links to Discord, oldest death first, and stamp each on
 *  success. Idempotent + self-retrying: delivery state lives in the table, so a transient outage,
 *  worker restart, or the dry-run→live switch never drops an obituary. */
export async function notifyDiscord(db: Database, deps: NotifyDeps): Promise<NotifyResult> {
  if (!deps.webhookUrl) return { posted: 0, failed: 0, disabled: true };

  const rows = await deps.store.findUnpostedObituaries(db, { limit: deps.maxPerTick });
  let posted = 0;
  let failed = 0;

  for (const row of rows) {
    const url = obituaryUrl(deps.siteUrl, row.slug);

    if (deps.dryRun) {
      deps.log.info({ url, gamertag: row.gamertag }, "DRY RUN: would post obituary to Discord");
      continue;
    }

    const res = await deps.post(deps.webhookUrl, url);
    if (res.ok) {
      await deps.store.markObituaryPosted(db, row.id, deps.now);
      posted++;
    } else if (res.rateLimited) {
      deps.log.warn?.({ retryAfterSeconds: res.retryAfterSeconds }, "Discord rate limited; stopping sweep (retries next tick)");
      break;
    } else {
      deps.log.warn?.({ error: res.error, id: row.id }, "Discord post failed (will retry next tick)");
      failed++;
    }
  }

  return { posted, failed, disabled: false };
}
```

- [ ] **Step 4: Run test to verify it passes.**

Run: `pnpm --filter @onelife/newsdesk exec vitest run test/notify.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit.**

```bash
git add apps/newsdesk/src/notify.ts apps/newsdesk/test/notify.test.ts
git commit -m "feat(newsdesk): notifyDiscord sweep (disabled/dry-run/success/failure/cap/429)"
```

---

## Task 7: Wire the sweep into `main.ts`

**Files:**
- Modify: `apps/newsdesk/src/main.ts`

**Interfaces:**
- Consumes: `notifyDiscord`/`NotifyResult` (Task 6), `findUnpostedObituaries`/`markObituaryPosted` (Task 5), `postToDiscordWebhook` (Task 3), `cfg.discordWebhookUrl`/`cfg.siteUrl`/`cfg.discordMaxPerTick`/`cfg.dryRun` (Task 4).

No unit test — `main.ts` is the untested composition root (repo convention). Verified by typecheck + a dry-run smoke boot.

- [ ] **Step 1: Add imports.** In `apps/newsdesk/src/main.ts`, add to the local-import block (after `import { OBITUARY_PROMPT_VERSION } from "./prompt.js";`):

```ts
import { notifyDiscord } from "./notify.js";
import { findUnpostedObituaries, markObituaryPosted } from "./pg-store.js";
import { postToDiscordWebhook } from "./discord.js";
```

- [ ] **Step 2: Add the sibling sweep.** Inside the `while (true)` loop, AFTER the existing `newsdeskTick` try/catch block (the one ending `log.error({ err }, "newsdesk tick failed");`) and BEFORE the `await new Promise((r) => setTimeout(...))` sleep, insert:

```ts
    try {
      const nd = await notifyDiscord(db, {
        webhookUrl: cfg.discordWebhookUrl,
        siteUrl: cfg.siteUrl,
        maxPerTick: cfg.discordMaxPerTick,
        dryRun: cfg.dryRun,
        now: new Date(),
        log,
        store: { findUnpostedObituaries, markObituaryPosted },
        post: (webhookUrl, content) => postToDiscordWebhook(webhookUrl, content, { fetch }),
      });
      if (nd.posted || nd.failed) log.info(nd, "discord notify tick");
    } catch (err) {
      log.error({ err }, "discord notify failed");
    }
```

- [ ] **Step 3: (Optional) Note the enable state at startup.** Immediately after the existing dry-run `log.warn(...)` line in `loop()`, add:

```ts
  if (!cfg.discordWebhookUrl) log.info("DISCORD_OBITUARY_WEBHOOK_URL is empty — Discord obituary notifier disabled.");
```

- [ ] **Step 4: Typecheck the whole workspace.**

Run: `pnpm turbo run typecheck`
Expected: PASS.

- [ ] **Step 5: Dry-run smoke boot (no webhook, no OpenRouter spend).** Confirm the loop starts and both the tick and the (disabled) notifier run without throwing, then stop it.

Run:
```bash
cd apps/newsdesk && timeout 8 env DATABASE_URL="${TEST_DATABASE_URL:-postgres://onelife:onelife@localhost:5434/onelife_test}" NEWSDESK_DRY_RUN=true DISCORD_OBITUARY_WEBHOOK_URL= pnpm start ; cd -
```
Expected: logs `newsdesk starting`, the dry-run warning, and `DISCORD_OBITUARY_WEBHOOK_URL is empty — ... disabled.`; no unhandled rejection. (`timeout` kills it after 8s — exit 124 is expected/fine.)

- [ ] **Step 6: Commit.**

```bash
git add apps/newsdesk/src/main.ts
git commit -m "feat(newsdesk): run the Discord notify sweep each loop iteration"
```

---

## Task 8: Deploy docs — `.env.example` + `deploy/README.md`

**Files:**
- Modify: `.env.example`
- Modify: `deploy/README.md`

- [ ] **Step 1: Add the three keys to `.env.example`.** Immediately after the `NEWSDESK_DRY_RUN=true` line (still inside the newsdesk comment block, before the blank line preceding `# Testing`), insert:

```
# Discord obituary notifier — posts a link to each published obituary into a Discord channel via an
# incoming webhook. Empty webhook = disabled. Respects NEWSDESK_DRY_RUN (logs, does not post).
DISCORD_OBITUARY_WEBHOOK_URL=
SITE_URL=https://dayzonelife.com
NEWSDESK_DISCORD_MAX_PER_TICK=10
```

- [ ] **Step 2: Extend the `onelife-newsdesk` section in `deploy/README.md`.** After the existing `**NEWSDESK_DRY_RUN` defaults `true`**...` sentence in the onelife-newsdesk bullet, append:

```
  To post each published obituary into Discord, set `DISCORD_OBITUARY_WEBHOOK_URL` (an incoming
  webhook URL — a secret; keep it only in the host `.env`, never committed) plus `SITE_URL`
  (default `https://dayzonelife.com`, used to build the absolute obituary link) and optionally
  `NEWSDESK_DISCORD_MAX_PER_TICK` (default `10`, the per-sweep post cap that drains the
  back-catalogue on first live run). Empty webhook ⇒ the notifier is a no-op. Delivery is tracked
  in `articles.discord_posted_at`, so obituaries published while the webhook was unset are posted
  once it is set. This is a normal `./deploy/deploy.sh` (migrate picks up `0010`) — no `--rebuild`.
```

- [ ] **Step 3: Commit.**

```bash
git add .env.example deploy/README.md
git commit -m "docs(deploy): document Discord obituary notifier env vars"
```

---

## Task 9: CHANGELOG + CLAUDE.md (last before PR)

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add a CHANGELOG entry.** Under the top `## [Unreleased]` section (create it under the title if absent), add:

```markdown
### Added
- Discord obituary notifier: `apps/newsdesk` posts a plain link to every published obituary into a
  Discord channel via an incoming webhook (Discord unfurls the OG card). Tracked-and-retried
  delivery via `articles.discord_posted_at` (migration `0010`) drains the back-catalogue on first
  live run. Gated by `DISCORD_OBITUARY_WEBHOOK_URL` (empty = disabled) and the existing
  `NEWSDESK_DRY_RUN`; per-tick cap `NEWSDESK_DISCORD_MAX_PER_TICK` (default 10).
```

- [ ] **Step 2: Update `CLAUDE.md`.** In the `newsdesk` app description (Monorepo → apps), append a sentence noting the notifier sweep + the `discord_posted_at` column + the three env vars. In the `db` package description (the `articles` table note), add that `articles` gained `discord_posted_at` (migration `0010`). In the R5a section, note the Discord notifier ships alongside Obituaries.

- [ ] **Step 3: Commit.**

```bash
git add CHANGELOG.md CLAUDE.md
git commit -m "docs: changelog + CLAUDE.md for Discord obituary notifier"
```

---

## Task 10: Verify, review, open PR

- [ ] **Step 1: Full test suite.**

Run: `pnpm turbo run test --concurrency=1`
Expected: PASS (DB suites need `TEST_DATABASE_URL` on the `_test` DB, host port 5434 on this box).

- [ ] **Step 2: Full typecheck.**

Run: `pnpm turbo run typecheck`
Expected: PASS.

- [ ] **Step 3: Adversarial code review** of the branch diff (correctness + simplification), fix any confirmed findings, re-run affected tests.

- [ ] **Step 4: Open the PR into `develop`** (solo-maintainer). Follow the `finishing-a-feature` skill: push the branch, open the PR into `develop` with CHANGELOG + CLAUDE.md updated. Stop after the PR is open.

---

## Self-Review

**Spec coverage** (design doc §-by-§):
- Message format = plain link → Task 6 posts `obituaryUrl(...)` only. ✅
- Tracked/retried via `discord_posted_at` → Task 1 column + Task 5 store + Task 6 leave-unstamped-on-failure. ✅
- Backfill = post the back-catalogue, no `UPDATE` → Task 1 migration adds column with no backfill; Task 5 `ORDER BY death_at ASC` drains oldest-first. ✅
- `discord.ts` client (204/429/error mapping, injected fetch) → Task 3. ✅
- `obituary-url.ts` pure builder, trailing-slash strip → Task 2. ✅
- `pg-store` `findUnpostedObituaries` + `markObituaryPosted` → Task 5. ✅
- `notify.ts` sweep (disabled/dry-run/success/rate-limit-break/failure-continue, `maxPerTick`) → Task 6. ✅
- main.ts sibling try/catch → Task 7. ✅
- 3 env vars w/ safe defaults → Task 4. ✅
- Migration (nullable column + partial index, migrate not rebuild) → Task 1 (corrected 0009→**0010**). ✅
- Testing (discord/obituary-url/notify/pg-store) → Tasks 2,3,5,6. ✅
- Deploy & docs (`.env.example`, `deploy/README.md`) → Task 8; CHANGELOG + CLAUDE.md → Task 9. ✅

**Type consistency:** `UnpostedObituary` defined once in `pg-store.ts` (Task 5), imported by `notify.ts` (Task 6) and asserted in both test files. `DiscordPostResult` defined in `discord.ts` (Task 3), consumed by `notify.ts`/tests. `NotifyStore.findUnpostedObituaries`/`markObituaryPosted` signatures match the concrete `pg-store` exports exactly, so Task 7's `store: { findUnpostedObituaries, markObituaryPosted }` wiring type-checks. `post(webhookUrl, content)` matches `postToDiscordWebhook(webhookUrl, content, { fetch })` via the Task 7 adapter lambda.

**Deviations from design (deliberate, behavior-preserving):**
1. Migration is **0010**, not 0009 (0009 already exists), and is **drizzle-kit generated**, not hand-written (verified `drizzle.config.ts out: "./drizzle"`).
2. `notifyDiscord` injects `store` + `post` collaborators (design showed `fetch` + direct store calls) purely so the sweep is unit-testable with fakes and no DB — every locked behavior is unchanged; `main.ts` wires the real implementations.
