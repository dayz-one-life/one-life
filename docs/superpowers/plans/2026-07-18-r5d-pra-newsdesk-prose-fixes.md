# R5d PR-A — Newsdesk prose-quality fixes (Phase 0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the four defects in `apps/newsdesk` that are currently minting permanently bad obituary and birth-notice prose — seeded pull-quote repetition, missing player priors, suicides mis-tagged as environmental deaths, and a bare mechanism token that invites the model to invent a cause.

**Architecture:** All work is confined to the `apps/newsdesk` package plus one CHANGELOG entry. Two new pure modules (`prose-block.ts`, `prose-backstop.ts`) and one new read helper (`prose-pg-store.ts`, mirroring the existing `image-pg-store.ts` `recentCovers` pattern) are added; `facts.ts`, `prompt.ts`, `voice.ts`, `birth-voice.ts`, `tick.ts`, `birth-tick.ts`, `generate.ts`, `birth-prompt.ts` and `image-categories.ts` are edited in place. There is **no migration and no schema change** — every column the new read helper touches (`headline`, `pull_quote_attribution`, `lede`, `kind`, `status`, `created_at`) already exists.

**Tech Stack:** TypeScript (ESM, NodeNext), pnpm workspaces + turbo, Vitest, Drizzle ORM over Postgres 16, OpenRouter completion client (not exercised by these tests — every generation test injects a fake `CompletionClient`).

## Global Constraints

