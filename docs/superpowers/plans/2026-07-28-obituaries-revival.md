# Obituaries Revival Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore LLM-written obituaries — and only obituaries — from the retired content engine: a dry-run-gated `apps/newsdesk` sweep publishing to a recreated `articles` table, a public `/obituaries` feed + article page, a life-timeline link, and sitemap entries, with a new No-Place Rule (prompt + deterministic validator) and a forward-only `NEWSDESK_SINCE` cutoff.

**Architecture:** Nearly everything is restored file-by-file from git ref `aaeabd0^` (the parent of "retire the content engine", PR #260) and pruned of birth-notice/news/image/Discord/newsroom code. New code: migration `0030` (trimmed `articles` table), the no-place validator, the `NEWSDESK_SINCE` gate, and the `obituary-v3` prompt edits.

**Tech Stack:** pnpm + turbo monorepo, TypeScript/ESM, Postgres + Drizzle, Fastify, Next.js, vitest, OpenRouter via plain `fetch` (no SDK).

**Spec:** `docs/superpowers/specs/2026-07-28-obituaries-revival-design.md`

## Global Constraints

- **Restore source is always `aaeabd0^`**: `git show 'aaeabd0^:<path>' > <path>` (quote paths containing `[slug]` or `(site)`).
- **NOT restored, ever:** birth notices, news vertical, editorial newsroom, Discord webhook, image pipeline (`article_images`, `ArticleHero`, OG image routes), `obituary_published` notifications, nav/tab-bar/front-page/dossier ("In The Paper") surfaces, `NEWS_PREVIEW_TOKEN`, the pre-removal article rows.
- **No-Place Rule:** obituary prose may name **the map and nothing finer** — no buildings/structures, towns, landmarks, terrain, compass directions. Enforced by prompt (`obituary-v3`) AND the deterministic validator (one retry with named violations, then the existing failure path).
- **`NEWSDESK_DRY_RUN` defaults `true`** (`!== "false"` safe-side parse). **`NEWSDESK_SINCE` unset = obituary pass OFF** — never a silent epoch default.
- **Articles match a life by the rebuild-stable tuple `(server_id, gamertag, life_started_at)` — NEVER `life_number`.**
- **`articles` is durable:** in `APP_TABLES`, never in `REBUILD_TRUNCATE_TABLES`. Migration `0030` deploys with plain `./deploy/deploy.sh`, no `--rebuild`.
- **The three sitemap fetches degrade independently** (separate try/catch each).
- DB test suites need `TEST_DATABASE_URL`; migrate the test DB with `DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @onelife/db run db:migrate`. Full suite: `pnpm turbo run test --concurrency=1`; typecheck: `pnpm turbo run typecheck`.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Migration 0030 — recreate the trimmed `articles` table

**Files:**
- Create: `packages/db/drizzle/0030_articles_revival.sql`
- Modify: `packages/db/drizzle/meta/_journal.json` (hand-append — the drizzle snapshot chain has been broken since `0015`; hand-written is the repo practice)
- Modify: `packages/db/src/schema.ts` (add `articles` definition)
- Modify: `packages/test-support/src/global-setup.ts` (add `"articles"` to `APP_TABLES`)
- Test: `packages/read-models/test/articles-schema.test.ts` (restore, pruned)

**Interfaces:**
- Produces: drizzle table `articles` exported from `@onelife/db` with camelCase fields `id, kind, status, slug, serverId, gamertag, map, mapSlug, lifeNumber, lifeStartedAt, deathAt, timeAliveSeconds, kills, longestKillMeters, cause, headline, lede, body, pullQuoteText, pullQuoteAttribution, tags, facts, promptVersion, model, attempts, lastError, bodyBlocks, generatedAt, createdAt`. Columns deliberately **absent** vs the pre-`0027` shape: the seven `image_*` columns, `discord_posted_at`, `natural_key` (and their indexes, plus `articles_kind_status_born_idx`, `articles_subject_idx`, `articles_killer_idx`).

- [ ] **Step 1: Write the migration**

`packages/db/drizzle/0030_articles_revival.sql`:

```sql
-- Obituaries revival: recreate `articles`, dropped by 0027, trimmed to the obituary slice.
-- Deliberately absent vs the pre-0027 shape: the seven image_* columns and their index
-- (no image pipeline), discord_posted_at and its index (no Discord notifier), natural_key and
-- its unique index (news-only dedupe), the born feed index (birth notices), and the
-- subject/killer expression indexes (In The Paper is not restored).
-- DURABLE table: in APP_TABLES, never in REBUILD_TRUNCATE_TABLES. kind stays text; only
-- 'obituary' is written, but the partial unique index keeps the historical two-kind predicate
-- VERBATIM so the restored upserts' targetWhere matches it (a mismatched predicate is 42P10).
CREATE TABLE "articles" (
  "id" bigserial PRIMARY KEY,
  "kind" text NOT NULL,
  "status" text NOT NULL DEFAULT 'published',
  "slug" text,
  "server_id" integer REFERENCES "servers"("id"),
  "gamertag" text,
  "map" text,
  "map_slug" text,
  "life_number" integer,
  "life_started_at" timestamp with time zone,
  "death_at" timestamp with time zone,
  "time_alive_seconds" integer NOT NULL DEFAULT 0,
  "kills" integer NOT NULL DEFAULT 0,
  "longest_kill_meters" double precision,
  "cause" text,
  "headline" text,
  "lede" text,
  "body" text,
  "pull_quote_text" text,
  "pull_quote_attribution" text,
  "tags" text[],
  "facts" jsonb,
  "prompt_version" text,
  "model" text,
  "attempts" integer NOT NULL DEFAULT 0,
  "last_error" text,
  "body_blocks" jsonb,
  "generated_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "articles_kind_server_gamertag_life_uniq"
  ON "articles" ("kind", "server_id", "gamertag", "life_started_at")
  WHERE "kind" IN ('obituary', 'birth_notice');
CREATE UNIQUE INDEX "articles_slug_uniq" ON "articles" ("slug");
CREATE INDEX "articles_kind_status_death_idx" ON "articles" ("kind", "status", "death_at");
CREATE INDEX "articles_kind_status_created_idx" ON "articles" ("kind", "status", "created_at");
```

- [ ] **Step 2: Append the journal entry**

In `packages/db/drizzle/meta/_journal.json`, append after the `0029_avatars` entry (match its shape exactly; `when` is any epoch-ms after 0029's):

```json
{ "idx": 30, "version": "7", "when": 1785990000000, "tag": "0030_articles_revival", "breakpoints": true }
```

- [ ] **Step 3: Add the drizzle definition to `packages/db/src/schema.ts`**

Recover the old block as a starting point (`git show 'aaeabd0^:packages/db/src/schema.ts'`, the `export const articles = pgTable(...)` block), place it near the other durable tables, and trim it to exactly the columns/indexes in the SQL above: delete `imageUrl, imagePrompt, imageKind, imageCaption, imageModel, imageAttempts, imageError, discordPostedAt, naturalKey` and the `uniqNaturalKey, bornIdx, discordUnpostedIdx, imageMissingIdx, subjectIdx, killerIdx` index entries. Keep `uniqLife` (with its `.where(sql\`${t.kind} IN ('obituary','birth_notice')\`)` predicate verbatim), `uniqSlug`, `feedIdx`, `createdIdx`. Do NOT restore `articleImages`. Ensure the imports used (`bigserial`, `doublePrecision`, `jsonb`, `uniqueIndex`, …) are present in the file's import list.

- [ ] **Step 4: Add `"articles"` to `APP_TABLES`** in `packages/test-support/src/global-setup.ts` (alphabetical position in the array).

- [ ] **Step 5: Restore the schema test, pruned**

```bash
git show 'aaeabd0^:packages/read-models/test/articles-schema.test.ts' > packages/read-models/test/articles-schema.test.ts
```

Then edit it: remove `articleImages` from the import; delete the entire `describe("articles birth notices (nullable death_at + born feed order)")` block and any other birth-notice/image describe; in the remaining obituary test delete the line `expect(row!.imageUrl).toBeNull(); // reserved R5c column present + nullable`.

- [ ] **Step 6: Migrate the test DB and run the test**

```bash
DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @onelife/db run db:migrate
pnpm --filter @onelife/read-models run test -- articles-schema
```

Expected: migration applies 0030; test PASSES.

- [ ] **Step 7: Typecheck db + test-support, then commit**

```bash
pnpm --filter @onelife/db --filter @onelife/test-support run typecheck
git add packages/db packages/test-support packages/read-models/test/articles-schema.test.ts
git commit -m "feat(db): migration 0030 — recreate the articles table, trimmed to the obituary slice"
```

---

### Task 2: Restore `apps/newsdesk` scaffolding + pure core library

**Files:**
- Restore verbatim from `aaeabd0^`: `apps/newsdesk/package.json`, `apps/newsdesk/tsconfig.json`, `apps/newsdesk/vitest.config.ts`, `apps/newsdesk/src/facts.ts`, `apps/newsdesk/src/obituary-url.ts`, `apps/newsdesk/src/prose-block.ts`, `apps/newsdesk/src/prose-backstop.ts`, `apps/newsdesk/src/prose-pg-store.ts`
- Restore + prune: `apps/newsdesk/src/openrouter.ts`
- Test (restore verbatim): `apps/newsdesk/test/facts.test.ts`, `test/obituary-url.test.ts`, `test/prose-block.test.ts`, `test/prose-backstop.test.ts`, `test/prose-pg-store.test.ts`, `test/openrouter.test.ts`

**Interfaces:**
- Consumes: `articles` from Task 1 (`prose-pg-store.ts` queries it), `getLifeTimeline`/`getPlayerPriors`/`OrdealSummary`/`PlayerPriors` from `@onelife/read-models` (current, unchanged signatures — verified: `getLifeTimeline(db, serverId, gamertag, lifeId)` and the `verdict/ordeals/hpLow/kills/sessions/life` fields `facts.ts` reads all still exist; the removed `character` field was never read here).
- Produces: `buildObituaryFacts(target, timeline, priors): ObituaryFacts`, `timeAliveLabel(seconds)`, `isUnrecordedCause(cause)`, `SUICIDE_RESET_SECONDS`; `obituaryUrl(siteUrl, slug)`; `recentProse(db, kind, limit): Promise<RecentProse[]>`; `recentProseBlock(recent)`; `dedupePullQuote(obituary, recent)`; `openrouterComplete(args)`, `openrouterClient(cfg): CompletionClient`.

- [ ] **Step 1: Restore the files**

```bash
mkdir -p apps/newsdesk/src apps/newsdesk/test
for f in package.json tsconfig.json vitest.config.ts; do git show "aaeabd0^:apps/newsdesk/$f" > "apps/newsdesk/$f"; done
for f in facts.ts obituary-url.ts prose-block.ts prose-backstop.ts prose-pg-store.ts openrouter.ts; do git show "aaeabd0^:apps/newsdesk/src/$f" > "apps/newsdesk/src/$f"; done
for f in facts.test.ts obituary-url.test.ts prose-block.test.ts prose-backstop.test.ts prose-pg-store.test.ts openrouter.test.ts; do git show "aaeabd0^:apps/newsdesk/test/$f" > "apps/newsdesk/test/$f"; done
```

- [ ] **Step 2: Prune `openrouter.ts` and `package.json`**

- `openrouter.ts`: delete everything from `export interface GeneratedImage` to the end of the file (the image API half: `GeneratedImage`, `ImageClient`, `openrouterImage`, `openrouterImageClient`). Keep `openrouterComplete` + `openrouterClient`. Note both reference `CompletionClient` from `./generate.js`, which doesn't exist until Task 5 — add a temporary local declaration is NOT allowed; instead reorder: `openrouter.ts` keeps its `import type { CompletionClient } from "./generate.js";` and this task also restores a **minimal** `apps/newsdesk/src/generate.ts` containing ONLY the interface (the full generator lands in Task 5):

```ts
/** The one capability the generator needs — real OpenRouter in prod, a stub in tests. */
export interface CompletionClient {
  complete(req: { system: string; user: string }): Promise<string>;
}
```

- `package.json`: delete the `"newsroom": "tsx src/newsroom/main.ts"` script line.
- `facts.ts` imports `type { ObituaryTarget } from "./pg-store.js"` (Task 6). To keep this task compiling on its own, also restore `apps/newsdesk/src/pg-store.ts` now (Step 3) — it only depends on `@onelife/db` + `@onelife/read-models`.

- [ ] **Step 3: Restore + prune `pg-store.ts` and its DB tests**

```bash
git show 'aaeabd0^:apps/newsdesk/src/pg-store.ts' > apps/newsdesk/src/pg-store.ts
git show 'aaeabd0^:apps/newsdesk/test/pg-store.test.ts' > apps/newsdesk/test/pg-store.test.ts
git show 'aaeabd0^:apps/newsdesk/test/partial-index-upsert.test.ts' > apps/newsdesk/test/partial-index-upsert.test.ts
```

Prune `pg-store.ts`: delete the Discord tail — `interface UnpostedObituary`, `findUnpostedObituaries`, `markObituaryPosted` (everything after `recordObituaryFailure`). Remove now-unused imports (`asc`, `isNull` — keep only what remains referenced).
Prune `partial-index-upsert.test.ts`: remove the `birth-pg-store` import line and every birth-notice describe/it (keep the obituary upsert + failure-stub + 42P10-guard coverage). Prune `pg-store.test.ts` the same way if it references Discord functions (`findUnpostedObituaries`/`markObituaryPosted`) — delete those describes.

- [ ] **Step 4: Wire the workspace and install**

```bash
pnpm install
```

(The workspace globs `apps/*`, so `@onelife/newsdesk` is picked up automatically; `pnpm-lock.yaml` regains its entry.)

- [ ] **Step 5: Run the task's tests**

```bash
pnpm --filter @onelife/newsdesk run test
pnpm --filter @onelife/newsdesk run typecheck
```

Expected: PASS. (`facts.test.ts`, `prose-*`, `obituary-url`, `openrouter`, `pg-store`, `partial-index-upsert` — the prompt/voice/tick/config/generate tests don't exist yet.)

- [ ] **Step 6: Commit**

```bash
git add apps/newsdesk pnpm-lock.yaml
git commit -m "feat(newsdesk): restore the obituary core — facts, prose helpers, pg-store, OpenRouter client"
```

---

### Task 3: Prompt v3 + voice with the No-Place Rule

**Files:**
- Restore + edit: `apps/newsdesk/src/prompt.ts`, `apps/newsdesk/src/voice.ts`
- Test (restore + edit): `apps/newsdesk/test/prompt.test.ts`, `apps/newsdesk/test/voice.test.ts`, `apps/newsdesk/test/cause-coherence.test.ts`

**Interfaces:**
- Consumes: `ObituaryFacts`, `timeAliveLabel`, `SUICIDE_RESET_SECONDS`, `isUnrecordedCause` (Task 2), `RecentProse`/`recentProseBlock` (Task 2).
- Produces: `OBITUARY_PROMPT_VERSION = "obituary-v3"`, `buildObituaryPrompt(facts, recent): {system, user}`, `parseObituary(raw): Obituary`, `composeTags(facts, llmTags)`, `mapLabel(map)`, `type Obituary`; `OBITUARY_SYSTEM`.

- [ ] **Step 1: Restore the four files**

```bash
for f in prompt.ts voice.ts; do git show "aaeabd0^:apps/newsdesk/src/$f" > "apps/newsdesk/src/$f"; done
for f in prompt.test.ts voice.test.ts cause-coherence.test.ts; do git show "aaeabd0^:apps/newsdesk/test/$f" > "apps/newsdesk/test/$f"; done
```

- [ ] **Step 2: Write the failing tests for the v3 changes** (append to `voice.test.ts` / `prompt.test.ts`)

```ts
// voice.test.ts
it("carries the No-Place Rule and has retired the Fog Rule", () => {
  expect(OBITUARY_SYSTEM).toContain("THE NO-PLACE RULE");
  expect(OBITUARY_SYSTEM).not.toContain("FOG RULE");
  expect(OBITUARY_SYSTEM).not.toMatch(/locale like/i); // no "a locale like Elektro" tag example
});

// prompt.test.ts
it("is prompt version obituary-v3", () => {
  expect(OBITUARY_PROMPT_VERSION).toBe("obituary-v3");
});
it("still carries the map dateline line — the map is the one allowed place", () => {
  const { user } = buildObituaryPrompt(baseFacts()); // reuse the file's existing facts fixture helper
  expect(user).toContain("Dateline (map only");
});
```

- [ ] **Step 3: Run to verify the new tests fail** — `pnpm --filter @onelife/newsdesk run test -- prompt` and `-- voice`. Expected: the new assertions FAIL (old text still present).

- [ ] **Step 4: Edit `voice.ts`** — three changes to `OBITUARY_SYSTEM`, everything else verbatim:

1. Voice constant 6: replace `never a live location (see Fog Rule)` with `never a place finer than the map (see The No-Place Rule)`.
2. Replace the `- THE FOG RULE: …` bullet with:

```
- THE NO-PLACE RULE: the record carries no location for any death, so any setting is invention. Prose must contain ZERO spatial or setting references — no buildings or structures (barns, sheds, churches, apartments, towers), no town or landmark names, no terrain (coasts, forests, hills, ridges, roads, fields), no compass directions, no "somewhere north of". The ONE exception is the map name itself (the dateline) — it is confirmed data and may be used. The story is the life and the death, never a where.
```

3. In the `tags:` output instruction, replace `(a locale like "Elektro", a theme like "Poultry")` with `(a theme like "Poultry" — never a place of any kind)`.

- [ ] **Step 5: Edit `prompt.ts`** — set `export const OBITUARY_PROMPT_VERSION = "obituary-v3";`. No other change (the dateline line stays — the map is allowed).

- [ ] **Step 6: Fix any restored assertions that pinned the old text** — if `voice.test.ts`/`prompt.test.ts` assert `FOG RULE`, the Elektro example, or `"obituary-v2"`, update those assertions to the v3 equivalents (they are pinning exactly what this task deliberately changed).

- [ ] **Step 7: Run and commit**

```bash
pnpm --filter @onelife/newsdesk run test -- prompt voice cause-coherence
git add apps/newsdesk
git commit -m "feat(newsdesk): obituary-v3 prompt — the Fog Rule becomes the No-Place Rule"
```

---

### Task 4: The no-place validator

**Files:**
- Create: `apps/newsdesk/src/no-place.ts`, `apps/newsdesk/src/map-places.json` (vendored copy)
- Test: `apps/newsdesk/test/no-place.test.ts`

**Interfaces:**
- Consumes: `type Obituary` (Task 3).
- Produces: `findPlaceViolations(obituary: Obituary, opts: { exempt: string[] }): string[]` — lower-cased distinct violating terms, empty when clean; `PLACE_EXEMPT_MAPS: string[]` (map labels + codenames).

- [ ] **Step 1: Vendor the place list**

```bash
cp apps/web/src/lib/map-places.json apps/newsdesk/src/map-places.json
```

Add a note to the header comment of `apps/web/scripts/refresh-map-places.mjs`: `// NOTE: apps/newsdesk/src/map-places.json is a vendored copy for the obituary no-place validator — re-copy it whenever this file is regenerated.`

- [ ] **Step 2: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { findPlaceViolations, PLACE_EXEMPT_MAPS } from "../src/no-place.js";
import type { Obituary } from "../src/prompt.js";

const clean: Obituary = {
  headline: "A Long Walk Ends",
  lede: "He survived nine days on Chernarus.",
  body: "The record shows patience and one mistake.",
  pullQuote: { text: "He was careful until he wasn't.", attribution: "an unnamed rival" },
  tags: ["Poultry"],
};

describe("findPlaceViolations", () => {
  it("passes clean prose that names only the map", () => {
    expect(findPlaceViolations(clean, { exempt: [] })).toEqual([]);
  });
  it("catches a real place name from the vendored list, in any field", () => {
    const dirty = { ...clean, body: "He died within sight of Chernogorsk." };
    expect(findPlaceViolations(dirty, { exempt: [] })).toEqual(["chernogorsk"]);
  });
  it("catches a structure word from the curated list", () => {
    const dirty = { ...clean, lede: "Found in a barn, nine days old." };
    expect(findPlaceViolations(dirty, { exempt: [] })).toEqual(["barn"]);
  });
  it("catches a terrain word and a violating tag", () => {
    const dirty = { ...clean, headline: "Death on the Coast", tags: ["Elektro"] };
    expect(findPlaceViolations(dirty, { exempt: [] }).sort()).toEqual(["coast", "elektro"]);
  });
  it("exempts gamertags — a callsign containing a banned word never trips it", () => {
    const dirty = { ...clean, body: "BarnOwl was the last to see him." };
    expect(findPlaceViolations(dirty, { exempt: ["BarnOwl"] })).toEqual([]);
    // but a bare use of the word next to the exempt callsign still trips
    const both = { ...clean, body: "BarnOwl found him behind a barn." };
    expect(findPlaceViolations(both, { exempt: ["BarnOwl"] })).toEqual(["barn"]);
  });
  it("map labels and codenames are exempt", () => {
    for (const m of ["Chernarus", "Sakhal", "Livonia", "chernarusplus", "enoch"]) {
      expect(PLACE_EXEMPT_MAPS).toContain(m);
    }
    const withMaps = { ...clean, body: "Nine days on Livonia, longer than most manage on Sakhal." };
    expect(findPlaceViolations(withMaps, { exempt: [] })).toEqual([]);
  });
  it("matches on word boundaries only — 'roadmap' does not contain the banned 'road'", () => {
    const ok = { ...clean, body: "His roadmap was simple: survive." };
    expect(findPlaceViolations(ok, { exempt: [] })).toEqual([]);
  });
  it("is case-insensitive", () => {
    const dirty = { ...clean, body: "THE CHURCH WAS QUIET." };
    expect(findPlaceViolations(dirty, { exempt: [] })).toEqual(["church"]);
  });
});
```

- [ ] **Step 3: Run to verify failure** — `pnpm --filter @onelife/newsdesk run test -- no-place`. Expected: FAIL (module not found).

- [ ] **Step 4: Implement `apps/newsdesk/src/no-place.ts`**

```ts
import places from "./map-places.json" with { type: "json" };
import type { Obituary } from "./prompt.js";

/**
 * THE NO-PLACE RULE's enforcement half. The prompt alone is not trusted: any spatial reference
 * in an obituary is invention (deaths carry no coordinates), so a draft naming one is rejected.
 * Two banned vocabularies:
 *  (a) every real place name from the vendored map-places.json (a copy of the web's list —
 *      re-copy on terrain updates, see refresh-map-places.mjs);
 *  (b) a curated structure/terrain wordlist.
 * Exempt: the map labels/codenames (the one allowed place) and any caller-supplied gamertags
 * (a callsign like "BarnOwl" is identity, not scenery).
 */
export const PLACE_EXEMPT_MAPS = [
  "Chernarus", "Sakhal", "Livonia", "chernarusplus", "sakhal", "enoch",
];

const STRUCTURE_TERRAIN = [
  // structures
  "barn", "barns", "shed", "sheds", "church", "churches", "castle", "castles",
  "apartment", "apartments", "tower", "towers", "cabin", "cabins", "warehouse", "warehouses",
  "hangar", "hangars", "bunker", "bunkers", "farmhouse", "farmhouses", "shack", "shacks",
  "garage", "garages", "hospital", "hospitals", "barracks", "lighthouse", "lighthouses",
  "rooftop", "rooftops", "stairwell", "stairwells", "attic", "attics", "basement", "basements",
  // terrain
  "coast", "coasts", "coastline", "shore", "shoreline", "beach", "beaches",
  "forest", "forests", "woods", "woodland", "treeline", "tree line",
  "hill", "hills", "hilltop", "ridge", "ridges", "ridgeline", "valley", "valleys",
  "mountain", "mountains", "peak", "peaks", "cliff", "cliffs",
  "field", "fields", "meadow", "meadows", "swamp", "swamps", "marsh", "marshes",
  "river", "rivers", "lake", "lakes", "pond", "ponds", "island", "islands", "peninsula",
  "road", "roads", "highway", "highways", "crossroads", "railway", "railroad", "tracks",
  "airfield", "airstrip", "runway", "harbor", "harbour", "docks", "port", "ports",
  "town", "towns", "village", "villages", "city", "cities", "outskirts", "district",
  // directions-as-places
  "north", "south", "east", "west", "northern", "southern", "eastern", "western",
  "northeast", "northwest", "southeast", "southwest", "inland",
];

const exemptSet = new Set(PLACE_EXEMPT_MAPS.map((m) => m.toLowerCase()));

const PLACE_NAMES: string[] = [
  ...new Set(
    Object.values(places as Record<string, { name: string }[]>)
      .flat()
      .map((p) => p.name.toLowerCase())
      .filter((n) => n.length >= 3 && !exemptSet.has(n)),
  ),
];

const BANNED: string[] = [...new Set([...PLACE_NAMES, ...STRUCTURE_TERRAIN])];

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** All prose the model wrote — never the deterministic fields. */
function proseOf(o: Obituary): string {
  return [o.headline, o.lede, o.body, o.pullQuote?.text ?? "", o.pullQuote?.attribution ?? "", ...o.tags].join("\n");
}

/** Distinct lower-cased banned terms found in the draft's prose; [] when clean. */
export function findPlaceViolations(obituary: Obituary, opts: { exempt: string[] }): string[] {
  let text = proseOf(obituary).toLowerCase();
  // Blank out exempt substrings (gamertags, and the map names are never in BANNED anyway) so a
  // banned word INSIDE an exempt callsign cannot trip; a free-standing use still does.
  for (const e of opts.exempt) {
    if (!e) continue;
    text = text.replaceAll(e.toLowerCase(), " ");
  }
  const hits: string[] = [];
  for (const term of BANNED) {
    const re = new RegExp(`(?<![a-z0-9])${escapeRe(term)}(?![a-z0-9])`, "i");
    if (re.test(text)) hits.push(term);
  }
  // Collapse plural/singular duplicates of the same stem for a readable feedback list.
  return [...new Set(hits)];
}
```

Note for the implementer: if `import ... with { type: "json" }` trips the repo's TS config, fall back to `createRequire` (`const places = createRequire(import.meta.url)("./map-places.json")`) — match whatever `apps/web` does for its JSON import of the same file.

- [ ] **Step 5: Run tests to green, typecheck, commit**

```bash
pnpm --filter @onelife/newsdesk run test -- no-place && pnpm --filter @onelife/newsdesk run typecheck
git add apps/newsdesk apps/web/scripts/refresh-map-places.mjs
git commit -m "feat(newsdesk): deterministic no-place validator over the vendored place list"
```

---

### Task 5: `generate.ts` — obituary-only, with validate → retry-once → fail

**Files:**
- Modify: `apps/newsdesk/src/generate.ts` (replace the Task-2 stub with the full obituary generator)
- Test: `apps/newsdesk/test/generate.test.ts` (restore + prune + new cases)

**Interfaces:**
- Consumes: `buildObituaryPrompt`, `parseObituary`, `Obituary` (Task 3); `findPlaceViolations` (Task 4); `ObituaryFacts` (Task 2); `RecentProse` (Task 2).
- Produces: `interface CompletionClient { complete(req: {system, user}): Promise<string> }`; `generateObituary(client, facts, recent?): Promise<Obituary>` — now validating and retrying once.

- [ ] **Step 1: Restore + prune the test file**

```bash
git show 'aaeabd0^:apps/newsdesk/test/generate.test.ts' > apps/newsdesk/test/generate.test.ts
```

Delete the `generateBirthNotice` / `generateNews` describes and their imports.

- [ ] **Step 2: Add the failing retry-cycle tests** (append; reuse the file's existing stub-client/fixture helpers):

```ts
describe("no-place enforcement", () => {
  const dirtyJson = JSON.stringify({
    headline: "Death in a Barn", lede: "L", body: "B",
    pullQuote: null, tags: [],
  });
  const cleanJson = JSON.stringify({
    headline: "A Quiet End", lede: "L", body: "B", pullQuote: null, tags: [],
  });

  it("retries once with the violations named, and returns the clean second draft", async () => {
    const calls: { system: string; user: string }[] = [];
    const client = { complete: async (req: { system: string; user: string }) => {
      calls.push(req);
      return calls.length === 1 ? dirtyJson : cleanJson;
    }};
    const result = await generateObituary(client, facts(), []);
    expect(result.headline).toBe("A Quiet End");
    expect(calls).toHaveLength(2);
    expect(calls[1]!.user).toContain("barn");            // the violation is named in the feedback
    expect(calls[1]!.user).toContain("rejected");        // and framed as a rejection
  });

  it("throws after a second dirty draft — the tick's failure path handles it", async () => {
    const client = { complete: async () => dirtyJson };
    await expect(generateObituary(client, facts(), [])).rejects.toThrow(/no-place/i);
  });

  it("a draft naming only the map passes without a retry", async () => {
    const mapJson = JSON.stringify({
      headline: "Nine Days on Chernarus", lede: "L", body: "B", pullQuote: null, tags: [],
    });
    let calls = 0;
    const client = { complete: async () => { calls++; return mapJson; } };
    await generateObituary(client, facts(), []);
    expect(calls).toBe(1);
  });
});
```

(`facts()` = the file's existing `ObituaryFacts` fixture builder; if the restored file names it differently, use that name.)

- [ ] **Step 3: Run to verify the new tests fail** — `pnpm --filter @onelife/newsdesk run test -- generate`. Expected: FAIL (`generateObituary` missing / no validation).

- [ ] **Step 4: Implement `apps/newsdesk/src/generate.ts`** (full replacement of the stub):

```ts
import type { ObituaryFacts } from "./facts.js";
import { buildObituaryPrompt, parseObituary, type Obituary } from "./prompt.js";
import type { RecentProse } from "./prose-pg-store.js";
import { findPlaceViolations } from "./no-place.js";

/** The one capability the generator needs — real OpenRouter in prod, a stub in tests. */
export interface CompletionClient {
  complete(req: { system: string; user: string }): Promise<string>;
}

/** Gamertags are identity, not scenery — a callsign containing a banned word must not trip. */
function exemptions(facts: ObituaryFacts): string[] {
  return [facts.gamertag, facts.killerGamertag].filter((g): g is string => !!g);
}

/**
 * Build the prompt, call the model, parse + validate. A draft violating THE NO-PLACE RULE gets
 * exactly one retry with the violations named; a second violation throws, landing on the tick's
 * existing failure path (recordObituaryFailure → attempts++ → retried by a later sweep until
 * maxAttempts). Throws on client or parse failure too.
 */
export async function generateObituary(
  client: CompletionClient,
  facts: ObituaryFacts,
  recent: RecentProse[] = [],
): Promise<Obituary> {
  const { system, user } = buildObituaryPrompt(facts, recent);
  const exempt = exemptions(facts);

  const first = parseObituary(await client.complete({ system, user }));
  const violations = findPlaceViolations(first, { exempt });
  if (violations.length === 0) return first;

  const feedback = [
    user,
    "",
    `Your previous draft was rejected: it broke THE NO-PLACE RULE by mentioning ${violations.join(", ")}.`,
    `Rewrite the obituary with ZERO spatial or setting references — the map name is the only place you may use. Respond with only the JSON object.`,
  ].join("\n");
  const second = parseObituary(await client.complete({ system, user: feedback }));
  const still = findPlaceViolations(second, { exempt });
  if (still.length > 0) {
    throw new Error(`no-place violation after retry: ${still.join(", ")}`);
  }
  return second;
}
```

- [ ] **Step 5: Run all newsdesk tests + typecheck, commit**

```bash
pnpm --filter @onelife/newsdesk run test && pnpm --filter @onelife/newsdesk run typecheck
git add apps/newsdesk
git commit -m "feat(newsdesk): obituary generator validates the No-Place Rule with one named-feedback retry"
```

---

### Task 6: Config, tick with the `NEWSDESK_SINCE` gate, and `main.ts`

**Files:**
- Create (new, obituary-only): `apps/newsdesk/src/config.ts`, `apps/newsdesk/src/main.ts`
- Restore + edit: `apps/newsdesk/src/tick.ts`
- Modify: `apps/newsdesk/src/pg-store.ts` (`findObituaryTargets` gains `since`)
- Test: `apps/newsdesk/test/config.test.ts` (restore + prune + new), `apps/newsdesk/test/tick.test.ts` (restore + prune + new)

**Interfaces:**
- Consumes: everything from Tasks 2–5.
- Produces: `loadConfig(env): Config` where `Config = { databaseUrl, openrouterApiKey, model, dryRun, since: Date | null, intervalSeconds, batchCap, maxAttempts, temperature, logLevel }`; `newsdeskTick(db, deps)` where `NewsdeskDeps` gains `since: Date | null` (null ⇒ short-circuit to zeros); `findObituaryTargets(db, { limit, maxAttempts, since: Date })`.

- [ ] **Step 1: Restore + prune the tests, then add the new cases**

```bash
git show 'aaeabd0^:apps/newsdesk/test/config.test.ts' > apps/newsdesk/test/config.test.ts
git show 'aaeabd0^:apps/newsdesk/test/tick.test.ts' > apps/newsdesk/test/tick.test.ts
```

Prune from `config.test.ts`: every assertion about birth/news/image/Discord/longform/standing-dead/site-url fields (they no longer exist on `Config`). Prune from `tick.test.ts`: nothing structural (it is the obituary tick), but every `deps` literal gains `since: new Date("2020-01-01T00:00:00Z")` so existing cases still find their targets. Add:

```ts
// config.test.ts
it("parses NEWSDESK_SINCE; unset/blank/garbage ⇒ null (pass off)", () => {
  const base = { DATABASE_URL: "postgres://x" };
  expect(loadConfig({ ...base, NEWSDESK_SINCE: "2026-07-28T00:00:00Z" }).since)
    .toEqual(new Date("2026-07-28T00:00:00Z"));
  expect(loadConfig(base).since).toBeNull();
  expect(loadConfig({ ...base, NEWSDESK_SINCE: "" }).since).toBeNull();
  expect(loadConfig({ ...base, NEWSDESK_SINCE: "not-a-date" }).since).toBeNull();
});

// tick.test.ts
it("since: null short-circuits to zeros — no targets queried, no client call", async () => {
  const client = { complete: async () => { throw new Error("must not be called"); } };
  const r = await newsdeskTick(db, { ...deps(), client, since: null });
  expect(r).toEqual({ generated: 0, failed: 0, skipped: 0, dryRun: false });
});
it("a death before the cutoff is never a target", async () => {
  // seed one qualified death ended BEFORE `since` and one after (reuse the file's seed helpers);
  // run the tick with since between them; assert only the later life got an article.
});
```

(Write the second tick test fully against the restored file's real seed helpers — it must insert two qualified dead lives with `endedAt` straddling the cutoff and assert exactly one `articles` row.)

- [ ] **Step 2: Run to verify failures** — `pnpm --filter @onelife/newsdesk run test -- config tick`. Expected: FAIL (files missing / no `since`).

- [ ] **Step 3: Write `apps/newsdesk/src/config.ts`** (new file — the old one minus every birth/news/image/Discord field, plus `NEWSDESK_SINCE`):

```ts
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  OPENROUTER_API_KEY: z.string().default(""),
  NEWSDESK_MODEL: z.string().default("anthropic/claude-sonnet-5"),
  NEWSDESK_DRY_RUN: z.string().optional(),
  NEWSDESK_SINCE: z.string().optional(),
  NEWSDESK_INTERVAL_SECONDS: z.coerce.number().int().positive().default(300),
  NEWSDESK_BATCH_CAP: z.coerce.number().int().positive().default(10),
  NEWSDESK_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  NEWSDESK_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.7),
  LOG_LEVEL: z.string().default("info"),
});