- The package is `@onelife/newsdesk`, rooted at `apps/newsdesk`.
- The test command is `pnpm --filter @onelife/newsdesk test`. **NEVER append `-- run`** — the package script is already `vitest run`, and the extra argument is interpreted as a filename filter and matches nothing.
- Typecheck with `pnpm --filter @onelife/newsdesk typecheck`.
- Sources import each other with an explicit `.js` extension (`./facts.js`, `../src/prompt.js`) — this is NodeNext ESM resolution, not a typo.
- DB tests use the Postgres harness (`getTestDb` from `@onelife/test-support`) and require `TEST_DATABASE_URL`. On this machine: `postgres://onelife:onelife@localhost:5434/onelife_test` (the gitignored `docker-compose.override.yml` remaps the host port to 5434; the DB name must end in `_test` or the harness refuses to run). Start it with `docker compose up -d postgres`.
- **Prefer `pnpm --filter` over `pnpm turbo run` for any command that needs `TEST_DATABASE_URL`** — turbo strips the variable out of the task environment. Vitest's `globalSetup` needs the DB even for pure-unit files in this package, so export the variable for every test invocation.
- `articles.facts` is **frozen at publish and forward-only**. None of these fixes retroactively repair the 45 published obituaries or the 123 published birth notices; they protect future output only. Do not add a backfill.
- `CHANGELOG.md` is required on **every** PR (the fork guard blocks a PR without it) — Task 16. `CLAUDE.md` is **deferred to PR-C** per spec §14; do not touch it in this PR.
- **No schema change in this PR.** No migration file, no new column, no new table.
- Commit messages end with the repo's standard trailers:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NSa9MaBB8aheaCBZfLWy79
  ```

## Task dependency note

**Execute Tasks 1 → 16 strictly in order. Do not parallelize and do not skip ahead.**

Several tasks change shared signatures and shared source lines that later tasks quote verbatim:

- Tasks 1–6 (defect D5, prompt-seeded repetition) come first: they are the highest-value, lowest-risk change and they touch no types.
- Task 7 makes `buildObituaryFacts` take a **required third parameter** (`priors`). Every later task that calls it — notably Task 10 — assumes three arguments.
- Task 10 widens `ObituaryFacts["causeCategory"]` to four values and inserts a suicide branch into `describeDeath`. Tasks 11, 12, 13, 14 and 15 all assume the post-Task-10 file.
- Task 13 rewrites the non-pvp half of `describeDeath` **around** the suicide branch Task 10 added. Applying Task 13 to a pre-Task-10 file silently deletes that branch.
- **Line numbers quoted in Tasks 9, 10, 12, 13 and 14 are as of the pre-PR file.** Earlier tasks insert lines ahead of them. Anchor every edit on the quoted code, never on the line number.

---

### Task 1: Delete the seeded attribution examples from both system prompts

**Files:**
- Modify: `apps/newsdesk/src/voice.ts` (line 28)
- Modify: `apps/newsdesk/src/birth-voice.ts` (line 30)
- Test: `apps/newsdesk/test/voice.test.ts` (create)

**Interfaces:**
- Consumes: `OBITUARY_SYSTEM: string` (`apps/newsdesk/src/voice.ts`), `BIRTH_SYSTEM: string` (`apps/newsdesk/src/birth-voice.ts`)
- Produces: no signature change — both constants keep type `string`.

- [ ] **Step 1.1: Write the failing regression test.**
  Create `apps/newsdesk/test/voice.test.ts` with exactly:
  ```ts
  import { describe, it, expect } from "vitest";
  import { OBITUARY_SYSTEM } from "../src/voice.js";
  import { BIRTH_SYSTEM } from "../src/birth-voice.js";

  // D5 regression guard: 89 of 123 birth notices and 8 obituaries reused an attribution string
  // that appeared VERBATIM as an example in these prompts. No concrete attribution example may
  // ever return — describe the register instead.
  const SEEDED = [
    "a voice on the coast",
    "an old rival",
    "sources who have buried him before",
    "a rival",
    "sources on the coast",
    "reps for the deceased did not respond",
  ];

  describe("system prompts carry no seeded attribution examples", () => {
    it("OBITUARY_SYSTEM quotes no concrete attribution", () => {
      for (const s of SEEDED) expect(OBITUARY_SYSTEM.toLowerCase()).not.toContain(s);
    });

    it("BIRTH_SYSTEM quotes no concrete attribution", () => {
      for (const s of SEEDED) expect(BIRTH_SYSTEM.toLowerCase()).not.toContain(s);
    });

    it("both still state the anonymity rule for attributions", () => {
      expect(OBITUARY_SYSTEM).toMatch(/attribution/i);
      expect(OBITUARY_SYSTEM).toMatch(/anonymous/i);
      expect(BIRTH_SYSTEM).toMatch(/attribution/i);
      expect(BIRTH_SYSTEM).toMatch(/anonymous/i);
    });
  });
  ```

- [ ] **Step 1.2: Run it, watch it fail.**
  ```
  pnpm --filter @onelife/newsdesk test test/voice.test.ts
  ```
  Expected: 2 failures — `OBITUARY_SYSTEM quotes no concrete attribution` (contains `a rival`) and `BIRTH_SYSTEM quotes no concrete attribution` (contains `a voice on the coast`). The third test passes.

- [ ] **Step 1.3: Rewrite the obituary line.**
  In `apps/newsdesk/src/voice.ts`, line 28.
  BEFORE (exact):
  ```
  - Pull-quote attributions stay anonymous and in-voice ("a rival", "sources on the coast", "reps for the deceased did not respond, on account of the deceased") — never attribute a quote to a real out-of-game identity.
  ```
  AFTER (exact):
  ```
  - Pull-quote attributions stay anonymous and in-voice: an unnamed bystander, adversary, or institution rendered in wire-service register — a role, a vantage, or a bureaucratic non-answer, never a name. Invent the attribution fresh from THIS story's specifics; a generic stock phrase is a failure. Never attribute a quote to a real out-of-game identity.
  ```

- [ ] **Step 1.4: Rewrite the birth-notice line.**
  In `apps/newsdesk/src/birth-voice.ts`, line 30.
  BEFORE (exact):
  ```
  - Pull-quote attributions stay anonymous and in-voice ("a voice on the coast", "an old rival", "sources who have buried him before") — never attribute a quote to a real out-of-game identity.
  ```
  AFTER (exact):
  ```
  - Pull-quote attributions stay anonymous and in-voice: an unnamed witness, an old adversary, or a weary institutional source, rendered in wire-service register — a role or a vantage, never a name. Invent the attribution fresh from THIS arrival's specifics and priors; a generic stock phrase is a failure. Never attribute a quote to a real out-of-game identity.
  ```

- [ ] **Step 1.5: Run it, watch it pass.**
  ```
  pnpm --filter @onelife/newsdesk test test/voice.test.ts
  ```
  Expected: `Tests  3 passed (3)`.

- [ ] **Step 1.6: Full package suite + typecheck, then commit.**
  ```
  pnpm --filter @onelife/newsdesk test
  pnpm --filter @onelife/newsdesk typecheck
  ```
  Expected: all files pass (`prompt.test.ts` asserts only `/deadpan/i`, `/Fog Rule/i`, `/json/i` on the system string — untouched by this edit). Then:
  ```
  git add apps/newsdesk/src/voice.ts apps/newsdesk/src/birth-voice.ts apps/newsdesk/test/voice.test.ts
  git commit -m "fix(newsdesk): stop seeding pull-quote attributions in the system prompts"
  ```

---

### Task 2: `recentProse` read helper

**Files:**
- Create: `apps/newsdesk/src/prose-pg-store.ts`
- Test: `apps/newsdesk/test/prose-pg-store.test.ts` (create)

**Interfaces:**
- Produces: `interface RecentProse { headline: string; attribution: string | null; opener: string }`
- Produces: `recentProse(db: Database, kind: string, limit?: number): Promise<RecentProse[]>` (default `limit = 12`)
- Consumes: `Database` (`@onelife/db`), `articles` table (`@onelife/db`, columns `headline`, `pullQuoteAttribution`, `lede`, `kind`, `status`, `createdAt`), `and`/`eq`/`desc` (`drizzle-orm`).

- [ ] **Step 2.1: Write the failing DB-harness test.**
  If this file has ever crashed mid-run, clear leftovers first so stale rows do not pollute the newest-12 window:
  ```
  psql $TEST_DATABASE_URL -c "delete from articles where gamertag like 'prose-tag-%'"
  ```
  Create `apps/newsdesk/test/prose-pg-store.test.ts` with exactly:
  ```ts
  import { describe, it, expect, beforeAll, afterAll } from "vitest";
  import { getTestDb } from "@onelife/test-support";
  import { articles, servers } from "@onelife/db";
  import { eq, inArray } from "drizzle-orm";
  import { recentProse } from "../src/prose-pg-store.js";

  const { db, sql } = getTestDb();
  const svc = Math.floor(Math.random() * 1e8) + 55e7;
  const t0 = new Date("2026-07-18T00:00:00Z");
  const hrs = (h: number) => new Date(t0.getTime() + h * 3600_000);
  let serverId: number;
  const articleIds: number[] = [];
  let artSeq = 0;

  async function seedArticle(over: Record<string, unknown> = {}) {
    artSeq += 1;
    const [a] = await db
      .insert(articles)
      .values({
        kind: "obituary",
        status: "published",
        slug: `prose-slug-${svc}-${artSeq}`,
        serverId,
        gamertag: `prose-tag-${svc}-${artSeq}`,
        map: "chernarusplus",
        lifeNumber: artSeq,
        lifeStartedAt: hrs(artSeq),
        headline: `Headline ${artSeq}`,
        lede: `Lede ${artSeq}.`,
        pullQuoteText: `Quote ${artSeq}`,
        pullQuoteAttribution: `attribution ${artSeq}`,
        facts: { seq: artSeq },
        createdAt: hrs(artSeq),
        ...over,
      })
      .returning();
    articleIds.push(a!.id);
    return a!;
  }

  beforeAll(async () => {
    const [s] = await db
      .insert(servers)
      .values({ nitradoServiceId: svc, name: "prose", map: "chernarusplus", slug: `prose-${svc}`, active: true })
      .returning();
    serverId = s!.id;
  });

  afterAll(async () => {
    if (articleIds.length) await db.delete(articles).where(inArray(articles.id, articleIds));
    await db.delete(servers).where(eq(servers.id, serverId));
    await sql.end();
  });

  describe("recentProse", () => {
    it("returns same-kind published rows newest-first, capped by limit", async () => {
      await seedArticle({ headline: "Oldest", createdAt: hrs(1) });
      await seedArticle({ headline: "Middle", createdAt: hrs(2) });
      await seedArticle({ headline: "Newest", createdAt: hrs(3) });
      const rows = await recentProse(db, "obituary", 2);
      const mine = rows.filter((r) => ["Oldest", "Middle", "Newest"].includes(r.headline));
      expect(mine.map((r) => r.headline)).toEqual(["Newest", "Middle"]);
    });

    it("excludes the other kind and unpublished rows", async () => {
      await seedArticle({ kind: "birth_notice", headline: "A Nursery Piece", deathAt: null, createdAt: hrs(9) });
      await seedArticle({ status: "failed", headline: "A Failed Stub", createdAt: hrs(10) });
      const rows = await recentProse(db, "obituary", 50);
      const heads = rows.map((r) => r.headline);
      expect(heads).not.toContain("A Nursery Piece");
      expect(heads).not.toContain("A Failed Stub");
    });

    it("carries the attribution and a truncated first-sentence opener", async () => {
      const long = `${"word ".repeat(60)}sentence end. And a second sentence entirely.`;
      await seedArticle({ headline: "Opener Case", lede: long, pullQuoteAttribution: "a bored coroner", createdAt: hrs(20) });
      const rows = await recentProse(db, "obituary", 50);
      const row = rows.find((r) => r.headline === "Opener Case")!;
      expect(row.attribution).toBe("a bored coroner");
      expect(row.opener.length).toBeLessThanOrEqual(121); // 120 + the ellipsis char
      expect(row.opener.endsWith("…")).toBe(true);
    });

    it("tolerates a null lede and a null attribution", async () => {
      await seedArticle({ headline: "Bare Row", lede: null, pullQuoteAttribution: null, createdAt: hrs(21) });
      const rows = await recentProse(db, "obituary", 50);
      const row = rows.find((r) => r.headline === "Bare Row")!;
      expect(row.attribution).toBeNull();
      expect(row.opener).toBe("");
    });
  });
  ```

- [ ] **Step 2.2: Run it, watch it fail.**
  ```
  TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test \
    pnpm --filter @onelife/newsdesk test test/prose-pg-store.test.ts
  ```
  Expected: the suite fails to collect — `Failed to load .../src/prose-pg-store.js` / `Cannot find module`. (If `TEST_DATABASE_URL` is unset the harness throws before that; export it first, DB name must end in `_test`.)

- [ ] **Step 2.3: Implement `recentProse`.**
  Create `apps/newsdesk/src/prose-pg-store.ts` with exactly:
  ```ts
  import type { Database } from "@onelife/db";
  import { articles } from "@onelife/db";
  import { and, eq, desc } from "drizzle-orm";

  /** One recently published article's prose fingerprint — what the do-not-reuse block shows the
   *  model. Mirrors recentCovers in image-pg-store.ts (same kind/status/order/limit shape). */
  export interface RecentProse {
    headline: string;
    attribution: string | null;
    opener: string;
  }

  const OPENER_MAX = 120;

  /** The lede's first sentence, trimmed and truncated for the prompt block. */
  function opener(lede: string | null): string {
    const s = (lede ?? "").trim();
    if (!s) return "";
    const stop = s.search(/[.!?](\s|$)/);
    const first = (stop === -1 ? s : s.slice(0, stop + 1)).trim();
    return first.length > OPENER_MAX ? `${first.slice(0, OPENER_MAX).trimEnd()}…` : first;
  }

  /** The last N same-kind published articles, for the do-not-reuse prose block. Read-only — no
   *  migration, no new storage; headline / pull_quote_attribution / lede already exist. */
  export async function recentProse(db: Database, kind: string, limit = 12): Promise<RecentProse[]> {
    const rows = await db
      .select({ headline: articles.headline, attribution: articles.pullQuoteAttribution, lede: articles.lede })
      .from(articles)
      .where(and(eq(articles.kind, kind), eq(articles.status, "published")))
      .orderBy(desc(articles.createdAt))
      .limit(limit);
    return rows.map((r) => ({
      headline: r.headline ?? "",
      attribution: r.attribution ?? null,
      opener: opener(r.lede ?? null),
    }));
  }
  ```

- [ ] **Step 2.4: Run it, watch it pass.**
  ```
  TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test \
    pnpm --filter @onelife/newsdesk test test/prose-pg-store.test.ts
  ```
  Expected: `Tests  4 passed (4)`.

- [ ] **Step 2.5: Typecheck and commit.**
  ```
  pnpm --filter @onelife/newsdesk typecheck
  git add apps/newsdesk/src/prose-pg-store.ts apps/newsdesk/test/prose-pg-store.test.ts
  git commit -m "feat(newsdesk): recentProse read helper for the do-not-reuse prose block"
  ```

---

### Task 3: `recentProseBlock` — the shared do-not-reuse block

**Files:**
- Create: `apps/newsdesk/src/prose-block.ts`
- Test: `apps/newsdesk/test/prose-block.test.ts` (create)

**Interfaces:**
- Consumes: `RecentProse` (`./prose-pg-store.js`, Task 2)
- Produces: `recentProseBlock(recent: RecentProse[]): string[]` — returns `[]` when `recent` is empty; otherwise a list of prompt lines to splice into a user message.

- [ ] **Step 3.1: Write the failing unit test.**
  Create `apps/newsdesk/test/prose-block.test.ts` with exactly:
  ```ts
  import { describe, it, expect } from "vitest";
  import { recentProseBlock } from "../src/prose-block.js";
  import type { RecentProse } from "../src/prose-pg-store.js";

  const r = (over: Partial<RecentProse> = {}): RecentProse => ({
    headline: "The King Is Dead", attribution: "a bored coroner", opener: "He arrived with a flare.", ...over,
  });

  describe("recentProseBlock", () => {
    it("is empty when there is nothing recent", () => {
      expect(recentProseBlock([])).toEqual([]);
    });

    it("lists recent headlines, attributions, and openers under a do-not-reuse instruction", () => {
      const lines = recentProseBlock([r(), r({ headline: "Second", attribution: "a rival", opener: "Two." })]);
      const text = lines.join("\n");
      expect(text).toMatch(/do NOT reuse/i);
      expect(text).toContain("The King Is Dead");
      expect(text).toContain("a bored coroner");
      expect(text).toContain("He arrived with a flare.");
      expect(text).toContain("Second");
      expect(text).toContain("a rival");
    });

    it("skips a null attribution and an empty opener without emitting blanks", () => {
      const lines = recentProseBlock([r({ attribution: null, opener: "" })]);
      const text = lines.join("\n");
      expect(text).toContain("The King Is Dead");
      expect(text).not.toContain("null");
      expect(text).not.toContain("—  ");
    });

    it("de-duplicates repeated attributions so one string is not re-seeded N times", () => {
      const lines = recentProseBlock([r({ attribution: "a rival" }), r({ headline: "B", attribution: "A Rival" })]);
      const attrLines = lines.filter((l) => l.toLowerCase().includes("a rival"));
      expect(attrLines).toHaveLength(1);
    });
  });
  ```

- [ ] **Step 3.2: Run it, watch it fail.**
  ```
  pnpm --filter @onelife/newsdesk test test/prose-block.test.ts
  ```
  Expected: collection error — `Cannot find module '../src/prose-block.js'`.

- [ ] **Step 3.3: Implement the block.**
  Create `apps/newsdesk/src/prose-block.ts` with exactly:
  ```ts
  import type { RecentProse } from "./prose-pg-store.js";

  /** The do-not-reuse block spliced into both prompt builders. Empty in, empty out — a first
   *  article on a fresh desk gets no block at all. Attributions are de-duplicated
   *  case-insensitively so a phrase the desk has overused is shown once, not N times. */
  export function recentProseBlock(recent: RecentProse[]): string[] {
    if (recent.length === 0) return [];

    const lines: string[] = [];
    lines.push("");
    lines.push("RECENTLY PUBLISHED BY THIS DESK — do NOT reuse any of these. Not the attribution");
    lines.push("string, not the headline construction, not the opening move. Repetition is the one");
    lines.push("thing the paper cannot print.");

    lines.push("Recent headlines:");
    for (const r of recent) if (r.headline) lines.push(`- ${r.headline}`);

    const seen = new Set<string>();
    const attributions: string[] = [];
    for (const r of recent) {
      const a = (r.attribution ?? "").trim();
      if (!a) continue;
      const key = a.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      attributions.push(a);
    }
    if (attributions.length) {
      lines.push("Attributions already used (pick none of these — invent a fresh one):");
      for (const a of attributions) lines.push(`- ${a}`);
    }

    const openers = recent.map((r) => r.opener.trim()).filter(Boolean);
    if (openers.length) {
      lines.push("Recent opening lines (do not echo their shape):");
      for (const o of openers) lines.push(`- ${o}`);
    }

    return lines;
  }
  ```

- [ ] **Step 3.4: Run it, watch it pass.**
  ```
  pnpm --filter @onelife/newsdesk test test/prose-block.test.ts
  ```
  Expected: `Tests  4 passed (4)`.

- [ ] **Step 3.5: Commit.**
  ```
  git add apps/newsdesk/src/prose-block.ts apps/newsdesk/test/prose-block.test.ts
  git commit -m "feat(newsdesk): recentProseBlock do-not-reuse prompt block"
  ```

---

### Task 4: Thread `recent` through both prompt builders and both generators

**Files:**
- Modify: `apps/newsdesk/src/prompt.ts` (`buildObituaryPrompt`)
- Modify: `apps/newsdesk/src/birth-prompt.ts` (`buildBirthPrompt`)
- Modify: `apps/newsdesk/src/generate.ts` (both generators)
- Modify: `apps/newsdesk/src/voice.ts` + `apps/newsdesk/src/birth-voice.ts` (standing rule line)
- Test: `apps/newsdesk/test/prompt.test.ts`, `apps/newsdesk/test/birth-prompt.test.ts`, `apps/newsdesk/test/voice.test.ts`

**Interfaces:**
- Changes: `buildObituaryPrompt(facts: ObituaryFacts, recent?: RecentProse[]): { system: string; user: string }` (default `[]`)
- Changes: `buildBirthPrompt(facts: BirthFacts, recent?: RecentProse[]): { system: string; user: string }` (default `[]`)
- Changes: `generateObituary(client: CompletionClient, facts: ObituaryFacts, recent?: RecentProse[]): Promise<Obituary>` (default `[]`)
- Changes: `generateBirthNotice(client: CompletionClient, facts: BirthFacts, recent?: RecentProse[]): Promise<BirthNotice>` (default `[]`)
- Consumes: `recentProseBlock` (Task 3), `RecentProse` (Task 2).
- All four parameters are **optional with a default**, so every existing single/two-arg call site and test compiles unchanged.

- [ ] **Step 4.1: Add the failing prompt tests.**
  Append to `apps/newsdesk/test/prompt.test.ts` (after the existing `describe("buildObituaryPrompt", ...)` block closes):
  ```ts
  describe("buildObituaryPrompt — recent prose", () => {
    it("omits the block entirely when nothing is recent", () => {
      const { user } = buildObituaryPrompt(facts);
      expect(user).not.toMatch(/RECENTLY PUBLISHED/);
    });

    it("splices the do-not-reuse block when recent prose is supplied", () => {
      const { user } = buildObituaryPrompt(facts, [
        { headline: "Old Screamer", attribution: "a bored coroner", opener: "He arrived with a flare." },
      ]);
      expect(user).toMatch(/do NOT reuse/i);
      expect(user).toContain("Old Screamer");
      expect(user).toContain("a bored coroner");
    });
  });
  ```
  No type import is needed — the object literals are structurally checked against the parameter type.

  Append to `apps/newsdesk/test/birth-prompt.test.ts`. **That file's veteran fixture is named `known`** (not `facts`) — the other fixture is `stranger`; use `known`:
  ```ts
  describe("buildBirthPrompt — recent prose", () => {
    it("omits the block entirely when nothing is recent", () => {
      const { user } = buildBirthPrompt(known);
      expect(user).not.toMatch(/RECENTLY PUBLISHED/);
    });

    it("splices the do-not-reuse block when recent prose is supplied", () => {
      const { user } = buildBirthPrompt(known, [
        { headline: "Old Arrival", attribution: "a harbourmaster with a ledger", opener: "Another one washed up." },
      ]);
      expect(user).toMatch(/do NOT reuse/i);
      expect(user).toContain("Old Arrival");
      expect(user).toContain("a harbourmaster with a ledger");
    });
  });
  ```

  Append to `apps/newsdesk/test/voice.test.ts`:
  ```ts
  describe("system prompts carry the standing anti-repetition rule", () => {
    it("OBITUARY_SYSTEM forbids reusing a recent attribution", () => {
      expect(OBITUARY_SYSTEM).toMatch(/never reuse/i);
    });
    it("BIRTH_SYSTEM forbids reusing a recent attribution", () => {
      expect(BIRTH_SYSTEM).toMatch(/never reuse/i);
    });
  });
  ```

- [ ] **Step 4.2: Run the three files, watch them fail.**
  ```
  pnpm --filter @onelife/newsdesk test test/prompt.test.ts test/birth-prompt.test.ts test/voice.test.ts
  ```
  Expected: 4 failures (the two "splices" tests — extra arg ignored, no block in `user`; the two `never reuse` assertions). The two "omits" tests already pass.

- [ ] **Step 4.3: Add the standing rule to both system prompts.**
  In `apps/newsdesk/src/voice.ts`, immediately AFTER the rewritten line 28 (the `Pull-quote attributions...` bullet), insert this new bullet:
  ```
  - NEVER reuse an attribution, headline construction, or opening move that appears in the recently-published list you are shown. If a phrase is on that list it is burned; write past it.
  ```
  In `apps/newsdesk/src/birth-voice.ts`, insert the identical bullet immediately after the rewritten line 30.

- [ ] **Step 4.4: Thread the parameter through `buildObituaryPrompt`.**
  In `apps/newsdesk/src/prompt.ts`, add to the imports at the top:
  ```ts
  import type { RecentProse } from "./prose-pg-store.js";
  import { recentProseBlock } from "./prose-block.js";
  ```
  Change the signature (line 56):
  ```ts
  export function buildObituaryPrompt(facts: ObituaryFacts, recent: RecentProse[] = []): { system: string; user: string } {
  ```
  And immediately before the final `lines.push(`Respond with only the JSON object described in your instructions.`);` (line 88), insert:
  ```ts
    lines.push(...recentProseBlock(recent));
    lines.push("");
  ```

- [ ] **Step 4.5: Thread the parameter through `buildBirthPrompt`.**
  In `apps/newsdesk/src/birth-prompt.ts`, add the same two imports, change the signature to:
  ```ts
  export function buildBirthPrompt(facts: BirthFacts, recent: RecentProse[] = []): { system: string; user: string } {
  ```
  and insert the same two lines immediately before its final `lines.push(`Respond with only the JSON object described in your instructions.`);`:
  ```ts
    lines.push(...recentProseBlock(recent));
    lines.push("");
  ```

- [ ] **Step 4.6: Thread it through both generators.**
  Replace `apps/newsdesk/src/generate.ts` lines 11–23 with:
  ```ts
  /** Build the prompt, call the model, parse + validate. Throws on client or parse failure. */
  export async function generateObituary(
    client: CompletionClient,
    facts: ObituaryFacts,
    recent: RecentProse[] = [],
  ): Promise<Obituary> {
    const { system, user } = buildObituaryPrompt(facts, recent);
    const raw = await client.complete({ system, user });
    return parseObituary(raw);
  }

  /** Birth-pass sibling of generateObituary: build the Nursery prompt, call the model, parse + validate. */
  export async function generateBirthNotice(
    client: CompletionClient,
    facts: BirthFacts,
    recent: RecentProse[] = [],
  ): Promise<BirthNotice> {
    const { system, user } = buildBirthPrompt(facts, recent);
    const raw = await client.complete({ system, user });
    return parseBirthNotice(raw);
  }
  ```
  and add to its imports:
  ```ts
  import type { RecentProse } from "./prose-pg-store.js";
  ```

- [ ] **Step 4.7: Run the three files, watch them pass.**
  ```
  pnpm --filter @onelife/newsdesk test test/prompt.test.ts test/birth-prompt.test.ts test/voice.test.ts
  ```
  Expected: all pass — including the pre-existing single-argument `buildObituaryPrompt(facts)` / `describeDeath(facts)` / `buildBirthPrompt(known)` calls, since the new parameter defaults to `[]`.

- [ ] **Step 4.8: Full suite + typecheck, then commit.**
  ```
  TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test \
    pnpm --filter @onelife/newsdesk test
  pnpm --filter @onelife/newsdesk typecheck
  ```
  Expected: green (`generate.test.ts` calls both generators with two args — still valid).
  ```
  git add apps/newsdesk/src/prompt.ts apps/newsdesk/src/birth-prompt.ts apps/newsdesk/src/generate.ts apps/newsdesk/src/voice.ts apps/newsdesk/src/birth-voice.ts apps/newsdesk/test/prompt.test.ts apps/newsdesk/test/birth-prompt.test.ts apps/newsdesk/test/voice.test.ts
  git commit -m "feat(newsdesk): show both desks their recent prose and forbid reuse"
  ```

---

### Task 5: Hoist `recentProse` once per tick in both ticks

**Files:**
- Modify: `apps/newsdesk/src/tick.ts`
- Modify: `apps/newsdesk/src/birth-tick.ts`
- Test: `apps/newsdesk/test/tick.test.ts`, `apps/newsdesk/test/birth-tick.test.ts`

**Interfaces:**
- Consumes: `recentProse(db, kind, limit?)` (Task 2), `generateObituary(client, facts, recent?)` / `generateBirthNotice(client, facts, recent?)` (Task 4).
- Produces: **no change** to `NewsdeskDeps` or `NewsdeskResult` — the fetch lives inside the tick, so both test `deps()` factories compile unchanged. (This matters: both factories are typed `Partial<Parameters<typeof …>[1]>` and would break on a new required field.)
- New module-local constant in each tick: `const RECENT_PROSE_LIMIT = 12;`

- [ ] **Step 5.1: Write the failing tick test (obituary).**
  Append to `apps/newsdesk/test/tick.test.ts`, inside the existing `describe("newsdeskTick", ...)` block:
  ```ts
  it("shows the model the desk's recent prose, fetched once for the whole tick", async () => {
    // A previously published obituary exists from the earlier live test — its headline must show
    // up in the do-not-reuse block of the next generation.
    await seedQualifiedDeath(`tk-recent-${svc}`, 7);
    const seen: string[] = [];
    const client: CompletionClient = {
      complete: async ({ user }) => {
        seen.push(user);
        return JSON.stringify({ headline: "Another Coastal Farce", lede: "L", body: "B", pullQuote: null, tags: ["Obituaries"] });
      },
    };
    await newsdeskTick(db, deps({ client, batchCap: 50 }));
    expect(seen.length).toBeGreaterThanOrEqual(1);
    // Order-independent: recentProse filters only on kind/status, so it sees every published
    // obituary in the test DB. Assert against the joined block, never against seen[0] alone.
    const block = seen.join("\n");
    expect(block).toMatch(/do NOT reuse/i);
    expect(block).toContain("A Death On The Coast"); // published by the earlier live test
  });

  it("dry-run does not fetch recent prose or call the client", async () => {
    const c = calls(okClient());
    const r = await newsdeskTick(db, deps({ client: c.client, dryRun: true }));
    expect(r.dryRun).toBe(true);
    expect(c.count()).toBe(0);
  });
  ```
  Note: this test must run AFTER the existing `"live: generates and publishes an obituary"` test — vitest runs `it`s in declaration order within a file and `fileParallelism: false` is set, so appending it at the end of the describe is sufficient.

- [ ] **Step 5.2: Write the failing tick test (birth).**
  Append to `apps/newsdesk/test/birth-tick.test.ts`, inside its `describe("birthNoticeTick", ...)` block, using its existing `seedQualifiedAlive` / `deps` helpers:
  ```ts
  it("shows the Nursery its recent prose, fetched once for the whole tick", async () => {
    await seedQualifiedAlive(`bt-recent-${svc}`, 7);
    const seen: string[] = [];
    const client: CompletionClient = {
      complete: async ({ user }) => {
        seen.push(user);
        return JSON.stringify({ headline: "Another Body On The Beach", lede: "L", body: "B", pullQuote: null, tags: ["Fresh Spawns"] });
      },
    };
    await birthNoticeTick(db, deps({ client, batchCap: 50 }));
    expect(seen.length).toBeGreaterThanOrEqual(1);
    const block = seen.join("\n");
    expect(block).toMatch(/do NOT reuse/i);
    expect(block).toContain("Fresh Meat On The Coast"); // published by the earlier live test
  });
  ```

- [ ] **Step 5.3: Run both, watch them fail.**
  ```
  TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test \
    pnpm --filter @onelife/newsdesk test test/tick.test.ts test/birth-tick.test.ts
  ```
  Expected: 2 failures — `expected '…' to match /do NOT reuse/i` in each file (the tick never passes `recent`). The dry-run test passes already.

- [ ] **Step 5.4: Hoist the fetch in `tick.ts`.**
  Add to the imports:
  ```ts
  import { recentProse } from "./prose-pg-store.js";
  ```
  Add above `newsdeskTick`:
  ```ts
  /** How many recently published articles the model is shown as do-not-reuse material. Fetched
   *  ONCE per tick, not per article — the block is the same for every target in the batch. */
  const RECENT_PROSE_LIMIT = 12;
  ```
  Insert immediately after the `let skipped = 0;` line (line 29) and before the `for` loop:
  ```ts
    // One query for the whole batch. Skipped entirely in dry-run — nothing is generated, so the
    // do-not-reuse material would go unused.
    const recent = deps.dryRun || targets.length === 0 ? [] : await recentProse(db, "obituary", RECENT_PROSE_LIMIT);
  ```
  Change the generate call (line 45) to:
  ```ts
        const obituary = await generateObituary(deps.client, facts, recent);
  ```

- [ ] **Step 5.5: Hoist the fetch in `birth-tick.ts`.**
  Add to the imports:
  ```ts
  import { recentProse } from "./prose-pg-store.js";
  ```
  Add above `birthNoticeTick`:
  ```ts
  /** Mirror of tick.ts: the do-not-reuse window, fetched once per tick. */
  const RECENT_PROSE_LIMIT = 12;
  ```
  Insert immediately after its `let skipped = 0;` (line 27) and before the `for` loop:
  ```ts
    const recent = deps.dryRun || targets.length === 0 ? [] : await recentProse(db, "birth_notice", RECENT_PROSE_LIMIT);
  ```
  Change the generate call (line 44) to:
  ```ts
        const notice = await generateBirthNotice(deps.client, facts, recent);
  ```

- [ ] **Step 5.6: Run both, watch them pass.**
  ```
  TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test \
    pnpm --filter @onelife/newsdesk test test/tick.test.ts test/birth-tick.test.ts
  ```
  Expected: all tests in both files pass, including the pre-existing dry-run / idempotency / failure tests.

- [ ] **Step 5.7: Typecheck and commit.**
  ```
  pnpm --filter @onelife/newsdesk typecheck
  git add apps/newsdesk/src/tick.ts apps/newsdesk/src/birth-tick.ts apps/newsdesk/test/tick.test.ts apps/newsdesk/test/birth-tick.test.ts
  git commit -m "feat(newsdesk): hoist the recent-prose fetch once per tick in both passes"
  ```

---

### Task 6: The deterministic backstop — null a repeated pull-quote attribution

**Files:**
- Create: `apps/newsdesk/src/prose-backstop.ts`
- Test: `apps/newsdesk/test/prose-backstop.test.ts` (create)
- Modify: `apps/newsdesk/src/tick.ts`, `apps/newsdesk/src/birth-tick.ts`
- Test: `apps/newsdesk/test/tick.test.ts`, `apps/newsdesk/test/birth-tick.test.ts`

**Interfaces:**
- Produces: `dedupePullQuote<T extends { pullQuote: { text: string; attribution: string } | null }>(article: T, recent: RecentProse[]): T` — returns the same object when the attribution is fresh (or already null); returns `{ ...article, pullQuote: null }` when the attribution case-insensitively (and whitespace-insensitively) matches any `recent[].attribution`.
- Consumes: `RecentProse` (Task 2). Works for both `Obituary` and `BirthNotice` — the shapes are identical, so one generic covers both.

- [ ] **Step 6.1: Write the failing unit test.**
  Create `apps/newsdesk/test/prose-backstop.test.ts` with exactly:
  ```ts
  import { describe, it, expect } from "vitest";
  import { dedupePullQuote } from "../src/prose-backstop.js";
  import type { RecentProse } from "../src/prose-pg-store.js";

  const recent: RecentProse[] = [
    { headline: "One", attribution: "a voice on the coast", opener: "o" },
    { headline: "Two", attribution: null, opener: "o" },
  ];
  const art = (attribution: string | null) => ({
    headline: "H", lede: "L", body: "B", tags: ["Obituaries"],
    pullQuote: attribution === null ? null : { text: "q", attribution },
  });

  describe("dedupePullQuote", () => {
    it("nulls a pull quote whose attribution matches a recent one", () => {
      expect(dedupePullQuote(art("a voice on the coast"), recent).pullQuote).toBeNull();
    });

    it("matches case-insensitively and ignores surrounding whitespace", () => {
      expect(dedupePullQuote(art("  A Voice On The Coast  "), recent).pullQuote).toBeNull();
    });

    it("keeps a fresh attribution untouched", () => {
      const out = dedupePullQuote(art("a bored coroner"), recent);
      expect(out.pullQuote).toEqual({ text: "q", attribution: "a bored coroner" });
    });

    it("keeps everything else on the article intact", () => {
      const out = dedupePullQuote(art("a voice on the coast"), recent);
      expect(out.headline).toBe("H");
      expect(out.lede).toBe("L");
      expect(out.body).toBe("B");
      expect(out.tags).toEqual(["Obituaries"]);
    });

    it("is a no-op for an already-null pull quote and for an empty recent list", () => {
      expect(dedupePullQuote(art(null), recent).pullQuote).toBeNull();
      expect(dedupePullQuote(art("a voice on the coast"), []).pullQuote).not.toBeNull();
    });
  });
  ```

- [ ] **Step 6.2: Run it, watch it fail.**
  ```
  pnpm --filter @onelife/newsdesk test test/prose-backstop.test.ts
  ```
  Expected: collection error — `Cannot find module '../src/prose-backstop.js'`.

- [ ] **Step 6.3: Implement the backstop.**
  Create `apps/newsdesk/src/prose-backstop.ts` with exactly:
  ```ts
  import type { RecentProse } from "./prose-pg-store.js";

  /** Deterministic last line of defence behind the prompt block: if the model handed back an
   *  attribution the desk has already printed recently, the quote loses its byline rather than
   *  re-seeding the phrase. A null pullQuote is a valid, schema-legal outcome — the article still
   *  publishes. Generic over Obituary | BirthNotice (identical shapes). */
  export function dedupePullQuote<T extends { pullQuote: { text: string; attribution: string } | null }>(
    article: T,
    recent: RecentProse[],
  ): T {
    const attribution = article.pullQuote?.attribution?.trim().toLowerCase();
    if (!attribution) return article;
    const used = new Set(
      recent.map((r) => (r.attribution ?? "").trim().toLowerCase()).filter(Boolean),
    );
    return used.has(attribution) ? { ...article, pullQuote: null } : article;
  }
  ```

- [ ] **Step 6.4: Run it, watch it pass.**
  ```
  pnpm --filter @onelife/newsdesk test test/prose-backstop.test.ts
  ```
  Expected: `Tests  5 passed (5)`.

- [ ] **Step 6.5: Write the failing tick-integration tests.**
  Append to `apps/newsdesk/test/tick.test.ts`, at the end of the `describe("newsdeskTick", ...)` block:
  ```ts
  it("backstop: a repeated attribution is dropped, a fresh one is kept", async () => {
    // The earlier live test published an obituary attributed to "a rival".
    await seedQualifiedDeath(`tk-dup-${svc}`, 8);
    const dupClient: CompletionClient = {
      complete: async () => JSON.stringify({ headline: "The Same Old Line", lede: "L", body: "B", pullQuote: { text: "q", attribution: "A RIVAL" }, tags: ["Obituaries"] }),
    };
    await newsdeskTick(db, deps({ client: dupClient, batchCap: 50 }));
    const [dup] = await db.select().from(articles).where(eq(articles.gamertag, `tk-dup-${svc}`));
    expect(dup!.pullQuoteAttribution).toBeNull();
    expect(dup!.pullQuoteText).toBeNull();

    await seedQualifiedDeath(`tk-fresh-${svc}`, 9);
    const freshClient: CompletionClient = {
      complete: async () => JSON.stringify({ headline: "A Brand New Line", lede: "L", body: "B", pullQuote: { text: "q", attribution: "a bored coroner" }, tags: ["Obituaries"] }),
    };
    await newsdeskTick(db, deps({ client: freshClient, batchCap: 50 }));
    const [fresh] = await db.select().from(articles).where(eq(articles.gamertag, `tk-fresh-${svc}`));
    expect(fresh!.pullQuoteAttribution).toBe("a bored coroner");
  });
  ```
  Append to `apps/newsdesk/test/birth-tick.test.ts`, at the end of its `describe`:
  ```ts
  it("backstop: a repeated attribution is dropped", async () => {
    // The earlier live test published a notice attributed to "a voice on the coast".
    await seedQualifiedAlive(`bt-dup-${svc}`, 8);
    const dupClient: CompletionClient = {
      complete: async () => JSON.stringify({ headline: "Same Voice Again", lede: "L", body: "B", pullQuote: { text: "q", attribution: "a voice on the coast" }, tags: ["Fresh Spawns"] }),
    };
    await birthNoticeTick(db, deps({ client: dupClient, batchCap: 50 }));
    const [dup] = await db.select().from(articles).where(eq(articles.gamertag, `bt-dup-${svc}`));
    expect(dup!.pullQuoteAttribution).toBeNull();
  });
  ```

- [ ] **Step 6.6: Run both, watch them fail.**
  ```
  TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test \
    pnpm --filter @onelife/newsdesk test test/tick.test.ts test/birth-tick.test.ts
  ```
  Expected: 2 failures — `expected 'A RIVAL' to be null` and `expected 'a voice on the coast' to be null`.

- [ ] **Step 6.7: Wire the backstop into both ticks.**
  In `apps/newsdesk/src/tick.ts` add the import:
  ```ts
  import { dedupePullQuote } from "./prose-backstop.js";
  ```
  and change the tagged-article line (currently line 48) from:
  ```ts
        const tagged = { ...obituary, tags: composeTags(facts, obituary.tags) };
  ```
  to:
  ```ts
        // Deterministic backstop behind the do-not-reuse prompt block: a recycled attribution
        // loses its byline rather than re-seeding the phrase for the next tick.
        const deduped = dedupePullQuote(obituary, recent);
        const tagged = { ...deduped, tags: composeTags(facts, deduped.tags) };
  ```
  In `apps/newsdesk/src/birth-tick.ts` add the same import and change (currently line 47):
  ```ts
        const tagged = { ...notice, tags: composeBirthTags(facts, notice.tags) };
  ```
  to:
  ```ts
        const deduped = dedupePullQuote(notice, recent);
        const tagged = { ...deduped, tags: composeBirthTags(facts, deduped.tags) };
  ```

- [ ] **Step 6.8: Run both, watch them pass.**
  ```
  TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test \
    pnpm --filter @onelife/newsdesk test test/tick.test.ts test/birth-tick.test.ts
  ```
  Expected: all tests in both files pass.

- [ ] **Step 6.9: Full package suite + typecheck, then commit.**
  ```
  TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test \
    pnpm --filter @onelife/newsdesk test
  pnpm --filter @onelife/newsdesk typecheck
  ```
  Expected: every newsdesk suite green.
  ```
  git add apps/newsdesk/src/prose-backstop.ts apps/newsdesk/test/prose-backstop.test.ts apps/newsdesk/src/tick.ts apps/newsdesk/src/birth-tick.ts apps/newsdesk/test/tick.test.ts apps/newsdesk/test/birth-tick.test.ts
  git commit -m "feat(newsdesk): drop a pull quote whose attribution the desk just used"
  ```

---

### Task 7: Extend `ObituaryFacts` + `buildObituaryFacts` with priors

**Files:**
- Modify: `apps/newsdesk/src/facts.ts`
- Modify: `apps/newsdesk/test/facts.test.ts` (Test)
- Modify: `apps/newsdesk/test/prompt.test.ts` (fixture literal — compile fix)
- Modify: `apps/newsdesk/test/generate.test.ts` (fixture literal — compile fix)

**Interfaces:**
- Consumes: `PlayerPriors` from `@onelife/read-models` = `{ livesLived: number; longestLifeSeconds: number; totalKills: number; usualDeathCause: string | null; lastDeathCause: string | null; bestLifeMap: string | null }`; `ObituaryTarget` (`apps/newsdesk/src/pg-store.ts`); `LifeTimeline` (`@onelife/read-models`).
- Produces: `ObituaryFacts` gains `priors: PlayerPriors` and `isKnownQuantity: boolean` (exactly mirroring `BirthFacts`); `buildObituaryFacts(target: ObituaryTarget, timeline: LifeTimeline, priors: PlayerPriors): ObituaryFacts` — a **required third parameter**, mirroring `buildBirthFacts`. No default: a silently-empty priors object would reintroduce the exact "rookie" defect this task fixes, so every call site must be explicit.

Steps:

- [ ] **Step 7.1: Add a failing test for the priors passthrough.**
  In `apps/newsdesk/test/facts.test.ts`, add above `describe("timeAliveLabel")`:
  ```ts
  import type { PlayerPriors } from "@onelife/read-models";

  const noPriors: PlayerPriors = {
    livesLived: 0, longestLifeSeconds: 0, totalKills: 0,
    usualDeathCause: null, lastDeathCause: null, bestLifeMap: null,
  };
  const vetPriors: PlayerPriors = {
    livesLived: 15, longestLifeSeconds: 259200, totalKills: 48,
    usualDeathCause: "animal", lastDeathCause: "bled_out", bestLifeMap: "sakhal",
  };
  ```
  (The `noPriors` fixture defined here is reused by Task 10's new tests in the same file — do not rename it.)

  Then append inside `describe("buildObituaryFacts")`:
  ```ts
    it("carries priors through and flags a known quantity", () => {
      const f = buildObituaryFacts(target, timeline(), vetPriors);
      expect(f.priors).toEqual(vetPriors);
      expect(f.isKnownQuantity).toBe(true);
    });

    it("a first-lifer is not a known quantity", () => {
      const f = buildObituaryFacts(target, timeline(), noPriors);
      expect(f.priors.livesLived).toBe(0);
      expect(f.isKnownQuantity).toBe(false);
    });
  ```

- [ ] **Step 7.2: Update the existing `buildObituaryFacts` call sites in the same test file.**
  Every existing call in `apps/newsdesk/test/facts.test.ts` takes two args; add `noPriors` as the third. The six existing calls become:
  ```ts
  const f = buildObituaryFacts(target, timeline(), noPriors);
  const f = buildObituaryFacts(target, timeline({ kills: Array.from({ length: 25 }, () => ({ distanceMeters: 10 })) }), noPriors);
  const f = buildObituaryFacts(target, timeline({ life: { deathCause: "pvp", deathByGamertag: "Camper", deathWeapon: "SKS", playtimeSeconds: 600 }, kills: [] }), noPriors);
  const f = buildObituaryFacts(target, timeline({ life: { deathCause: "bled_out", deathByGamertag: null, deathWeapon: null, playtimeSeconds: 3600 }, kills: [] }), noPriors);
  const f = buildObituaryFacts(target, timeline({ life: { deathCause: null, deathByGamertag: null, deathWeapon: null, playtimeSeconds: 3600 }, kills: [] }), noPriors);
  const f = buildObituaryFacts(target, t, noPriors);
  ```

- [ ] **Step 7.3: Run the test, see it fail.**
  ```
  pnpm --filter @onelife/newsdesk test test/facts.test.ts
  ```
  Expected: the two new tests fail with `expected undefined to deeply equal { livesLived: 15, ... }` and `expected undefined to be false` (`priors`/`isKnownQuantity` do not exist yet).

- [ ] **Step 7.4: Implement in `apps/newsdesk/src/facts.ts`.**
  Change line 1 to import the type:
  ```ts
  import type { LifeTimeline, OrdealSummary, PlayerPriors } from "@onelife/read-models";
  ```
  Add to the `ObituaryFacts` interface, after `hpLow: number | null;` (line 28):
  ```ts
    priors: PlayerPriors;        // the player's global reputation before this life
    isKnownQuantity: boolean;    // priors.livesLived > 0
  ```
  Change the function signature (line 45) to:
  ```ts
  export function buildObituaryFacts(
    target: ObituaryTarget,
    timeline: LifeTimeline,
    priors: PlayerPriors,
  ): ObituaryFacts {
  ```
  and add to the returned object, after `hpLow: timeline.hpLow ?? null,`:
  ```ts
      priors,
      isKnownQuantity: priors.livesLived > 0,
  ```

- [ ] **Step 7.5: Fix the two typed fixture literals that now miss required fields.**
  In `apps/newsdesk/test/prompt.test.ts`, the `const facts: ObituaryFacts = {...}` literal (lines 5–11) — append to the last line, after `ordeals: null, hpLow: null,`:
  ```ts
    priors: { livesLived: 6, longestLifeSeconds: 172800, totalKills: 31, usualDeathCause: "pvp", lastDeathCause: "pvp", bestLifeMap: "chernarusplus" },
    isKnownQuantity: true,
  ```
  In `apps/newsdesk/test/generate.test.ts`, the `const facts: ObituaryFacts = {...}` literal (lines 6–12) — append after `ordeals: null, hpLow: null,`:
  ```ts
    priors: { livesLived: 0, longestLifeSeconds: 0, totalKills: 0, usualDeathCause: null, lastDeathCause: null, bestLifeMap: null },
    isKnownQuantity: false,
  ```

- [ ] **Step 7.6: Run tests + typecheck, see them pass.**
  ```
  pnpm --filter @onelife/newsdesk test test/facts.test.ts
  pnpm --filter @onelife/newsdesk typecheck
  ```
  Expected: facts suite green (8 tests in `buildObituaryFacts`); `typecheck` prints nothing except the one remaining error in `src/tick.ts` — `Expected 3 arguments, but got 2` at the `buildObituaryFacts(t, timeline)` call. That error is fixed in Task 8; do not commit until then.

---

### Task 8: Call `getPlayerPriors` in `tick.ts`

**Files:**
- Modify: `apps/newsdesk/src/tick.ts`
- Modify: `apps/newsdesk/test/tick.test.ts` (Test — DB harness)

**Interfaces:**
- Consumes: `getPlayerPriors(db: Database, gamertag: string, beforeLifeStartedAt: Date): Promise<PlayerPriors>` (exported from `@onelife/read-models`); `ObituaryTarget.lifeStartedAt: Date`; `buildObituaryFacts(target, timeline, priors)` from Task 7.
- Produces: no signature change to `newsdeskTick(db: Database, deps: NewsdeskDeps): Promise<NewsdeskResult>` — `NewsdeskDeps` is untouched, so both tick test factories keep working.

Steps:

- [ ] **Step 8.1: Add a failing DB test asserting priors land in the stored facts.**
  In `apps/newsdesk/test/tick.test.ts`, add `and` to the drizzle import:
  ```ts
  import { eq, inArray, and } from "drizzle-orm";
  ```
  Then append a new `it` inside `describe("newsdeskTick")`:
  ```ts
    it("folds the player's global priors into the stored facts", async () => {
      const tag = `tk-priors-${svc}`;
      // Two prior dead lives on this server, then the life the obituary is written for.
      const [p] = await db.insert(players).values({ gamertag: tag }).returning();
      pids.push(p!.id);
      for (const n of [1, 2]) {
        const [prior] = await db.insert(lives).values({
          serverId, playerId: p!.id, lifeNumber: n,
          startedAt: hrs(n * 2 - 2), endedAt: hrs(n * 2),
          deathCause: "bled_out", playtimeSeconds: 7200,
        }).returning();
        lifeIds.push(prior!.id);
      }
      const [cur] = await db.insert(lives).values({
        serverId, playerId: p!.id, lifeNumber: 3,
        startedAt: hrs(8), endedAt: hrs(10),
        deathCause: "pvp", deathByGamertag: "Killer", deathWeapon: "M4", deathDistance: 100,
        playtimeSeconds: 7200,
      }).returning();
      lifeIds.push(cur!.id);

      await newsdeskTick(db, deps({ batchCap: 50 }));

      const [row] = await db.select().from(articles).where(and(eq(articles.gamertag, tag), eq(articles.kind, "obituary")));
      const facts = row!.facts as { priors?: { livesLived?: number }; isKnownQuantity?: boolean };
      expect(facts.priors?.livesLived).toBe(2);
      expect(facts.isKnownQuantity).toBe(true);
    });
  ```

- [ ] **Step 8.2: Run it, see it fail.**
  ```
  TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test \
    pnpm --filter @onelife/newsdesk test test/tick.test.ts
  ```
  Expected: the run fails first at build/type level or at runtime with `expected undefined to be 2` — `facts.priors` is absent because `tick.ts` never fetches priors. (If `TEST_DATABASE_URL` is unset the harness throws — export it first. Never run this through `turbo`; turbo strips the var.)

- [ ] **Step 8.3: Implement — mirror `birth-tick.ts` exactly.**
  In `apps/newsdesk/src/tick.ts`, change line 2:
  ```ts
  import { getLifeTimeline, getPlayerPriors } from "@onelife/read-models";
  ```
  and replace line 37 (`const facts = buildObituaryFacts(t, timeline);`) with the two-line mirror of `birth-tick.ts:35-36`:
  ```ts
      const priors = await getPlayerPriors(db, t.gamertag, t.lifeStartedAt);
      const facts = buildObituaryFacts(t, timeline, priors);
  ```
  (`getPlayerPriors` takes the life's start instant, so the current life is excluded from its own priors — same contract as the birth pass.)

- [ ] **Step 8.4: Run the suite + typecheck, see them pass.**
  ```
  TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test \
    pnpm --filter @onelife/newsdesk test test/tick.test.ts
  pnpm --filter @onelife/newsdesk typecheck
  ```
  Expected: every tick test passes; typecheck exits 0 with no output.

- [ ] **Step 8.5: Full package run, then commit Tasks 7+8 together.**
  ```
  TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test \
    pnpm --filter @onelife/newsdesk test
  git add apps/newsdesk/src/facts.ts apps/newsdesk/src/tick.ts apps/newsdesk/test/facts.test.ts apps/newsdesk/test/prompt.test.ts apps/newsdesk/test/generate.test.ts apps/newsdesk/test/tick.test.ts
  git commit -m "fix(newsdesk): fold global player priors into obituary facts"
  ```
  Expected: every newsdesk test file green before committing.

---

### Task 9: Priors bullets + known-quantity tone branch in `buildObituaryPrompt`

> **Line numbers below are as of the pre-PR file; anchor every edit on the quoted code, not the line number.** Tasks 4 and 7 already inserted lines ahead of these.

**Files:**
- Modify: `apps/newsdesk/src/prompt.ts`
- Modify: `apps/newsdesk/test/prompt.test.ts` (Test)

**Interfaces:**
- Consumes: `ObituaryFacts` with `priors` + `isKnownQuantity` (Task 7); `timeAliveLabel(seconds: number): string` (`apps/newsdesk/src/facts.ts`, already exported); `mapLabel(map: string): string` (already in `prompt.ts`).
- Produces: unchanged signature `buildObituaryPrompt(facts: ObituaryFacts, recent?: RecentProse[])` — new lines only in the `user` message. No parameter added, so no other call site or test changes.

Steps:

- [ ] **Step 9.1: Add the three failing prompt tests.**
  In `apps/newsdesk/test/prompt.test.ts`, append inside `describe("buildObituaryPrompt")`:
  ```ts
    it("a first-lifer gets the no-priors branch, never a priors bullet", () => {
      const { user } = buildObituaryPrompt(mkFacts({
        isLegend: false, isKnownQuantity: false,
        priors: { livesLived: 0, longestLifeSeconds: 0, totalKills: 0, usualDeathCause: null, lastDeathCause: null, bestLifeMap: null },
      }));
      expect(user).toContain("This was their first recorded life anywhere");
      expect(user).not.toContain("Prior lives lived:");
      expect(user).toMatch(/FIRST LIFE/);
    });

    it("a veteran gets the full priors block", () => {
      const { user } = buildObituaryPrompt(mkFacts({
        isLegend: false, isKnownQuantity: true,
        priors: { livesLived: 7, longestLifeSeconds: 259200, totalKills: 48, usualDeathCause: "animal", lastDeathCause: "bled_out", bestLifeMap: "sakhal" },
      }));
      expect(user).toContain("Prior lives lived: 7");
      expect(user).toContain("Longest prior life: 3d");
      expect(user).toContain("Confirmed kills across all prior lives: 48");
      expect(user).toContain("Usual cause of death: animal");
      expect(user).toContain("Most recent prior death: bled_out");
      expect(user).toContain("Best run was on: Sakhal");
      expect(user).toMatch(/KNOWN QUANTITY/);
    });

    // The published regression: an 11th life headlined "Livonia Debut". The per-map life number is
    // NOT a career count — the prior count must be in the prompt so the model cannot infer a debut.
    it("an 11th life with 15 priors states the prior count so 'debut' is impossible", () => {
      const { user } = buildObituaryPrompt(mkFacts({
        map: "enoch", lifeNumber: 11, isLegend: false, isKnownQuantity: true,
        priors: { livesLived: 15, longestLifeSeconds: 90000, totalKills: 3, usualDeathCause: "infected", lastDeathCause: "infected", bestLifeMap: "chernarusplus" },
      }));
      expect(user).toContain("Prior lives lived: 15");
      expect(user).toContain("Life number on this map: 11");
      expect(user).toContain("not a career count");
      expect(user).not.toMatch(/debut/i);
    });
  ```

- [ ] **Step 9.2: Run it, see it fail.**
  ```
  pnpm --filter @onelife/newsdesk test test/prompt.test.ts
  ```
  Expected: all three new tests fail on the first `expect(user).toContain(...)` — e.g. `expected '...' to contain 'Prior lives lived: 7'`.

- [ ] **Step 9.3: Implement the priors block in `apps/newsdesk/src/prompt.ts`.**
  Change line 2 to also import the label helper, so the file has these two import lines from `./facts.js`:
  ```ts
  import type { ObituaryFacts } from "./facts.js";
  import { timeAliveLabel } from "./facts.js";
  ```
  Insert a life-number bullet after the dateline line (currently line 60), so the per-map counter is explicitly disambiguated:
  ```ts
    lines.push(`- Life number on this map (NOT a career count — see Priors below): ${facts.lifeNumber}`);
  ```
  Then, immediately after the `hpLow` line and before the existing `lines.push("");` at line 74, insert the priors block — mirroring `buildBirthPrompt`, past-tense:
  ```ts
    lines.push("");
    lines.push(`Priors (everything this player did BEFORE this life, across every map):`);
    if (facts.isKnownQuantity) {
      lines.push(`- Prior lives lived: ${facts.priors.livesLived}`);
      lines.push(`- Longest prior life: ${timeAliveLabel(facts.priors.longestLifeSeconds)}`);
      lines.push(`- Confirmed kills across all prior lives: ${facts.priors.totalKills}`);
      if (facts.priors.usualDeathCause) lines.push(`- Usual cause of death: ${facts.priors.usualDeathCause}`);
      if (facts.priors.lastDeathCause) lines.push(`- Most recent prior death: ${facts.priors.lastDeathCause}`);
      if (facts.priors.bestLifeMap) lines.push(`- Best run was on: ${mapLabel(facts.priors.bestLifeMap)}`);
    } else {
      lines.push(`- None. This was their first recorded life anywhere. A stranger to these shores.`);
    }
  ```

- [ ] **Step 9.4: Add the tone branch.**
  Still in `buildObituaryPrompt`, immediately after the existing legend / fresh-spawn / default tone `if/else` chain (which ends at line 81, before the `lines.push("")` at line 82), append the priors-aware instruction:
  ```ts
    lines.push("");
    if (facts.isKnownQuantity) {
      lines.push(`KNOWN QUANTITY: the paper has buried this face before. The "Life number on this map" is a per-map counter, not a career count — this player had ${facts.priors.livesLived} prior lives across every map. Never call this a debut, a first appearance, or a rookie run. Any needle targets their RECORD — the wasted priors, the repeat deaths, the same mistake made again.`);
    } else {
      lines.push(`FIRST LIFE: no priors anywhere — this was their first recorded life. The absence of a record is the story. Do NOT mock them for being new, green, or unlucky; the joke is the world they walked into, never the person.`);
    }
  ```

- [ ] **Step 9.5: Run the tests + typecheck, see them pass.**
  ```
  pnpm --filter @onelife/newsdesk test test/prompt.test.ts
  pnpm --filter @onelife/newsdesk typecheck
  ```
  Expected: all `buildObituaryPrompt` tests green (including the pre-existing ones — the veteran fixture at the top of the file is `isKnownQuantity: true`, and none of the existing assertions use `not.toContain` on the new strings). Typecheck exits 0.

- [ ] **Step 9.6: Full package run, then commit.**
  ```
  TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test \
    pnpm --filter @onelife/newsdesk test
  git add apps/newsdesk/src/prompt.ts apps/newsdesk/test/prompt.test.ts
  git commit -m "fix(newsdesk): give obituaries the priors block and known-quantity tone branch"
  ```
  Expected: all newsdesk test files pass.

---

### Task 10: Widen `causeCategory` with a `"suicide"` arm and update every typed consumer

> **Line numbers below are as of the pre-PR file; anchor every edit on the quoted code, not the line number.** Tasks 4, 7 and 9 already inserted lines ahead of these.

**Files:**
- Modify: `apps/newsdesk/src/facts.ts` (union + the new arm + the `freshSpawnVictim` note)
- Modify: `apps/newsdesk/src/prompt.ts` (`causeCategoryTag`, `describeDeath` no-verdict fallback)
- Test: `apps/newsdesk/test/facts.test.ts`, `apps/newsdesk/test/prompt.test.ts`

**Interfaces:**
- Produces: `ObituaryFacts["causeCategory"] = "pvp" | "suicide" | "environment" | "unknown"` (widened, `apps/newsdesk/src/facts.ts`)
- Produces: `causeCategoryTag(cat: ObituaryFacts["causeCategory"]): string` — now returns `"Self-Inflicted"` for `"suicide"` (`apps/newsdesk/src/prompt.ts`)
- Consumes: `buildObituaryFacts(target: ObituaryTarget, timeline: LifeTimeline, priors: PlayerPriors): ObituaryFacts` — **three arguments as of Task 7**
- Consumes: `describeDeath(facts: ObituaryFacts): string`
- Unchanged signature: `composeTags(facts: ObituaryFacts, llmTags: string[]): string[]`

Steps:

- [ ] **Step 10.1: Add the failing facts test for the suicide arm.**
  In `apps/newsdesk/test/facts.test.ts`, insert immediately after the `it("classifies a non-pvp death as environment, killer null")` block (currently ends line 65). Note the third argument `noPriors` — the fixture is defined by Task 7 Step 7.1 in this same file, and `buildObituaryFacts` now requires it:
  ```ts
  it("classifies a suicide as its own category, never environment", () => {
    const f = buildObituaryFacts(target, timeline({ life: { deathCause: "suicide", deathByGamertag: null, deathWeapon: null, playtimeSeconds: 5381 }, kills: [] }), noPriors);
    expect(f.causeCategory).toBe("suicide");
    expect(f.killerGamertag).toBeNull();
  });

  it("a very short suicide is NOT a fresh-spawn victim (that flag is pvp-only)", () => {
    const f = buildObituaryFacts(target, timeline({ life: { deathCause: "suicide", deathByGamertag: null, deathWeapon: null, playtimeSeconds: 15 }, kills: [] }), noPriors);
    expect(f.causeCategory).toBe("suicide");
    expect(f.freshSpawnVictim).toBe(false);
  });
  ```

- [ ] **Step 10.2: Run it and watch it fail.**
  ```
  pnpm --filter @onelife/newsdesk test test/facts.test.ts
  ```
  Expected: `AssertionError: expected 'environment' to be 'suicide'` in the first new test (the second passes already — it is a regression guard).

- [ ] **Step 10.3: Widen the union and add the arm.**
  In `apps/newsdesk/src/facts.ts` line 19, replace:
  ```ts
    causeCategory: "pvp" | "environment" | "unknown";
  ```
  with:
  ```ts
    // "suicide" is its own category: a deliberate self-inflicted end is neither a player kill nor
    // an act of the environment, and the two read completely differently in prose and imagery.
    causeCategory: "pvp" | "suicide" | "environment" | "unknown";
  ```
  Then replace lines 55–56:
  ```ts
    const causeCategory: ObituaryFacts["causeCategory"] =
      cause === "pvp" || killerGamertag ? "pvp" : cause ? "environment" : "unknown";
  ```
  with:
  ```ts
    // Order matters: a killer name outranks everything (a player did it), then the explicit suicide
    // token, then any other stated cause, then nothing at all.
    const causeCategory: ObituaryFacts["causeCategory"] =
      cause === "pvp" || killerGamertag
        ? "pvp"
        : cause === "suicide"
          ? "suicide"
          : cause
            ? "environment"
            : "unknown";
  ```

- [ ] **Step 10.4: Pin `freshSpawnVictim` to pvp explicitly.**
  Still in `apps/newsdesk/src/facts.ts`, replace line 73:
  ```ts
      freshSpawnVictim: causeCategory === "pvp" && timeAliveSeconds < FRESH_SPAWN_SECONDS,
  ```
  with:
  ```ts
      // Deliberately pvp-only: the flag exists to protect a victim from being mocked for being
      // preyed upon. A short suicide has no predator — it must never trip the protective branch,
      // which would make the prompt hunt for a killer that does not exist.
      freshSpawnVictim: causeCategory === "pvp" && timeAliveSeconds < FRESH_SPAWN_SECONDS,
  ```

- [ ] **Step 10.5: Run the facts test and watch it pass.**
  ```
  pnpm --filter @onelife/newsdesk test test/facts.test.ts
  ```
  Expected: all tests pass, including `classifies a missing cause as unknown` and `classifies a non-pvp death as environment, killer null` (unchanged behaviour for `bled_out`).

- [ ] **Step 10.6: Add the failing tag + fallback tests.**
  In `apps/newsdesk/test/prompt.test.ts`, change the import on line 2 to include `causeCategoryTag`:
  ```ts
  import { buildObituaryPrompt, describeDeath, parseObituary, composeTags, causeCategoryTag, OBITUARY_PROMPT_VERSION } from "../src/prompt.js";
  ```
  Add inside `describe("composeTags")` (before its closing `});`):
  ```ts
  it("tags a suicide Self-Inflicted, not Unknown", () => {
    expect(causeCategoryTag("suicide")).toBe("Self-Inflicted");
    expect(causeCategoryTag("pvp")).toBe("PvP");
    expect(causeCategoryTag("environment")).toBe("Environment");
    expect(causeCategoryTag("unknown")).toBe("Unknown");
    const f = mkFacts({ cause: "suicide", causeCategory: "suicide", killerGamertag: null, weapon: null });
    expect(composeTags(f, ["Elektro"])).toEqual(["Obituaries", "Chernarus", "Self-Inflicted", "Elektro"]);
  });
  ```
  Add inside `describe("describeDeath")`:
  ```ts
  it("a suicide with no verdict reads in-voice, not as the raw token", () => {
    const s = describeDeath(mkFacts({ cause: "suicide", causeCategory: "suicide", killerGamertag: null, weapon: null, verdict: null }));
    expect(s).toBe("died by their own hand (not a player kill).");
  });
  ```

- [ ] **Step 10.7: Run it and watch it fail.**
  ```
  pnpm --filter @onelife/newsdesk test test/prompt.test.ts
  ```
  Expected two failures: `expected 'Unknown' to be 'Self-Inflicted'` and `expected 'suicide (not a player kill).' to be 'died by their own hand (not a player kill).'`

- [ ] **Step 10.8: Update `causeCategoryTag` and the `describeDeath` fallback.**
  In `apps/newsdesk/src/prompt.ts` replace lines 119–121:
  ```ts
  export function causeCategoryTag(cat: ObituaryFacts["causeCategory"]): string {
    return cat === "pvp" ? "PvP" : cat === "environment" ? "Environment" : "Unknown";
  }
  ```
  with:
  ```ts
  export function causeCategoryTag(cat: ObituaryFacts["causeCategory"]): string {
    switch (cat) {
      case "pvp":
        return "PvP";
      case "suicide":
        return "Self-Inflicted";
      case "environment":
        return "Environment";
      default:
        return "Unknown";
    }
  }
  ```
  Then replace lines 26–29:
  ```ts
    const v = facts.verdict;
    if (!v) {
      return facts.cause ? `${facts.cause.replace(/_/g, " ")} (not a player kill).` : "unknown.";
    }
  ```
  with:
  ```ts
    const v = facts.verdict;
    if (!v) {
      // The bare "suicide" token must never reach the model as a raw word — it is the one cause
      // whose phrasing carries a duty of care, so phrase it here exactly as the verdict path does.
      if (facts.cause === "suicide") return "died by their own hand (not a player kill).";
      return facts.cause ? `${facts.cause.replace(/_/g, " ")} (not a player kill).` : "unknown.";
    }
  ```
  **Task 13 rewrites this same block. It quotes the post-Task-10 form above — apply Task 10 first.**

- [ ] **Step 10.9: Run the prompt tests and watch them pass.**
  ```
  pnpm --filter @onelife/newsdesk test test/prompt.test.ts
  ```
  Expected: all pass.

- [ ] **Step 10.10: Typecheck the whole package (catches the two typed `ObituaryFacts` literals).**
  ```
  pnpm --filter @onelife/newsdesk typecheck
  ```
  Expected: clean, no output errors. The literals in `test/prompt.test.ts` and `test/generate.test.ts` still typecheck because the union only widened and no property was added in this task (Task 7 already added `priors`/`isKnownQuantity` to both). If `tsc` reports anything, fix it before committing.

- [ ] **Step 10.11: Run the full package suite and commit.**
  ```
  TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test \
    pnpm --filter @onelife/newsdesk test
  git add apps/newsdesk/src/facts.ts apps/newsdesk/src/prompt.ts apps/newsdesk/test/facts.test.ts apps/newsdesk/test/prompt.test.ts
  git commit -m "fix(newsdesk): give suicide its own cause category and Self-Inflicted tag"
  ```

---

### Task 11: Audit the six `causeCategory`-gated image predicates for `"suicide"`

> **Dormant-path work.** `findImageTargets` excludes `obituary` and `birth_notice` (`apps/newsdesk/src/image-pg-store.ts:43` — `notInArray(articles.kind, ["obituary", "birth_notice"])`, per `docs/superpowers/specs/2026-07-18-drop-obituary-birth-images-design.md`), so no obituary receives an image today and no `MORGUE_CATEGORIES` gate can fire for a suicide obituary. This task keeps the menu correct for the future `news` kind and locks the suicide stance in tests; it changes no shipped output.

**Files:**
- Modify: `apps/newsdesk/src/image-categories.ts`
- Test: `apps/newsdesk/test/image-categories.test.ts`

**Interfaces:**
- Consumes: `eligibleCategories(kind: ArticleKind, facts: FactsSnapshot): ImageCategory[]`
- Consumes: `MORGUE_CATEGORIES: ImageCategory[]`, `ImageCategory.eligible: (facts: FactsSnapshot) => boolean`
- Produces: no signature change — only predicate bodies. `MORGUE_CATEGORIES.length` stays **16** (the existing menu-count test must keep passing; this task adds no category).

The audit, gate by gate — this is the decision record, encode exactly this:

| slug | current gate | fires for suicide today? | verdict | why |
|---|---|---|---|---|
| `vantage` | `causeCategory === "pvp" && weapon != null` | no | **stay excluded** | "THE SHOT CAME FROM HERE" asserts a distant shooter. There is no shooter. |
| `approached-for-comment` | `causeCategory === "pvp" && killerGamertag != null` | no | **stay excluded** | Depicts a suspect dodging the lens. There is no suspect to approach. |
| `effects` | `causeCategory === "environment"` | no | **WIDEN to include suicide** | "RECOVERED EFFECTS" — belongings left behind, no body, no blame. This is the single most appropriate morgue framing for a self-inflicted death and it currently cannot fire. |
| `first-aid-attempted` | `causeCategory !== "pvp"` | yes (already) | **keep firing, pin it deliberately** | An empty saline bag implies someone tried. Dignified, imply-don't-depict, no accusation. Already correct — lock it with a test so a future rewrite to an allow-list does not silently drop it. |
| `trail-ends-here` | `causeCategory === "unknown" \|\| (=== "environment" && map === "sakhal")` | no | **stay excluded** | A trail stopping mid-stride is the *mystery* framing. A suicide is the one cause where the record is unambiguous; mystery imagery would misreport it. |
| `visibility-factor` | `causeCategory === "environment" \|\| === "unknown"` | no | **stay excluded** | The caption "VISIBILITY WAS A FACTOR" attributes causation to conditions. Attributing a deliberate act to fog is both factually wrong and tonally glib. |

Net code change: one predicate (`effects`). Five are correct as written; the tests make that explicit rather than accidental.

Steps:

- [ ] **Step 11.1: Add the failing suicide-gate test.**
  In `apps/newsdesk/test/image-categories.test.ts`, add inside `describe("eligibleCategories — obituary gates")`, after the `trail-ends-here` test (currently ends line 40):
  ```ts
  it("suicide gates: effects + first-aid fire; blame/mystery/conditions framings never do", () => {
    const suicide = { ...base, causeCategory: "suicide", cause: "suicide" };
    const s = slugs("obituary", suicide);
    // Fires — belongings and an attempted rescue are dignified, imply-don't-depict framings.
    expect(s).toContain("effects");
    expect(s).toContain("first-aid-attempted");
    // Never fires — these assert a shooter, a suspect, a mystery, or a blameless condition.
    expect(s).not.toContain("vantage");
    expect(s).not.toContain("approached-for-comment");
    expect(s).not.toContain("trail-ends-here");
    expect(s).not.toContain("visibility-factor");
    // A suicide on Sakhal still must not borrow the mystery framing.
    expect(slugs("obituary", { ...suicide, map: "sakhal" })).not.toContain("trail-ends-here");
    // Ungated categories are unaffected.
    for (const slug of ["aftermath", "last-known", "witnesses", "memorial"]) expect(s).toContain(slug);
  });
  ```

- [ ] **Step 11.2: Run it and watch it fail.**
  ```
  pnpm --filter @onelife/newsdesk test test/image-categories.test.ts
  ```
  Expected: `expected [ ... ] to contain 'effects'` — the only failing assertion, which confirms the other five gates are already correct.

- [ ] **Step 11.3: Widen the `effects` predicate.**
  In `apps/newsdesk/src/image-categories.ts` replace line 42:
  ```ts
      eligible: (f) => f.causeCategory === "environment" },
  ```
  with:
  ```ts
      // Suicide included deliberately: recovered belongings are the one morgue framing that
      // reports a self-inflicted death without a body, a suspect, or an assigned blame.
      eligible: (f) => f.causeCategory === "environment" || f.causeCategory === "suicide" },
  ```

- [ ] **Step 11.4: Annotate the five gates that intentionally exclude suicide.**
  In the same file, append to the existing comment header (after line 7):
  ```ts
  // causeCategory is a widened union as of the suicide fix: "pvp" | "suicide" | "environment" |
  // "unknown". These predicates read it off a Record<string, unknown>, so the compiler will NOT
  // flag a missing arm — every gate below states its suicide stance explicitly on purpose.
  ```
  Then add a trailing comment to each of the five unchanged gates, on the line above its `eligible:`:
  - line 33 (`vantage`): `// Excludes suicide: asserts a distant shooter who does not exist.`
  - line 57 (`approached-for-comment`): `// Excludes suicide: there is no suspect to approach.`
  - line 60 (`first-aid-attempted`): `// Includes suicide via !== "pvp" — intentional: an attempted rescue is dignified.`
  - line 54 (`trail-ends-here`): `// Excludes suicide: mystery framing misreports the one unambiguous cause.`
  - line 63 (`visibility-factor`): `// Excludes suicide: never attribute a deliberate act to the weather.`

- [ ] **Step 11.5: Run the test and watch it pass.**
  ```
  pnpm --filter @onelife/newsdesk test test/image-categories.test.ts
  ```
  Expected: all pass, including `carries 16 morgue and 13 nursery categories` (no category added) and `first-aid excludes pvp; effects/visibility need environment or unknown` (the `environment` base case is untouched).

- [ ] **Step 11.6: Commit.**
  ```
  TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test \
    pnpm --filter @onelife/newsdesk test
  git add apps/newsdesk/src/image-categories.ts apps/newsdesk/test/image-categories.test.ts
  git commit -m "fix(newsdesk): audit image scene gates for the suicide cause category"
  ```

---

### Task 12: Give the prompt the suicide duration so a spawn reroll and a long life diverge

> **Line numbers below are as of the pre-PR file; anchor every edit on the quoted code, not the line number.** Tasks 4, 9 and 10 already inserted lines ahead of these.

**Files:**
- Modify: `apps/newsdesk/src/facts.ts` (export the threshold constant)
- Modify: `apps/newsdesk/src/prompt.ts` (the tone branch)
- Test: `apps/newsdesk/test/prompt.test.ts`

**Interfaces:**
- Produces: `export const SUICIDE_RESET_SECONDS = 300` in `apps/newsdesk/src/facts.ts`
- Consumes: `ObituaryFacts` fields `causeCategory`, `timeAliveSeconds`, `timeAliveLabel`, `isLegend`
- Consumes/produces: `buildObituaryPrompt(facts: ObituaryFacts, recent?: RecentProse[])` — signature unchanged by this task (no new parameter, so every existing call site keeps compiling)