export type Config = {
  databaseUrl: string;
  openrouterApiKey: string;
  model: string;
  dryRun: boolean;
  since: Date | null;
  intervalSeconds: number;
  batchCap: number;
  maxAttempts: number;
  temperature: number;
  logLevel: string;
};

/** Forward-only go-live cutoff. Unset / empty / unparseable -> null, which turns the obituary
 *  pass OFF — a safe default parallel to the dry-run gate (the NOTIFIER_SINCE pattern). Without
 *  it the first live sweep would generate an obituary for EVERY qualified death in history. */
function parseSince(raw: string | undefined): Date | null {
  if (!raw || raw.trim() === "") return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const p = schema.parse(env);
  return {
    databaseUrl: p.DATABASE_URL,
    openrouterApiKey: p.OPENROUTER_API_KEY,
    model: p.NEWSDESK_MODEL,
    // SAFE DEFAULT: dry-run unless explicitly disabled with "false".
    dryRun: p.NEWSDESK_DRY_RUN !== "false",
    since: parseSince(p.NEWSDESK_SINCE),
    intervalSeconds: p.NEWSDESK_INTERVAL_SECONDS,
    batchCap: p.NEWSDESK_BATCH_CAP,
    maxAttempts: p.NEWSDESK_MAX_ATTEMPTS,
    temperature: p.NEWSDESK_TEMPERATURE,
    logLevel: p.LOG_LEVEL,
  };
}
```

- [ ] **Step 4: Restore + edit `tick.ts`**

```bash
git show 'aaeabd0^:apps/newsdesk/src/tick.ts' > apps/newsdesk/src/tick.ts
```

Edits: add `since: Date | null;` to `NewsdeskDeps`; as the first statement of `newsdeskTick` add:

```ts
// SINCE gate: unset means OFF — never a silent epoch default that would obituarize all history.
if (deps.since === null) return { generated: 0, failed: 0, skipped: 0, dryRun: deps.dryRun };
```

and pass it through: `findObituaryTargets(db, { limit: deps.batchCap, maxAttempts: deps.maxAttempts, since: deps.since })`.

- [ ] **Step 5: Edit `pg-store.ts`** — `findObituaryTargets` opts become `{ limit: number; maxAttempts: number; since: Date }`; add to the `and(...)` alongside `isNotNull(lives.endedAt)`:

```ts
gte(lives.endedAt, opts.since),
```

(import `gte` from `drizzle-orm`). Update the seams in `pg-store.test.ts` / `partial-index-upsert.test.ts` that call it (pass an old `since`).

- [ ] **Step 6: Write `apps/newsdesk/src/main.ts`** (new file — the old loop, obituary pass only):

```ts
import pino from "pino";
import { getDb } from "@onelife/db";
import { loadConfig } from "./config.js";
import { newsdeskTick } from "./tick.js";
import { openrouterClient } from "./openrouter.js";
import { OBITUARY_PROMPT_VERSION } from "./prompt.js";