Steps:

- [ ] **Step 12.1: Add the failing divergence test.**
  In `apps/newsdesk/test/prompt.test.ts`, add inside `describe("buildObituaryPrompt")`:
  ```ts
  it("a sub-5-minute suicide is framed as a spawn reroll, not a decision", () => {
    const { user } = buildObituaryPrompt(mkFacts({
      isLegend: false, kills: 0, killerGamertag: null, weapon: null,
      cause: "suicide", causeCategory: "suicide",
      timeAliveSeconds: 20, timeAliveLabel: "0m", verdict: null,
    }));
    expect(user).toMatch(/reroll/i);
    expect(user).toContain("20 seconds");
    expect(user).not.toMatch(/despair|weight of/i);
  });

  it("a long suicide is framed as the end of a real run, and says how long it lasted", () => {
    const { user } = buildObituaryPrompt(mkFacts({
      isLegend: false, kills: 2, killerGamertag: null, weapon: null,
      cause: "suicide", causeCategory: "suicide",
      timeAliveSeconds: 5381, timeAliveLabel: "1h 29m", verdict: null,
    }));
    expect(user).toMatch(/lasted 1h 29m/);
    expect(user).not.toMatch(/reroll/i);
    expect(user).toMatch(/never treat the act itself as the punchline/i);
  });

  it("a non-suicide death keeps the default tone branch", () => {
    const { user } = buildObituaryPrompt(mkFacts({ isLegend: false, freshSpawnVictim: false, causeCategory: "environment", cause: "bled_out" }));
    expect(user).toMatch(/state funeral for an idiot/);
    expect(user).not.toMatch(/reroll/i);
  });
  ```