const cfg = loadConfig(process.env);
const log = pino({ level: cfg.logLevel });
const { db } = getDb(cfg.databaseUrl);
const client = openrouterClient({ apiKey: cfg.openrouterApiKey, model: cfg.model, temperature: cfg.temperature });

async function loop(): Promise<void> {
  log.info(
    { dryRun: cfg.dryRun, model: cfg.model, interval: cfg.intervalSeconds, batchCap: cfg.batchCap, since: cfg.since?.toISOString() ?? null },
    "newsdesk starting",
  );
  if (cfg.dryRun) log.warn("NEWSDESK_DRY_RUN is on — obituaries are logged, not generated or stored. Set NEWSDESK_DRY_RUN=false to generate.");
  if (cfg.since === null) {
    log.warn("NEWSDESK_SINCE is unset — the obituary pass is OFF. Set it to an ISO-8601 go-live timestamp to begin coverage.");
  } else {
    log.info({ since: cfg.since.toISOString() }, "obituary pass is on (forward-only from this cutoff)");
  }
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const r = await newsdeskTick(db, {
        client,
        dryRun: cfg.dryRun,
        since: cfg.since,
        batchCap: cfg.batchCap,
        maxAttempts: cfg.maxAttempts,
        promptVersion: OBITUARY_PROMPT_VERSION,
        model: cfg.model,
        now: new Date(),
        log,
      });
      if (r.generated || r.failed) log.info(r, "newsdesk tick");
    } catch (err) {
      log.error({ err }, "newsdesk tick failed");
    }
    await new Promise((r) => setTimeout(r, cfg.intervalSeconds * 1000));
  }
}

loop();
```

- [ ] **Step 7: Run the whole newsdesk suite + typecheck, commit**

```bash
pnpm --filter @onelife/newsdesk run test && pnpm --filter @onelife/newsdesk run typecheck
git add apps/newsdesk
git commit -m "feat(newsdesk): obituary-only worker loop behind NEWSDESK_DRY_RUN + forward-only NEWSDESK_SINCE"
```

---

### Task 7: Read-model — `obituary-articles.ts`

**Files:**
- Restore: `packages/read-models/src/obituary-articles.ts`, `packages/read-models/test/obituary-articles.test.ts`
- Modify: `packages/read-models/src/index.ts`

**Interfaces:**
- Consumes: `articles` (Task 1).
- Produces: `getPublishedObituaries(db, {page, pageSize?}): Promise<ObituariesFeed>`, `getObituaryBySlug(db, slug): Promise<ObituaryArticle | null>`, `OBITUARIES_FEED_PAGE_SIZE = 20`, types `ObituaryCard`, `ObituariesFeed`, `ObituaryArticle`, `ArticleBlock`, helper `assertSubjectful`.

- [ ] **Step 1: Restore both files**

```bash
git show 'aaeabd0^:packages/read-models/src/obituary-articles.ts' > packages/read-models/src/obituary-articles.ts
git show 'aaeabd0^:packages/read-models/test/obituary-articles.test.ts' > packages/read-models/test/obituary-articles.test.ts
```

The src file's comment says `ArticleBlock` is "imported by birth-notice-articles.ts" — that file is not restored; the comment may be trimmed but nothing else changes. If the test file seeds image/discord/natural-key columns, delete those keys from its seed literals (the columns are gone).

- [ ] **Step 2: Export it** — add `export * from "./obituary-articles.js";` to `packages/read-models/src/index.ts` (alphabetical among the existing lines).

- [ ] **Step 3: Run + commit**

```bash
pnpm --filter @onelife/read-models run test -- obituary-articles && pnpm --filter @onelife/read-models run typecheck
git add packages/read-models
git commit -m "feat(read-models): restore the published-obituaries feed and by-slug read-model"
```

---

### Task 8: `life-timeline.ts` regains `obituarySlug` — with the tuple-match proof

**Files:**
- Modify: `packages/read-models/src/life-timeline.ts`
- Test: `packages/read-models/test/life-timeline.test.ts` (restore the deleted `describe("obituarySlug")` block)

**Interfaces:**
- Produces: `LifeTimeline.obituarySlug: string | null` (published only).

- [ ] **Step 1: Restore the regression test block** — recover it from the removal diff (`git show aaeabd0 -- packages/read-models/test/life-timeline.test.ts`, the deleted `describe("obituarySlug")` hunk) and re-add it to the current test file. It must include the case proving the match keys on `(server_id, gamertag, life_started_at)` and NOT `life_number` (an article row with the right tuple but a different `life_number` still matches; a row with the right `life_number` but wrong `life_started_at` does not). If the recovered block seeds dropped columns, remove those keys.

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @onelife/read-models run test -- life-timeline`. Expected: FAIL (`obituarySlug` missing).