- [ ] **Step 12.2: Run it and watch it fail.**
  ```
  pnpm --filter @onelife/newsdesk test test/prompt.test.ts
  ```
  Expected: two failures — `expected '…' to match /reroll/i` and `expected '…' to match /lasted 1h 29m/`; the third test passes already.

- [ ] **Step 12.3: Export the threshold.**
  In `apps/newsdesk/src/facts.ts`, after line 6 (`export const FRESH_SPAWN_SECONDS = 1800;`) add:
  ```ts
  /** Under this, a self-inflicted death is a spawn reroll (a bad beach, a broken leg on landing),
   *  not the end of a run. Published suicides span 15s–5381s; the prompt must not read them alike. */
  export const SUICIDE_RESET_SECONDS = 300; // 5 min
  ```

- [ ] **Step 12.4: Add the suicide tone branch.**
  In `apps/newsdesk/src/prompt.ts`, **add `SUICIDE_RESET_SECONDS` to the existing value import added in Task 9** — do NOT collapse the two lines into one, because that would delete the `timeAliveLabel` import Task 9's priors block depends on and `tsc` would fail with `Cannot find name 'timeAliveLabel'`. The two import lines become:
  ```ts
  import type { ObituaryFacts } from "./facts.js";
  import { timeAliveLabel, SUICIDE_RESET_SECONDS } from "./facts.js";
  ```
  Then replace the tone block, lines 75–81:
  ```ts
    if (facts.isLegend) {
      lines.push(`This was a LEGEND (a long life and/or a high kill count). Use the reverent tone — a sincere send-off with exactly one small needle.`);
    } else if (facts.freshSpawnVictim) {
  ```
  with:
  ```ts
    if (facts.causeCategory === "suicide" && facts.timeAliveSeconds < SUICIDE_RESET_SECONDS) {
      lines.push(`This was a SELF-INFLICTED death, ${Math.round(facts.timeAliveSeconds)} seconds after this life began. Frame it as a REROLL, not a decision: a bad beach, a broken leg on landing, a spawn nobody wanted — a survivor pressing the reset button on a life that had not started yet. Bureaucratic deadpan, a filing error, an administrative footnote. There is no story arc to eulogize because there was no arc. Do not reach for despair, meaning, or the weight of anything.`);
    } else if (facts.causeCategory === "suicide") {
      lines.push(`This was a SELF-INFLICTED death that ended a real run — the life lasted ${facts.timeAliveLabel} before it ended. Frame it as a survivor closing their own book after a genuine stretch out there: the record they built is the story, and the ending is the last line of it, reported flatly. Never treat the act itself as the punchline and never speculate about a state of mind — you have the record, not the reason. Any needle lands on the circumstances of the run, never on the person.`);
    } else if (facts.isLegend) {
      lines.push(`This was a LEGEND (a long life and/or a high kill count). Use the reverent tone — a sincere send-off with exactly one small needle.`);
    } else if (facts.freshSpawnVictim) {
  ```
  (The two suicide branches precede `isLegend` deliberately: a legend who ends their own life must still get the suicide handling, not a reverent send-off that misreads the ending.)