- [ ] **Step 3: Re-add the field.** In `life-timeline.ts`: import `articles` from `@onelife/db` and `and`/`sql` from `drizzle-orm` (alongside the existing imports); add to the `LifeTimeline` interface:

```ts
/** Slug of this life's published obituary, or null. Published only — a retracted article is a
 *  correction, not the life's obituary, and must never be linked as one. */
obituarySlug: string | null;
```

add a fifth arm to the existing `Promise.all` (after `avatarRow`):

```ts
db
  .select({ slug: articles.slug })
  .from(articles)
  .where(
    and(
      eq(articles.kind, "obituary"),
      eq(articles.status, "published"),
      eq(articles.serverId, serverId),
      sql`lower(${articles.gamertag}) = lower(${gamertag})`,
      // Identify the life by the rebuild-stable natural key (server_id, gamertag,
      // life_started_at) — matching `articles_kind_server_gamertag_life_uniq`. Never use
      // `life_number`: it is a derived count from projection fold and shifts if the fold
      // changes, while `life_started_at` is frozen at generation time and stays stable.
      eq(articles.lifeStartedAt, life.startedAt),
    ),
  )
  .limit(1),
```

destructure it as `obituaryRows` and add `obituarySlug: obituaryRows[0]?.slug ?? null,` to the return.

- [ ] **Step 4: Run + commit**

```bash
pnpm --filter @onelife/read-models run test -- life-timeline && pnpm --filter @onelife/read-models run typecheck
git add packages/read-models
git commit -m "feat(read-models): life timeline regains obituarySlug, with the tuple-match proof restored"
```

---

### Task 9: Sitemap regains articles — read-model, API, web route

**Files:**
- Modify: `packages/read-models/src/sitemap.ts`, `packages/read-models/test/sitemap.test.ts`
- Modify: `apps/api/test/sitemap-route.test.ts`
- Modify: `apps/web/src/app/sitemap.ts`, its test, and `apps/web/src/lib/types.ts` (`SitemapData` regains `articles`)

**Interfaces:**
- Produces: `SitemapEntries.articles: SitemapArticle[]` (`{kind, slug, lastmod}`, published + non-null slug only); web sitemap emits `/obituaries` static entry + one URL per article via `ARTICLE_PATHS = { obituary: "/obituaries" }`.

- [ ] **Step 1: Re-add the read-model arm.** In `packages/read-models/src/sitemap.ts`: re-add `articles` to the `@onelife/db` import and restore (from the removal diff shown by `git show aaeabd0 -- packages/read-models/src/sitemap.ts`) the `SitemapArticle` interface, the `articles` field on `SitemapEntries`, the published-articles query, and the `.filter((r): r is … => r.slug !== null).map(...)` mapping. Restore the doc-comment bullet about published-only articles.