- [ ] **Step 12.5: Run the prompt tests and watch them pass.**
  ```
  pnpm --filter @onelife/newsdesk test test/prompt.test.ts
  ```
  Expected: all pass. Note the long-suicide test asserts `lasted 1h 29m` — supplied by `facts.timeAliveLabel`, which `buildObituaryFacts` already computes.

- [ ] **Step 12.6: Full suite, typecheck, commit.**
  ```
  TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test \
    pnpm --filter @onelife/newsdesk test
  pnpm --filter @onelife/newsdesk typecheck
  git add apps/newsdesk/src/facts.ts apps/newsdesk/src/prompt.ts apps/newsdesk/test/prompt.test.ts
  git commit -m "feat(newsdesk): distinguish a spawn-reroll suicide from one that ends a real run"
  ```
  Expected: both commands clean; `test/tick.test.ts` and `test/birth-tick.test.ts` still pass (no `NewsdeskDeps` field was added, so both deps factories are untouched).

---

### Task 13: `describeDeath` — treat an unrecorded cause as an explicit unknown

> **Line numbers below are as of the pre-PR file; anchor every edit on the quoted code, not the line number.** Tasks 4, 9, 10 and 12 already inserted lines ahead of these.

The single highest-traffic path in the newsdesk: 19 of 84 recorded deaths carry the bare token `died`, and 18 of the 45 published obituaries were written from one. Today `describeDeath` hands the model that bare word (or the bare word `environment`), which the model dressed as a mechanism — a published headline read "Terrain" for a death actually recorded as `infected`. This task makes the unknown set (`null`, `""`, `died`, `environment`, `environmental`, `unknown`) return one explicit sentence that names the *absence*.

**Files:**
- Modify: `/Users/steveharmeyer/Development/dayz-one-life/one-life/apps/newsdesk/src/prompt.ts`
- Test: `/Users/steveharmeyer/Development/dayz-one-life/one-life/apps/newsdesk/test/prompt.test.ts`

**Interfaces:**

Consumes (post-Task-10 shape):
```ts
// apps/newsdesk/src/facts.ts
interface ObituaryFacts {
  cause: string | null;
  causeCategory: "pvp" | "suicide" | "environment" | "unknown";  // widened by Task 10
  killerGamertag: string | null;
  weapon: string | null;
  deathDistance: number | null;
  verdict: { cause: string; confidence: "high" | "low"; conditions: string[] } | null;
  priors: PlayerPriors;        // added by Task 7
  isKnownQuantity: boolean;    // added by Task 7
  // …see facts.ts for the full shape
}
```