- [ ] **Step 2: Extend the tests, proven red.** Two layers, and the degradation contract lives at a different layer than a first reading suggests — the web route makes only TWO fetches (`getServers()` and `getSitemapData()`); the article entries ride the existing `getSitemapData` call, so the web-side independence test needs no third arm.
  - `packages/read-models/test/sitemap.test.ts`: a published obituary appears in `articles` with `lastmod = created_at`; a `failed` row and a null-slug row do not. **Independence at this layer:** wrap each of the three queries inside `getSitemapEntries` in its own try/catch (returning `[]` for a failed arm) if they are not already, matching the spec's "every fetch keeps its own try/catch", and pin it with a test that stubs the articles query to throw and asserts players + lives still return — proven red against a version sharing one try/catch.
  - `apps/web/src/app/sitemap.ts`'s test: an article entry renders as `/obituaries/<slug>`, and the existing "data fetch fails → static + board entries survive" case still passes unchanged.

- [ ] **Step 3: Web side.** In `apps/web/src/lib/types.ts` re-add `articles: { kind: string; slug: string; lastmod: string }[]` to the `SitemapData` type. In `apps/web/src/app/sitemap.ts`: `STATIC_PATHS` becomes `["/", "/about", "/obituaries"]`; re-add

```ts
const ARTICLE_PATHS: Record<string, string> = { obituary: "/obituaries" };
```

and inside the existing `try` after the lives loop:

```ts
for (const a of data.articles) {
  const base = ARTICLE_PATHS[a.kind];
  if (!base) continue; // an unknown kind must never emit a URL that 404s
  entries.push({ url: absoluteUrl(`${base}/${a.slug}`), ...toLastModified(a.lastmod) });
}
```

- [ ] **Step 4: API route test.** `apps/api/src/routes/sitemap.ts` needs no change (it returns `getSitemapEntries(db)` whole); extend `apps/api/test/sitemap-route.test.ts` to assert the payload carries `articles` with a seeded published obituary.

- [ ] **Step 5: Run + commit**

```bash
pnpm --filter @onelife/read-models --filter @onelife/api --filter @onelife/web run test -- sitemap
git add packages/read-models apps/api apps/web
git commit -m "feat(sitemap): obituary URLs return — published only, real lastmod, independent degradation"
```

---

### Task 10: API — `GET /obituaries` + `GET /obituaries/:slug`