Produces (new exports from `apps/newsdesk/src/prompt.ts`):
```ts
export const UNKNOWN_DEATH_PHRASE: string;                      // "unknown — the record does not name a mechanism."
export function isUnrecordedCause(cause: string | null | undefined): boolean;
export function describeDeath(facts: ObituaryFacts): string;    // signature UNCHANGED
```

Note: this task does **not** touch `facts.ts` — but Tasks 7, 10 and 12 already did (`priors`/`isKnownQuantity`, the four-value `causeCategory` union, `SUICIDE_RESET_SECONDS`), and Task 11 already modified `image-categories.ts` to widen the `effects` gate. No image gate flips as a result of *this* task.

**Steps:**

- [ ] **Step 13.1: Add the failing unknown-set tests.**
  In `/Users/steveharmeyer/Development/dayz-one-life/one-life/apps/newsdesk/test/prompt.test.ts`, extend the first import line (which Task 10 already extended with `causeCategoryTag`) to also pull the two new names:
  ```ts
  import { buildObituaryPrompt, describeDeath, parseObituary, composeTags, causeCategoryTag, OBITUARY_PROMPT_VERSION, UNKNOWN_DEATH_PHRASE, isUnrecordedCause } from "../src/prompt.js";
  ```
  Then append this block to the **end of the `describe("describeDeath", …)` block** (immediately before its closing `});`, after the existing `it("describeDeath: named killers read qualitatively", …)`):
  ```ts
    // D4 — the most-exercised path in the system: 19 of 84 recorded deaths carry a bare "died",
    // and 18 of 45 published obituaries were written from one. A bare mechanism token invites the
    // model to invent one ("Terrain" for a death actually recorded as infected).
    it.each([
      ["null cause", null],
      ["empty cause", ""],
      ["bare 'died'", "died"],
      ["bare 'environment'", "environment"],
      ["bare 'unknown'", "unknown"],
    ])("no verdict + %s reads as an explicit unknown, never a mechanism", (_label, cause) => {
      const s = describeDeath(mkFacts({ causeCategory: "environment", cause, verdict: null, killerGamertag: null }));
      expect(s).toBe(UNKNOWN_DEATH_PHRASE);
      expect(s).toBe("unknown — the record does not name a mechanism.");
      expect(s).not.toMatch(/fall|terrain|wolf|bear|animal|infected|starv|dehydrat|environment/i);
    });

    it("a verdict that names nothing also reads as an explicit unknown, keeping the factual state", () => {
      const s = describeDeath(mkFacts({
        causeCategory: "environment", cause: "died", killerGamertag: null,
        verdict: { cause: "unknown", confidence: "low", conditions: ["starving"] },
      }));
      expect(s).toBe("unknown — the record does not name a mechanism. At the end they were starving.");
    });

    it("an 'environmental' verdict over a REAL mechanism still names the mechanism", () => {
      const s = describeDeath(mkFacts({
        causeCategory: "environment", cause: "infected", killerGamertag: null,
        verdict: { cause: "environmental", confidence: "high", conditions: [] },
      }));
      expect(s).toBe("infected (not a player kill).");
    });

    it.each([
      ["infected", "infected (not a player kill)."],
      ["wolf", "wolf (not a player kill)."],
      ["bled_out", "bled out (not a player kill)."],
      ["fall", "fall (not a player kill)."],
    ])("a known cause (%s) with no verdict still describes normally", (cause, expected) => {
      expect(describeDeath(mkFacts({ causeCategory: "environment", cause, verdict: null, killerGamertag: null })))
        .toBe(expected);
    });

    it("pvp wins over an unrecorded cause token — a player kill is never an unknown", () => {
      const s = describeDeath(mkFacts({ causeCategory: "pvp", cause: "died", killerGamertag: "Kilo", weapon: "M4A1", deathDistance: 384.2, verdict: null }));
      expect(s).toBe("killed by another player (Kilo), M4A1, from 384m.");
    });

    it("isUnrecordedCause covers the unknown set, case- and whitespace-insensitively", () => {
      for (const c of [null, undefined, "", "  ", "died", "Died", " ENVIRONMENT ", "environmental", "unknown"]) {
        expect(isUnrecordedCause(c)).toBe(true);
      }
      for (const c of ["infected", "wolf", "bear", "animal", "fall", "pvp", "bled_out", "starvation", "suicide"]) {
        expect(isUnrecordedCause(c)).toBe(false);
      }
    });
  ```

- [ ] **Step 13.2: Run the test file and watch it fail.**
  ```bash
  cd /Users/steveharmeyer/Development/dayz-one-life/one-life
  TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test \
    pnpm --filter @onelife/newsdesk test test/prompt.test.ts
  ```
  (The port is 5434 on this dev machine via the gitignored `docker-compose.override.yml`; `docker compose up -d postgres` first if it isn't running. The vitest `globalSetup` needs the DB even for pure-unit files. Never append `-- run` — the script is already `vitest run`.)
  Expected failure — the import is undefined and the fallback still emits the bare token:
  ```
  FAIL  test/prompt.test.ts > describeDeath > no verdict + bare 'died' reads as an explicit unknown, never a mechanism
  AssertionError: expected 'died (not a player kill).' to be undefined
  ...
  FAIL  test/prompt.test.ts > describeDeath > isUnrecordedCause covers the unknown set...
  TypeError: isUnrecordedCause is not a function
  ```

- [ ] **Step 13.3: Add the unknown-set predicate and phrase to `prompt.ts`.**
  In `/Users/steveharmeyer/Development/dayz-one-life/one-life/apps/newsdesk/src/prompt.ts`, insert immediately **after** the `export const mapLabel = …` line (line 16 pre-PR) and **before** the `describeDeath` doc comment:
  ```ts
  /**
   * D4 — cause tokens that name no real mechanism. `died` is what the ADM parser writes when the
   * log line carries no killer and no entity; `environment`/`environmental` are the parser's and
   * classifier's catch-alls. Handing any of these to the model as a bare word invited invention
   * (a bare "environment" was published as the headline word "Terrain" for a death actually
   * recorded as infected). Treat them as an explicit unknown instead — the absence IS the story.
   */
  const UNRECORDED_CAUSES = new Set(["", "died", "environment", "environmental", "unknown"]);

  /** True when the cause token names no mechanism (null/empty/died/environment/unknown). */
  export function isUnrecordedCause(cause: string | null | undefined): boolean {
    return UNRECORDED_CAUSES.has((cause ?? "").trim().toLowerCase());
  }

  /** The one sentence the prompt gets when nothing named the mechanism. */
  export const UNKNOWN_DEATH_PHRASE = "unknown — the record does not name a mechanism.";
  ```

- [ ] **Step 13.4: Rewrite the non-pvp half of `describeDeath`.**
  In the same file, replace from `const v = facts.verdict;` through the function's closing `return` — i.e. everything after the pvp `return` up to and including the final `return` of the function.

  **Delete exactly this** (the post-Task-10 form — it includes the suicide line Task 10 added; if the file does not look like this, Task 10 has not been applied and you must stop and apply it first):
  ```ts
    const v = facts.verdict;
    if (!v) {
      // The bare "suicide" token must never reach the model as a raw word — it is the one cause
      // whose phrasing carries a duty of care, so phrase it here exactly as the verdict path does.
      if (facts.cause === "suicide") return "died by their own hand (not a player kill).";
      return facts.cause ? `${facts.cause.replace(/_/g, " ")} (not a player kill).` : "unknown.";
    }
    const noun: Record<string, string> = {
      suicide: "died by their own hand",
      starvation: "starvation — they ran out of food",
      dehydration: "dehydration — they ran out of water",
      bled_out: "bled out",
      mauled: "mauled — bleeding out after an animal or infected attack",
      wolf: "killed by a wolf",
      bear: "killed by a bear",
      animal: "killed by a wild animal",
      infected: "killed by the infected",
      fall: "died in a fall",
      vehicle: "killed by a vehicle",
      explosion: "killed in an explosion",
      environmental: facts.cause ? facts.cause.replace(/_/g, " ") : "the environment",
      unknown: "unknown",
    };
    const base = noun[v.cause] ?? v.cause.replace(/_/g, " ");
    const hedge = v.confidence === "low" ? "likely " : "";
    const conds = v.conditions.filter((c) => c !== "healthy");
    const state = conds.length
      ? ` At the end they were ${conds.join(" and ")}.`
      : v.conditions.includes("healthy") ? " They were in good health at the end." : "";
    return `${hedge}${base} (not a player kill).${state}`;
  ```
  and write exactly this in its place — **note the suicide line is preserved at the top of the `if (!v)` block**, ahead of the new unrecorded-cause check, so Task 10's test `a suicide with no verdict reads in-voice, not as the raw token` keeps passing:
  ```ts
    const v = facts.verdict;
    if (!v) {
      if (facts.cause === "suicide") return "died by their own hand (not a player kill).";
      // D4: no verdict and no mechanism token — say so plainly rather than emitting a bare word.
      if (isUnrecordedCause(facts.cause)) return UNKNOWN_DEATH_PHRASE;
      return `${facts.cause!.replace(/_/g, " ")} (not a player kill).`;
    }
    const conds = v.conditions.filter((c) => c !== "healthy");
    const state = conds.length
      ? ` At the end they were ${conds.join(" and ")}.`
      : v.conditions.includes("healthy") ? " They were in good health at the end." : "";
    const hedge = v.confidence === "low" ? "likely " : "";
    // D4: a verdict of "environmental"/"unknown" names nothing either. Fall back to the recorded
    // mechanism when there is one; otherwise it is an explicit unknown, plus the factual state.
    if (isUnrecordedCause(v.cause)) {
      if (isUnrecordedCause(facts.cause)) return `${UNKNOWN_DEATH_PHRASE}${state}`;
      return `${hedge}${facts.cause!.replace(/_/g, " ")} (not a player kill).${state}`;
    }
    const noun: Record<string, string> = {
      suicide: "died by their own hand",
      starvation: "starvation — they ran out of food",
      dehydration: "dehydration — they ran out of water",
      bled_out: "bled out",
      mauled: "mauled — bleeding out after an animal or infected attack",
      wolf: "killed by a wolf",
      bear: "killed by a bear",
      animal: "killed by a wild animal",
      infected: "killed by the infected",
      fall: "died in a fall",
      vehicle: "killed by a vehicle",
      explosion: "killed in an explosion",
    };
    const base = noun[v.cause] ?? v.cause.replace(/_/g, " ");
    return `${hedge}${base} (not a player kill).${state}`;
  ```
  The `environmental` and `unknown` entries are gone from the noun map on purpose — both are now intercepted above, so leaving them would be dead code that could silently resurrect the bug.

- [ ] **Step 13.5: Run the test file and watch it pass.**
  ```bash
  cd /Users/steveharmeyer/Development/dayz-one-life/one-life
  TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test \
    pnpm --filter @onelife/newsdesk test test/prompt.test.ts
  ```
  Expected: **all tests in the file green** — including the four pre-existing `describeDeath` cases (`pvp includes killer, weapon, and distance`, `high-confidence starvation is qualitative`, `low confidence hedges with 'likely'`, `no verdict falls back to the mechanism, humanized` — `bled_out` is not in the unknown set, so it still returns `"bled out (not a player kill)."`) and Task 10's suicide case. The reported count is **higher than 25**, because Tasks 4, 9, 10 and 12 each added cases to this file; do not treat a number above 25 as a problem.

- [ ] **Step 13.6: Typecheck and commit.**
  ```bash
  cd /Users/steveharmeyer/Development/dayz-one-life/one-life
  pnpm --filter @onelife/newsdesk typecheck
  git add apps/newsdesk/src/prompt.ts apps/newsdesk/test/prompt.test.ts
  git commit -m "fix(newsdesk): describeDeath reads an unrecorded cause as an explicit unknown

A bare mechanism token (died/environment/unknown/null) was handed to the model
verbatim, which dressed it as a mechanism — a published headline read 'Terrain'
for a death recorded as infected. 19 of 84 deaths carry a bare 'died'.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NSa9MaBB8aheaCBZfLWy79"
  ```
  Expected typecheck output: no errors (exit 0).

---

### Task 14: `buildObituaryPrompt` — forbid inventing a mechanism when the cause is unrecorded

> **Line numbers below are as of the pre-PR file; anchor every edit on the quoted code, not the line number.** Tasks 4, 9, 10, 12 and 13 already inserted lines ahead of these.

Task 13 stopped the *facts line* from leaking a bare token. This task adds the matching instruction, because a model handed "cause of death: unknown" will still reach for a plausible mechanism unless told not to. The constraint must appear **only** when the cause is genuinely unrecorded — on a known cause it would be noise, and on a pvp death it would be false.

**Files:**
- Modify: `/Users/steveharmeyer/Development/dayz-one-life/one-life/apps/newsdesk/src/prompt.ts`
- Test: `/Users/steveharmeyer/Development/dayz-one-life/one-life/apps/newsdesk/test/prompt.test.ts`

**Interfaces:**

Consumes (from Task 13): `isUnrecordedCause(cause: string | null | undefined): boolean`, `UNKNOWN_DEATH_PHRASE: string`.

Produces (new exports from `apps/newsdesk/src/prompt.ts`):
```ts
export const NO_MECHANISM_DIRECTIVE: string;
export function causeUnrecorded(facts: ObituaryFacts): boolean;
export function buildObituaryPrompt(facts: ObituaryFacts, recent?: RecentProse[]): { system: string; user: string }; // signature UNCHANGED by this task
```
`buildObituaryPrompt` keeps the signature Task 4 gave it (a single required `facts` plus an optional, defaulted `recent`), so none of the existing call sites in `test/prompt.test.ts`, nor `generateObituary` in `src/generate.ts`, change.

**Steps:**

- [ ] **Step 14.1: Add the failing prompt-level tests.**
  In `/Users/steveharmeyer/Development/dayz-one-life/one-life/apps/newsdesk/test/prompt.test.ts`, extend the import from `../src/prompt.js` to also pull the two new names:
  ```ts
  import { buildObituaryPrompt, describeDeath, parseObituary, composeTags, causeCategoryTag, OBITUARY_PROMPT_VERSION, UNKNOWN_DEATH_PHRASE, isUnrecordedCause, NO_MECHANISM_DIRECTIVE, causeUnrecorded } from "../src/prompt.js";
  ```
  Then append to the **end of the `describe("buildObituaryPrompt", …)` block** (immediately before its closing `});`):
  ```ts
    // D4 — 18 of the 45 published obituaries were written from a bare "died". Saying "unknown" in
    // the facts is not enough; the model must be told that inventing a mechanism is the failure.
    it.each([
      ["null cause", null],
      ["bare 'died'", "died"],
      ["bare 'environment'", "environment"],
      ["bare 'unknown'", "unknown"],
    ])("adds the no-invention constraint when the cause is unrecorded (%s)", (_label, cause) => {
      const { user } = buildObituaryPrompt(mkFacts({
        causeCategory: "environment", cause, killerGamertag: null, verdict: null,
        isLegend: false, freshSpawnVictim: false,
      }));
      expect(user).toContain(NO_MECHANISM_DIRECTIVE);
      expect(user).toContain("THE CAUSE OF DEATH IS NOT RECORDED");
      expect(user).toContain("the ABSENCE of a cause IS the story");
      expect(user).toContain(UNKNOWN_DEATH_PHRASE);
    });

    it("omits the constraint for a recorded mechanism", () => {
      const { user } = buildObituaryPrompt(mkFacts({
        causeCategory: "environment", cause: "infected", killerGamertag: null,
        verdict: { cause: "infected", confidence: "high", conditions: [] },
        isLegend: false, freshSpawnVictim: false,
      }));
      expect(user).not.toContain(NO_MECHANISM_DIRECTIVE);
      expect(user).toContain("killed by the infected");
    });

    it("omits the constraint for a pvp death even when the cause token is bare", () => {
      const { user } = buildObituaryPrompt(mkFacts({
        causeCategory: "pvp", cause: "died", killerGamertag: "Kilo", weapon: "M4A1", verdict: null,
        isLegend: false, freshSpawnVictim: false,
      }));
      expect(user).not.toContain(NO_MECHANISM_DIRECTIVE);
      expect(user).toContain("killed by another player (Kilo)");
    });

    it("causeUnrecorded is false for pvp and for any recorded mechanism", () => {
      expect(causeUnrecorded(mkFacts({ causeCategory: "environment", cause: "died", killerGamertag: null, verdict: null }))).toBe(true);
      expect(causeUnrecorded(mkFacts({ causeCategory: "environment", cause: null, killerGamertag: null, verdict: null }))).toBe(true);
      expect(causeUnrecorded(mkFacts({ causeCategory: "pvp", cause: "died", killerGamertag: "Kilo", verdict: null }))).toBe(false);
      expect(causeUnrecorded(mkFacts({ causeCategory: "environment", cause: "wolf", killerGamertag: null, verdict: null }))).toBe(false);
      expect(causeUnrecorded(mkFacts({
        causeCategory: "environment", cause: "died", killerGamertag: null,
        verdict: { cause: "starvation", confidence: "high", conditions: [] },
      }))).toBe(false);
    });
  ```

- [ ] **Step 14.2: Run the test file and watch it fail.**
  ```bash
  cd /Users/steveharmeyer/Development/dayz-one-life/one-life
  TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test \
    pnpm --filter @onelife/newsdesk test test/prompt.test.ts
  ```
  Expected failure:
  ```
  FAIL  test/prompt.test.ts > buildObituaryPrompt > adds the no-invention constraint when the cause is unrecorded (bare 'died')
  AssertionError: expected '…' to contain undefined
  FAIL  test/prompt.test.ts > buildObituaryPrompt > causeUnrecorded is false for pvp and for any recorded mechanism
  TypeError: causeUnrecorded is not a function
  ```

- [ ] **Step 14.3: Add the directive constant and the gate predicate.**
  In `/Users/steveharmeyer/Development/dayz-one-life/one-life/apps/newsdesk/src/prompt.ts`, insert immediately **after** the `UNKNOWN_DEATH_PHRASE` line added in Task 13 and **before** the `describeDeath` doc comment:
  ```ts
  /**
   * D4 companion constraint. Saying "unknown" in the facts block is not enough — a model handed a
   * blank will fill it. This names the failure mode explicitly and reframes the gap as the angle.
   */
  export const NO_MECHANISM_DIRECTIVE =
    `THE CAUSE OF DEATH IS NOT RECORDED. Do NOT name or imply a mechanism — no fall, no terrain, no exposure, no animal, no infected, no starvation, no thirst, no weather, no ambush. Do not guess, hedge toward, or hint at one, and do not dress the blank up as a cause. The paper does not know. Say so: the ABSENCE of a cause IS the story — the record simply stops, and a life ends with nothing written next to it. Write the gap, not a mechanism.`;

  /**
   * True when nothing in the record names a mechanism for this death. A player kill is never
   * unrecorded (the killer IS the mechanism), so pvp short-circuits to false.
   */
  export function causeUnrecorded(facts: ObituaryFacts): boolean {
    if (facts.causeCategory === "pvp" || facts.killerGamertag) return false;
    return isUnrecordedCause(facts.cause) && isUnrecordedCause(facts.verdict?.cause ?? null);
  }
  ```
  (`isUnrecordedCause(null)` is `true`, so a null `verdict` correctly defers the decision to `facts.cause`.)

- [ ] **Step 14.4: Push the directive into the user prompt.**
  Still in `apps/newsdesk/src/prompt.ts`, inside `buildObituaryPrompt`, find this line (line 83 in the pre-PR file, just after the `lines.push("")` that follows the tone branch):
  ```ts
    lines.push(`Describe the manner of death in qualitative terms — never quote raw stat numbers (energy or water values).`);
  ```
  and insert **directly after it**, before the existing `if (facts.verdict?.confidence === "low")` block:
  ```ts
    if (causeUnrecorded(facts)) {
      lines.push(NO_MECHANISM_DIRECTIVE);
    }
  ```
  Nothing else moves. The `- Cause of death:` facts line already carries `UNKNOWN_DEATH_PHRASE` from Task 13, which is what the `expect(user).toContain(UNKNOWN_DEATH_PHRASE)` assertion checks — the two halves of D4 land in the same prompt.

- [ ] **Step 14.5: Run the test file and watch it pass.**
  ```bash
  cd /Users/steveharmeyer/Development/dayz-one-life/one-life
  TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test \
    pnpm --filter @onelife/newsdesk test test/prompt.test.ts
  ```
  Expected: **all tests in the file green**, including the pre-existing `prompt lists ordeal lines only when counts are non-zero and hedges low-confidence causes` test — its fixture has `cause: "died"` but a `verdict.cause` of `"starvation"`, so `causeUnrecorded` is `false` and the directive is correctly absent while `"hedge it in-voice"` still appears. The reported count is **higher than 32**, because Tasks 4, 9, 10, 12 and 13 each added cases to this file; a number above 32 is expected, not a problem.

- [ ] **Step 14.6: Typecheck and commit.**
  ```bash
  cd /Users/steveharmeyer/Development/dayz-one-life/one-life
  pnpm --filter @onelife/newsdesk typecheck
  git add apps/newsdesk/src/prompt.ts apps/newsdesk/test/prompt.test.ts
  git commit -m "feat(newsdesk): forbid inventing a mechanism when the cause is unrecorded

Adds NO_MECHANISM_DIRECTIVE to the obituary prompt, gated on causeUnrecorded()
so it appears only for a genuinely blank cause — never for pvp or a recorded
mechanism. The absence of a cause is the angle, not a blank to be filled.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NSa9MaBB8aheaCBZfLWy79"
  ```

---

### Task 15: D4 regression sweep across the whole newsdesk suite

`describeDeath` output is embedded in every obituary prompt and, through `generateObituary`, in the tick tests and the frozen `articles.facts` snapshot. This task proves nothing else moved. No production code is expected to change; if a test fails, fix the test only when the new behavior is correct, and stop otherwise.

**Files:**
- Modify: none expected (see Step 15.3 contingency)
- Test: `/Users/steveharmeyer/Development/dayz-one-life/one-life/apps/newsdesk/test/` (whole directory)

**Interfaces:** consumes `describeDeath`, `buildObituaryPrompt`, `causeUnrecorded`, `isUnrecordedCause`, `UNKNOWN_DEATH_PHRASE`, `NO_MECHANISM_DIRECTIVE` — all as produced by Tasks 13 and 14. Produces nothing new.

**Steps:**

- [ ] **Step 15.1: Confirm nothing outside the new predicate reads the removed noun-map keys.**
  ```bash
  cd /Users/steveharmeyer/Development/dayz-one-life/one-life
  grep -rn "environmental" apps packages --include=*.ts
  ```
  Expected: inside `apps/newsdesk/src/prompt.ts` there is **exactly one** hit — the string `"environmental"` inside the `UNRECORDED_CAUSES` set added by Task 13. The two noun-map keys are gone. Any remaining hits are in `packages/domain` / `packages/read-models` where `classifyDeath` may still *emit* the token — which is exactly what `isUnrecordedCause` now absorbs. Do not edit those.

- [ ] **Step 15.2: Run the full newsdesk suite.**
  ```bash
  cd /Users/steveharmeyer/Development/dayz-one-life/one-life
  docker compose up -d postgres
  TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test \
    pnpm --filter @onelife/newsdesk test
  ```
  (Per-package `pnpm --filter` is the reliable path — turbo strips `TEST_DATABASE_URL`.)
  Expected: every file green. Note what each file's state actually is after this PR:
  - `test/facts.test.ts` — **modified by Tasks 7, 10 and 12**: it now defines `noPriors`/`vetPriors`, every `buildObituaryFacts` call takes three arguments, and `causeCategory` is a four-value union. `it("classifies a non-pvp death as environment, killer null")` and `it("classifies a missing cause as unknown")` still pass unchanged (`bled_out` and `null` are unaffected by the suicide arm).
  - `test/image-categories.test.ts` — **modified by Task 11**: the `effects` gate now also fires for `"suicide"`, and the new suicide-gate test locks the other five stances. `carries 16 morgue and 13 nursery categories` still passes.
  - `test/prompt.test.ts` — modified by Tasks 4, 7, 9, 10, 12, 13 and 14.
  - `test/generate.test.ts` — fixture literal patched by Task 7; generator calls unchanged.
  - `test/tick.test.ts`, `test/birth-tick.test.ts` — modified by Tasks 5, 6 and 8.
  - `test/voice.test.ts`, `test/prose-pg-store.test.ts`, `test/prose-block.test.ts`, `test/prose-backstop.test.ts` — created by Tasks 1, 2, 3 and 6.
  ```
  Test Files  N passed (N)
       Tests  M passed (M)
  ```

- [ ] **Step 15.3 (contingency): if `test/tick.test.ts` fails on prompt content.**
  It should not — `seedQualifiedDeath` seeds `deathCause: "pvp"` with `deathByGamertag: "Killer"`, so `causeUnrecorded` is `false` and neither Task 13's nor Task 14's change is reached. Confirm that seeding before touching anything:
  ```bash
  cd /Users/steveharmeyer/Development/dayz-one-life/one-life
  grep -n "deathCause\|deathByGamertag" apps/newsdesk/test/tick.test.ts
  ```
  Expected: the `seedQualifiedDeath` helper inserts `deathCause: "pvp"` and `deathByGamertag: "Killer"`. If the test still fails, the failure is real: re-read `describeDeath` rather than loosening the assertion.

- [ ] **Step 15.4: Typecheck the whole monorepo.**
  ```bash
  cd /Users/steveharmeyer/Development/dayz-one-life/one-life
  pnpm turbo run typecheck
  ```
  Expected: all packages pass. `ObituaryFacts` **was** modified in this PR — Task 7 added `priors` and `isKnownQuantity` and patched the two typed literals in `test/prompt.test.ts` and `test/generate.test.ts`, and Task 10 widened `causeCategory` — so this step is confirming those patches are complete, not that the type is untouched. `@onelife/newsdesk` is the only package with an `ObituaryFacts` consumer, so no other package should move.

- [ ] **Step 15.5: Commit if anything was touched.**
  If Steps 15.1–15.4 required no edits, skip the commit — Tasks 13 and 14 already carry the change. Otherwise:
  ```bash
  cd /Users/steveharmeyer/Development/dayz-one-life/one-life
  git add -p apps/newsdesk
  git commit -m "test(newsdesk): D4 regression sweep

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NSa9MaBB8aheaCBZfLWy79"
  ```

---

### Task 16: CHANGELOG entry (required by the PR gate)

`CLAUDE.md` requires `CHANGELOG.md` on **every** PR, and the fork guard blocks a PR without it. `CHANGELOG.md` currently has an empty `## [Unreleased]` block; no earlier task touches it. `CLAUDE.md` itself stays untouched — spec §14 defers it to PR-C.

**Files:**
- Modify: `CHANGELOG.md` (repo root)

**Interfaces:** none — documentation only.

**Steps:**

- [ ] **Step 16.1: Add the four entries under `## [Unreleased]` → `### Fixed`.**
  In `CHANGELOG.md`, under the `## [Unreleased]` heading's `### Fixed` sub-heading, add exactly these four lines:
  ```
  - newsdesk: suicides get their own cause category (`Self-Inflicted`), with a spawn-reroll vs. real-run tone split.
  - newsdesk: obituaries now receive the player's global priors, so an 11th life is no longer headlined as a debut.
  - newsdesk: an unrecorded cause of death reads as an explicit unknown; the model is forbidden from inventing a mechanism.
  - newsdesk: both desks are shown their recently published prose and forbidden from reusing an attribution, with a deterministic backstop that drops a repeated one.
  ```

- [ ] **Step 16.2: Commit.**
  ```bash
  cd /Users/steveharmeyer/Development/dayz-one-life/one-life
  git add CHANGELOG.md
  git commit -m "docs(changelog): PR-A newsdesk prose-quality fixes"
  ```

- [ ] **Step 16.3: Final verification before opening the PR.**
  ```bash
  cd /Users/steveharmeyer/Development/dayz-one-life/one-life
  TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test \
    pnpm --filter @onelife/newsdesk test
  pnpm turbo run typecheck
  git status
  ```
  Expected: full newsdesk suite green, monorepo typecheck clean, working tree clean. The PR targets `develop`.