**Files:**
- Restore: `apps/api/src/routes/obituaries.ts`, `apps/api/test/obituaries.test.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- Consumes: `getPublishedObituaries`, `getObituaryBySlug` (Task 7).
- Produces: public `GET /obituaries?page=` (Zod `.catch(1)`) and `GET /obituaries/:slug` (404 `not_found` on miss). **No** `newsPreviewToken` parameter on `buildApp` — its signature stays `buildApp(db, opts?)`.

- [ ] **Step 1: Restore both files**

```bash
git show 'aaeabd0^:apps/api/src/routes/obituaries.ts' > apps/api/src/routes/obituaries.ts
git show 'aaeabd0^:apps/api/test/obituaries.test.ts' > apps/api/test/obituaries.test.ts
```

If the test seeds dropped columns (image/discord/natural-key), delete those keys.

- [ ] **Step 2: Register.** In `apps/api/src/app.ts` add `import { registerObituariesRoutes } from "./routes/obituaries.js";` and `registerObituariesRoutes(app, db);` next to `registerSurvivorsRoutes(app, db);`. Do NOT touch `buildApp`'s signature.

- [ ] **Step 3: Run + commit**

```bash
pnpm --filter @onelife/api run test -- obituaries && pnpm --filter @onelife/api run typecheck
git add apps/api
git commit -m "feat(api): restore the public obituaries feed and article routes"
```

---

### Task 11: Web lib + shared article components

**Files:**
- Restore verbatim: `apps/web/src/lib/obituary-format.ts` (+ test), `apps/web/src/lib/linkify-gamertags.tsx` (+ test), `apps/web/src/components/shared/article-body.tsx` (+ test), `apps/web/src/components/shared/pull-quote.tsx` (+ test), `apps/web/src/components/shared/numbered-pager.tsx`
- Restore + prune: `apps/web/src/lib/article-roster.ts` (+ test)
- Modify: `apps/web/src/lib/types.ts`, `apps/web/src/lib/api.ts`, `apps/web/src/lib/seo.ts` (+ seo test)

**Interfaces:**
- Produces: types `ArticleBlock`, `ObituaryCard`, `ObituariesFeed`, `ObituaryArticle` (HTTP shapes — `deathAt` is an ISO **string**); fetchers `getObituariesFeed(page)`, `getObituary(slug)`; `articleLd(a, url)`; `obituariesHref(page)`, `obituaryHref(slug)`, `dateline(map, deathAtIso, now)`, `rapSheetFacts(a)`, `obituaryShowingLine(page, pageSize, total)`; `linkifyGamertags`, `dedupeRoster`, `obituaryRoster(a)`, `MIN_LINKIFY_LENGTH`; components `ArticleBody`, `PullQuote`, `NumberedPager`.

- [ ] **Step 1: Restore the files**

```bash
for f in obituary-format.ts obituary-format.test.ts linkify-gamertags.tsx linkify-gamertags.test.tsx article-roster.ts article-roster.test.ts; do git show "aaeabd0^:apps/web/src/lib/$f" > "apps/web/src/lib/$f"; done
for f in article-body.tsx article-body.test.tsx pull-quote.tsx pull-quote.test.tsx numbered-pager.tsx; do git show "aaeabd0^:apps/web/src/components/shared/$f" > "apps/web/src/components/shared/$f"; done
```

Prune `article-roster.ts` (+ its test): delete `birthNoticeRoster` and `newsRoster` (and their tests) — only `obituaryRoster` has a consumer.

- [ ] **Step 2: Re-add the type/fetcher/JSON-LD slices** (recover exact text from `git show aaeabd0 -- apps/web/src/lib/types.ts apps/web/src/lib/api.ts apps/web/src/lib/seo.ts`, taking ONLY the obituary hunks):

- `types.ts`: re-add `ArticleBlock`, `ObituaryCard`, `ObituariesFeed`, `ObituaryArticle`, and `obituarySlug: string | null` on the life-timeline DTO. Do NOT re-add `PlayerArticleRow`, `PlayerArticlesFeed`, any birth-notice or news types.
- `api.ts`: re-add `getObituariesFeed` + `getObituary` and the `ObituariesFeed, ObituaryArticle` type imports. Do NOT re-add `getPlayerArticles`, birth-notice or news fetchers.
- `seo.ts`: re-add `articleLd` (obituary JSON-LD) and its test block. Do NOT re-add `birthNoticeLd`/`newsLd`.

- [ ] **Step 3: Run + commit**

```bash
pnpm --filter @onelife/web run test -- obituary-format linkify article-roster article-body pull-quote seo
pnpm --filter @onelife/web run typecheck
git add apps/web
git commit -m "feat(web): restore the obituary lib helpers, types, fetchers and shared article components"
```

---

### Task 12: Web — obituary components, pages, skeleton, timeline link

**Files:**
- Restore: `apps/web/src/components/obituaries/` (all 5 components + 3 tests), `apps/web/src/app/(site)/obituaries/page.tsx`, `.../obituaries/loading.tsx`, `.../obituaries/[slug]/page.tsx`
- Modify: `apps/web/src/components/skeletons.tsx` (+ test), `apps/web/src/components/life/hero.tsx` (+ test), `apps/web/src/lib/life-timeline.ts` type source if `LifeTimelineData` lives there
- NOT restored: any `opengraph-image.*` or `.ttf` under `obituaries/` (no bespoke OG), `ArticleHero`.

**Interfaces:**
- Consumes: everything from Task 11; `getPlayerLife`, `buildTimeline`, `Timeline` (all current and unchanged); `Kicker`, `GamertagLink`, `parsePage`, `playerSlug`, `lifeHref`, `mapLabel`, `verdictPhrase` (all current).
- Produces: `/obituaries` + `/obituaries/[slug]` routes; `ObituariesSkeleton`; the hero's `Read the obituary →` link when `obituarySlug` is non-null.

- [ ] **Step 1: Restore components and pages**

```bash
mkdir -p apps/web/src/components/obituaries 'apps/web/src/app/(site)/obituaries/[slug]'
for f in obituary-article.tsx obituary-article.test.tsx obituary-card.tsx obituary-card.test.tsx obituaries-pagination.tsx obituaries-pagination.test.tsx rap-sheet.tsx rap-sheet.test.tsx more-from-morgue.tsx; do git show "aaeabd0^:apps/web/src/components/obituaries/$f" > "apps/web/src/components/obituaries/$f"; done
git show 'aaeabd0^:apps/web/src/app/(site)/obituaries/page.tsx' > 'apps/web/src/app/(site)/obituaries/page.tsx'
git show 'aaeabd0^:apps/web/src/app/(site)/obituaries/loading.tsx' > 'apps/web/src/app/(site)/obituaries/loading.tsx'
git show 'aaeabd0^:apps/web/src/app/(site)/obituaries/[slug]/page.tsx' > 'apps/web/src/app/(site)/obituaries/[slug]/page.tsx'
```

Then prune every image reference: if `obituary-article.tsx`, `obituary-card.tsx`, or the `[slug]` page imports `ArticleHero` or reads `imageUrl`/`heroImage` fields, delete those imports/props/JSX (the DTO no longer carries them). If the `[slug]` page declares `opengraph-image` metadata referencing a deleted OG route, drop that metadata (the site default applies).

- [ ] **Step 2: Adapt to post-removal drift, guided by typecheck** — run `pnpm --filter @onelife/web run typecheck` and fix what it names. Known drift since `aaeabd0^`: the life-timeline DTO gained `avatarHash` and lost `character` (login avatars) — the obituary `[slug]` page's "Final Reload" builds a `LifeTimelineView` via the current `buildTimeline(data, now)`; if the restored page passes a `character` field or the `Timeline` props changed shape, follow the current `apps/web/src/app/(site)/players/[slug]/[map]/lives/[n]/page.tsx` usage as the template.

- [ ] **Step 3: Restore `ObituariesSkeleton`** — recover the `ObituariesSkeleton` function (and only it — not the news/fresh-spawn/`ArticleHeroSkeleton` variants) from `git show aaeabd0 -- apps/web/src/components/skeletons.tsx`, add it to the current `skeletons.tsx`, prune any hero-image block inside it, and re-add its assertion to `skeletons.test.tsx`.

- [ ] **Step 4: The timeline hero link, test-first.** In `apps/web/src/components/life/hero.test.tsx` add (fixtures gain `obituarySlug`):

```tsx
it("links the published obituary when the timeline carries a slug", () => {
  render(<LifeHero data={{ ...baseData(), obituarySlug: "the-end-abc-1-4" }} now={NOW} />);
  const link = screen.getByRole("link", { name: /read the obituary/i });
  expect(link).toHaveAttribute("href", "/obituaries/the-end-abc-1-4");
});
it("renders no obituary link when the slug is null", () => {
  render(<LifeHero data={{ ...baseData(), obituarySlug: null }} now={NOW} />);
  expect(screen.queryByRole("link", { name: /read the obituary/i })).toBeNull();
});
```

(Adapt `baseData()`/prop names to the current test file's fixture helper.) Run to verify FAIL, then re-add to `hero.tsx` (below the stat band, matching the removal diff):

```tsx
{data.obituarySlug && (
  <Link
    href={`/obituaries/${data.obituarySlug}`}
    className="mt-4 inline-block font-mono text-[11px] font-bold uppercase tracking-[.06em] text-red-deep underline"
  >
    Read the obituary →
  </Link>
)}
```

- [ ] **Step 5: Run the web suite + typecheck, commit**

```bash
pnpm --filter @onelife/web run test && pnpm --filter @onelife/web run typecheck
git add apps/web
git commit -m "feat(web): restore the obituaries feed + article pages and the timeline obituary link"
```

---

### Task 13: Deploy, env, docs, changelog — and the full gate

**Files:**
- Modify: `.env.example`, `deploy/deploy.sh`, `deploy/README.md`, `CLAUDE.md`, `CHANGELOG.md`

**Interfaces:** none — operational surface only.

- [ ] **Step 1: `.env.example`** — re-add a `NEWSDESK_*` block (recover placement style from `git show aaeabd0 -- .env.example`, trimming to the surviving vars):

```
# ── newsdesk (obituaries) ─────────────────────────────────────────────
# LLM obituaries for qualified deaths. TWO gates, both default OFF:
# NEWSDESK_DRY_RUN defaults true (log, never call the model or write), and
# NEWSDESK_SINCE unset turns the pass off entirely — set it to the ISO-8601
# go-live instant so history is never backfilled at API cost.
OPENROUTER_API_KEY=
NEWSDESK_MODEL=anthropic/claude-sonnet-5
NEWSDESK_DRY_RUN=true
NEWSDESK_SINCE=
NEWSDESK_INTERVAL_SECONDS=300
NEWSDESK_BATCH_CAP=10
NEWSDESK_MAX_ATTEMPTS=3
NEWSDESK_TEMPERATURE=0.7
```

- [ ] **Step 2: `deploy/deploy.sh`** — add `newsdesk` to the `SERVICES=(...)` array (line ~31). **Reminder from CLAUDE.md:** this change does not apply to the deploy that installs it; the runbook covers the unit anyway.

- [ ] **Step 3: `deploy/README.md`** — re-add the `onelife-newsdesk` section (recover the old text from `git show aaeabd0 -- deploy/README.md`, pruned of birth/news/image/Discord content): the systemd unit (operator creates the unit file by hand — mirror of the removal's by-hand disable step), the env vars above, the worker-table row, and the go-live order: deploy → watch a dry-run interval → set `NEWSDESK_SINCE` to the go-live instant → set `NEWSDESK_DRY_RUN=false`.

- [ ] **Step 4: `CLAUDE.md`** — under the "Content engine retired" entry add a dated follow-up note: obituaries (alone) were revived on 2026-07-28 — new spec path, the No-Place Rule, `NEWSDESK_SINCE`, the trimmed `articles` table (durable, migration `0030`, plain deploy no `--rebuild`), and that the tuple-match invariant's executable proof is restored in `life-timeline.test.ts` (update the "lost its only executable proof" wording). Keep it brief; the spec carries the detail.

- [ ] **Step 5: `CHANGELOG.md`** — Unreleased entry (the changelog gate requires it, committed):

```markdown
### Added
- Obituaries are back — LLM-written, obituary-only revival of the retired content engine:
  a dry-run-gated newsdesk sweep (`NEWSDESK_SINCE` forward-only cutoff), a public
  `/obituaries` feed + article page, a life-timeline link, and sitemap entries. New
  No-Place Rule: prose may name the map and nothing finer, enforced by prompt and a
  deterministic validator. No images, no birth notices, no news, no notifications.
  Migration `0030` recreates a trimmed `articles` table (durable; plain deploy, no
  `--rebuild`).
```

- [ ] **Step 6: The full gate**

```bash
pnpm turbo run typecheck
pnpm turbo run test --concurrency=1
```

Expected: all green. Fix anything named before committing.

- [ ] **Step 7: Commit**

```bash
git add .env.example deploy CLAUDE.md CHANGELOG.md
git commit -m "docs(deploy): newsdesk runbook, env block, changelog and CLAUDE.md for the obituaries revival"
```

---

## Post-plan notes (not tasks)

- **Go-live runbook (operator, after release):** create + enable the `onelife-newsdesk` unit → deploy normally (plain `./deploy/deploy.sh`) → confirm a dry-run tick logs `DRY RUN: would generate obituary` lines → set `NEWSDESK_SINCE` to the go-live instant → set `NEWSDESK_DRY_RUN=false` → watch the first live tick and read the first published obituary before walking away.
- **PR flow:** `keel:finish-work` (changelog is already in Task 13), squash-merge into `main` per `.keel.json`.
