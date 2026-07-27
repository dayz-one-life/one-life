# Login Avatars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the inaccurate RPT character pipeline and replace portraits with login-method avatars (Postgres-stored 256×256 webp, API-served, upload/sync/remove on `/you`).

**Architecture:** One durable `avatars` table holds processed webp bytes keyed by user with a content hash for immutable URLs. One sharp pipeline processes both uploads and provider mirrors. Read-models attach `avatarHash` via verified `gamertag_links`; the web renders through one `Avatar` component with the existing silhouette as base state. Spec: `docs/superpowers/specs/2026-07-27-login-avatars-design.md`.

**Tech Stack:** Drizzle/Postgres, Fastify (`@fastify/multipart`), `sharp`, Better Auth `databaseHooks`, Next.js/TanStack Query.

## Global Constraints

- Tests need `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test` (dev machine port 5434). Migrate it with `DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @onelife/db run db:migrate`.
- Run suites as `pnpm --filter <pkg> exec vitest run <file>`; full gate is `pnpm turbo run test --concurrency=1` + `pnpm turbo run typecheck`.
- Avatar output is ALWAYS 256×256 webp quality 80; hash is `sha256(bytes)` hex sliced to 16 chars.
- Upload cap 5 MB; SVG rejected; provider fetch https-only, ≤3 redirects, 5 s timeout.
- A tombstone row (`image IS NULL`) blocks auto-populate but not explicit sync/upload.
- `avatars` is DURABLE: never in `REBUILD_TRUNCATE_TABLES` (`apps/projector/src/rebuild.ts`); must be in `APP_TABLES` (`packages/test-support/src/global-setup.ts`).
- Public payloads carry `avatarHash: string | null`, never user ids; the web builds URLs only via `avatarSrc(hash)`.
- Loading/error must never render as an authoritative state distinct from the true empty (silhouette IS the resolved empty; error toasts on `/you` announce on settlement, never at click).
- All gamertag joins compare `lower()` (package convention).
- Conventional commits; every commit message ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Demolition — RPT ingest

**Files:**
- Delete: `apps/ingest-worker/src/rpt-tick.ts`, `apps/ingest-worker/src/rpt-process-file.ts`, their test files (`apps/ingest-worker/test/rpt-*.test.ts` — glob for `rpt` under `apps/ingest-worker/test/`)
- Delete: `packages/rpt-parser/` (entire workspace package)
- Modify: `apps/ingest-worker/src/sweep.ts` (drop `rptTick` import/call, `RptNitradoLike` from `IngestClient`), `apps/ingest-worker/src/index.ts` + `apps/ingest-worker/src/config.ts` (drop `charStaleHours` / `CHAR_STALE_HOURS` if present), `apps/ingest-worker/package.json` (drop `@onelife/rpt-parser` dep)
- Modify: `packages/nitrado/src/*` — remove RPT-only methods/types (grep `-i rpt`); keep anything the ADM pass shares
- Check: `pnpm-workspace.yaml` needs no edit (globs packages/*), but `turbo.json` and root tsconfig references must not name rpt-parser explicitly (grep)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `sweep.ts`'s `IngestClient` type becomes `NitradoLike` alone; sweep result loses its `sightings` count. `character_sightings`/`characters`/`rpt_files` tables become write-orphaned (dropped in Task 4).

- [ ] **Step 1: Inventory every RPT reference**

Run: `grep -rln "rpt\|Rpt\|RPT" apps/ingest-worker/src apps/ingest-worker/test packages/nitrado --include="*.ts"` and `grep -rn "rpt-parser" --include="*.json" -r . | grep -v node_modules`
Keep the list; Step 2 must clear ALL of it.

- [ ] **Step 2: Delete and modify per the Files list**

In `sweep.ts`: remove the `rptTick` import, the `RptNitradoLike` half of `IngestClient`, the `rpt` call block and `sightings` accumulation (and its log field). In `config.ts`: remove the stale-hours knob and its env parsing; update `.env.example` if it names a `CHAR_STALE`/RPT var. `git rm -r packages/rpt-parser`.

- [ ] **Step 3: Fix compilation and the ingest-worker suite**

Run: `pnpm install` (lockfile drops the workspace pkg), then `pnpm --filter @onelife/ingest-worker exec vitest run` and `pnpm turbo run typecheck`.
Expected: PASS with no references to deleted symbols. Sweep tests that asserted `sightings` lose those assertions, not their ADM coverage.

- [ ] **Step 4: Re-run the inventory grep — must return nothing**

Run: the Step 1 greps. Expected: empty (schema.ts still matches until Task 4 — that one exception is allowed here).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor!: remove the RPT ingest pass and @onelife/rpt-parser"
```

---

### Task 2: Demolition — character read-models, domain, API fields

**Files:**
- Delete: `packages/read-models/src/character.ts` + its test, `packages/domain/src/characters.ts` (rosterByClass + personas) + its test
- Modify: `packages/read-models/src/survivors.ts` (drop `character` from `SurvivorRow`, the enrichment step, `SurvivorCharacter`), `packages/read-models/src/life-timeline.ts` (drop `character` field + `getLifeCharacter` compose), `packages/read-models/src/player-page.ts` (drop `character` from `ServerStanding`/`PastLife`, `charShape`, `PlayerCharacter`), `packages/read-models/src/index.ts` exports
- Modify: API route serializers that pass `character` through (grep `character` under `apps/api/src/routes/` — survivors + player-aggregate life detail)
- Modify: affected tests in `packages/read-models/test/` and `apps/api/test/` — delete character assertions, keep the rest

**Interfaces:**
- Consumes: Task 1 (rpt-parser gone; nothing here may import it).
- Produces: `SurvivorRow`, `LifeTimelineData`, `ServerStanding`, `PastLife` all WITHOUT `character`. Task 8 re-extends `SurvivorRow`/`getLifeTimeline` with `avatarHash: string | null`.

- [ ] **Step 1: Inventory**

Run: `grep -rln "getLifeCharacter\|rosterByClass\|SurvivorCharacter\|PlayerCharacter\|LifeCharacter\|characterClass" packages apps/api --include="*.ts"`

- [ ] **Step 2: Delete and strip per the Files list; run the two suites**

Run: `pnpm --filter @onelife/read-models exec vitest run && pnpm --filter @onelife/api exec vitest run && pnpm turbo run typecheck` (web will fail typecheck until Task 3 — scope typecheck to `--filter` of the touched packages here: `pnpm --filter @onelife/read-models --filter @onelife/api --filter @onelife/domain exec tsc --noEmit` per package convention, or defer the full gate to Task 3).
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "refactor!: drop character fields from read-models and API payloads"
```

---

### Task 3: Demolition — web character surface

**Files:**
- Delete: `apps/web/src/components/character-image.tsx`, `apps/web/src/components/player/player-avatar.tsx`, `apps/web/public/characters/` (31 webp files)
- Create: `apps/web/src/components/shared/avatar.tsx` — the silhouette-only base (Task 9 adds the image branch)
- Modify: `apps/web/src/components/survivors/survivor-row.tsx`, `apps/web/src/components/life/hero.tsx`, `apps/web/src/components/player/standing-card.tsx` (drop its portrait slot entirely — the dossier stays portrait-free per spec §7), `apps/web/src/lib/types.ts` (drop `SurvivorCharacter`, `PlayerCharacter`, `LifeCharacterDto`, `character` fields)
- Test: update `survivor-row.test.tsx`, `hero.test.tsx`; new `avatar.test.tsx`

**Interfaces:**
- Consumes: Task 2's DTO shapes (no `character`).
- Produces: `Avatar({ hash, size, dim }: { hash: string | null; size: number; dim?: boolean })` in `@/components/shared/avatar` — Task 3 ships it rendering ONLY the silhouette (hash ignored-as-null is fine, but accept the prop now so call sites don't churn in Task 9); `avatarSrc(hash: string): string` = `` `/api/avatars/${hash}.webp` `` exported from the same file.

- [ ] **Step 1: Write the base Avatar + failing test**

```tsx
// apps/web/src/components/shared/avatar.tsx
import { cn } from "@/lib/utils";

export function avatarSrc(hash: string): string {
  return `/api/avatars/${hash}.webp`;
}

/** Decorative player avatar. Silhouette is the RESOLVED EMPTY state, not an error. alt="". */
export function Avatar({ hash, size, dim = false }: { hash: string | null; size: number; dim?: boolean }) {
  const box = { width: size, height: size };
  if (hash) {
    return (
      <img src={avatarSrc(hash)} alt="" width={size} height={size} loading="lazy" decoding="async"
        style={box} className={cn("border border-hairline object-cover", dim && "opacity-60 grayscale")} />
    );
  }
  return (
    <span aria-hidden="true" style={box}
      className={cn("flex items-center justify-center border border-hairline bg-bone text-ink-muted", dim && "opacity-60")}>
      <svg viewBox="0 0 24 24" width={size * 0.5} height={size * 0.5} fill="currentColor">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" />
      </svg>
    </span>
  );
}
```

Test (`avatar.test.tsx`): renders `img` with `/api/avatars/abc123.webp` when hash present; renders the aria-hidden silhouette span (no img) when hash null.

- [ ] **Step 2: Swap call sites, delete files, strip types**

`survivor-row.tsx` + `hero.tsx`: replace `CharacterImage character={...}` with `Avatar hash={null}` for now (Task 9 threads the real hash). `standing-card.tsx`: remove the `PlayerAvatar` slot and import. `git rm -r apps/web/public/characters`.

- [ ] **Step 3: Green + full typecheck gate**

Run: `pnpm --filter @onelife/web exec vitest run && pnpm turbo run typecheck`
Expected: PASS repo-wide (first time since Task 2).

- [ ] **Step 4: Grep-gate the demolition**

Run: `grep -rn "characters/\|rosterByClass\|CharacterImage\|characterClass" apps/web/src packages apps --include="*.ts*" | grep -v node_modules | grep -v "packages/db/src/schema.ts" | grep -v docs/`
Expected: empty.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor!: web character portraits out; silhouette-base Avatar in"
```

---

### Task 4: Migration 0029 — `avatars` in, character tables out

**Files:**
- Modify: `packages/db/src/schema.ts` (delete `rptFiles`, `characterSightings`, `characters` table defs; add `avatars`), `packages/test-support/src/global-setup.ts` (add `"avatars"` to `APP_TABLES`; remove `rpt_files`/`character_sightings`/`characters` if present)
- Create: `packages/db/drizzle/0029_avatars.sql`
- Register the migration the same way `0028` is registered (check `packages/db/drizzle/meta/_journal.json` convention and copy it)

**Interfaces:**
- Produces: Drizzle table `avatars` with columns `userId text PK → user.id cascade`, `image` (bytea via `customType`), `hash text`, `source text`, `updatedAt timestamptz notNull`. Exported from `@onelife/db`. NOTE: drizzle has no built-in bytea — define once in schema.ts:

```ts
const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

export const avatars = pgTable("avatars", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  image: bytea("image"),                 // NULL = removal tombstone
  hash: text("hash"),                    // NULL on tombstone
  source: text("source"),                // 'provider' | 'upload'; NULL on tombstone
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (t) => ({
  byHash: index("avatars_hash_idx").on(t.hash).where(sql`hash is not null`),
}));
```

- [ ] **Step 1: Write `0029_avatars.sql`**

```sql
CREATE TABLE "avatars" (
  "user_id" text PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE,
  "image" bytea,
  "hash" text,
  "source" text,
  "updated_at" timestamptz NOT NULL
);
CREATE INDEX "avatars_hash_idx" ON "avatars" ("hash") WHERE hash IS NOT NULL;

DROP TABLE IF EXISTS "character_sightings";
DROP TABLE IF EXISTS "characters";
DROP TABLE IF EXISTS "rpt_files";
```

- [ ] **Step 2: Schema + journal + APP_TABLES edits; migrate the test DB**

Run: `DATABASE_URL="postgres://onelife:onelife@localhost:5434/onelife_test" pnpm --filter @onelife/db run db:migrate`
Expected: applies cleanly.

- [ ] **Step 3: Full suite green (proves nothing still touches the dropped tables)**

Run: `TEST_DATABASE_URL=... pnpm turbo run test --concurrency=1 --force`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(db): avatars table; drop character_sightings, characters, rpt_files (0029)"
```

---

### Task 5: Image pipeline

**Files:**
- Create: `apps/api/src/lib/avatar-image.ts`
- Test: `apps/api/test/avatar-image.test.ts` (pure unit tests, no DB)
- Modify: `apps/api/package.json` (+`sharp`)

**Interfaces:**
- Produces: `processAvatarImage(input: Buffer): Promise<{ image: Buffer; hash: string }>` — throws `AvatarImageError` with `.code: "too_large" | "not_an_image"`. Constants `AVATAR_MAX_BYTES = 5 * 1024 * 1024`, `AVATAR_SIZE = 256`.

- [ ] **Step 1: Failing tests**

```ts
// apps/api/test/avatar-image.test.ts
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { processAvatarImage, AvatarImageError, AVATAR_MAX_BYTES } from "../src/lib/avatar-image.js";

const png = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: "#803020" } }).png().toBuffer();

describe("processAvatarImage", () => {
  it("emits a 256×256 webp with a 16-hex hash, whatever the input shape", async () => {
    const out = await processAvatarImage(await png(1000, 400));
    const meta = await sharp(out.image).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([256, 256, "webp"]);
    expect(out.hash).toMatch(/^[0-9a-f]{16}$/);
  });
  it("is deterministic: same input, same hash", async () => {
    const buf = await png(300, 300);
    expect((await processAvatarImage(buf)).hash).toBe((await processAvatarImage(buf)).hash);
  });
  it("rejects oversize input before decoding", async () => {
    const big = Buffer.alloc(AVATAR_MAX_BYTES + 1);
    await expect(processAvatarImage(big)).rejects.toMatchObject({ code: "too_large" });
  });
  it("rejects non-image bytes", async () => {
    await expect(processAvatarImage(Buffer.from("not an image"))).rejects.toMatchObject({ code: "not_an_image" });
  });
  it("rejects svg (scripting surface)", async () => {
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><rect width="9" height="9"/></svg>`);
    await expect(processAvatarImage(svg)).rejects.toMatchObject({ code: "not_an_image" });
  });
});
```

- [ ] **Step 2: Red, then implement**

```ts
// apps/api/src/lib/avatar-image.ts
import sharp from "sharp";
import { createHash } from "node:crypto";

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const AVATAR_SIZE = 256;

export class AvatarImageError extends Error {
  constructor(public code: "too_large" | "not_an_image") { super(code); }
}

/** One pipeline for uploads AND provider mirrors: cap → decode (never svg) →
 *  cover-crop 256×256 → webp q80 (re-encode drops EXIF) → content hash. */
export async function processAvatarImage(input: Buffer): Promise<{ image: Buffer; hash: string }> {
  if (input.byteLength > AVATAR_MAX_BYTES) throw new AvatarImageError("too_large");
  let image: Buffer;
  try {
    const s = sharp(input, { limitInputPixels: 8192 * 8192 });
    const meta = await s.metadata();
    if (!meta.format || meta.format === "svg") throw new Error("svg");
    image = await s.resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover" }).webp({ quality: 80 }).toBuffer();
  } catch {
    throw new AvatarImageError("not_an_image");
  }
  return { image, hash: createHash("sha256").update(image).digest("hex").slice(0, 16) };
}
```

- [ ] **Step 3: Green + commit**

Run: `pnpm --filter @onelife/api exec vitest run test/avatar-image.test.ts`

```bash
git add -A && git commit -m "feat(api): avatar image pipeline (sharp, 256px webp, content hash)"
```

---

### Task 6: Avatar routes

**Files:**
- Create: `apps/api/src/routes/avatars.ts`, `apps/api/src/lib/avatar-store.ts`
- Modify: `apps/api/src/app.ts` (register `@fastify/multipart` + `registerAvatarRoutes(app, db, auth)`), `apps/api/package.json` (+`@fastify/multipart`)
- Test: `apps/api/test/avatar-routes.test.ts` (copy the session-fixture pattern from `apps/api/test/friend-map-routes.test.ts`)

**Interfaces:**
- Consumes: `processAvatarImage` (Task 5), `avatars` table (Task 4).
- Produces:
  - `avatar-store.ts`: `upsertAvatar(db, userId, { image, hash, source }: { image: Buffer; hash: string; source: "provider" | "upload" })`, `tombstoneAvatar(db, userId)`, `getAvatarByHash(db, hash): Promise<Buffer | null>`, `getAvatarState(db, userId): Promise<"none" | "live" | "tombstone">`, `fetchProviderImage(url: string): Promise<Buffer>` (https-only, ≤3 redirects, 5 s timeout, streamed 5 MB cap — implement with `fetch` + manual redirect loop, reject non-https hops).
  - Routes: `POST /me/avatar` (multipart field `file` → `{ hash }`), `POST /me/avatar/sync` (→ `{ hash }`, 409 `{ error: "no_provider_image" }` when `user.image` is null, 502 `{ error: "fetch_failed" }` leaving any existing row untouched), `DELETE /me/avatar` (→ `{ ok: true }` always), `GET /avatars/:hash.webp` (public; `content-type: image/webp`, `cache-control: public, max-age=31536000, immutable`; 404 unknown). 400 `{ error: "too_large" | "not_an_image" }` from pipeline failures. All `/me` routes 401 unsessioned. NO subject parameter on any write route.

- [ ] **Step 1: Failing route tests** — cover, at minimum:

```ts
// shape only — use the app/session harness from friend-map-routes.test.ts
it("uploads, then serves the bytes back by hash with immutable caching", async () => { /* POST multipart png → 200 {hash}; GET /avatars/<hash>.webp → 200, image/webp, cache-control immutable */ });
it("sync mirrors user.image through the pipeline", async () => { /* seed user.image with a data-served http fixture via a local fastify stub server → 200 {hash} */ });
it("sync 409s for a user with no provider image", async () => {});
it("remove writes a tombstone and the old hash 404s only after the row changes", async () => { /* DELETE → ok; getAvatarState = tombstone; GET old hash → 404 */ });
it("explicit sync AFTER remove resurrects; getAvatarState flips to live", async () => {});
it("a failed sync leaves the existing avatar untouched", async () => { /* point user.image at a 500ing stub → 502; original GET still 200 */ });
it("rejects an unsessioned caller on every /me route", async () => {});
```

- [ ] **Step 2: Red → implement store + routes → green**

Store notes: upsert via `.onConflictDoUpdate({ target: avatars.userId, set: {...} })`; tombstone = same upsert with `image: null, hash: null, source: null`. `GET /avatars/:hash.webp` parses the param with `z.string().regex(/^[0-9a-f]{16}\.webp$/)` then strips the suffix; query `where(and(eq(avatars.hash, h), isNotNull(avatars.image)))`.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(api): avatar upload/sync/remove routes + public hash-addressed serving"
```

---

### Task 7: Auto-populate on OAuth sign-in

**Files:**
- Modify: `packages/auth/src/auth.ts` — `createAuth(db, cfg, hooks?: { onSessionCreated?: (userId: string) => void })`; wire Better Auth `databaseHooks.session.create.after: (session) => { hooks?.onSessionCreated?.(session.userId); }`
- Create: `apps/api/src/lib/avatar-autopopulate.ts`
- Modify: the API server bootstrap that calls `createAuth` (grep `createAuth(` under `apps/api/src` and `apps/web` — pass the hook only in the API)
- Test: `apps/api/test/avatar-autopopulate.test.ts`

**Interfaces:**
- Consumes: Task 6's store (`getAvatarState`, `upsertAvatar`, `fetchProviderImage`), Task 5 pipeline.
- Produces: `autoPopulateAvatar(db, userId): Promise<void>` — loads `user.image`; returns silently when image null, state ≠ `"none"`, fetch fails, or pipeline rejects. NEVER throws (fire-and-forget off the login path — a login must not block or fail on avatar work; callers invoke `void autoPopulateAvatar(...)`).

- [ ] **Step 1: Failing tests**

```ts
it("mirrors the provider image for a first-time user", async () => {});
it("does nothing when user.image is null", async () => {});
it("does nothing when a live avatar already exists (no overwrite)", async () => {});
it("NEVER resurrects a tombstone", async () => {});   // the spec's central consent rule
it("swallows a fetch failure without throwing", async () => {});
```

- [ ] **Step 2: Red → implement → green; wire the hook**

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(auth): mirror the provider avatar after OAuth sign-in (tombstone-respecting)"
```

---

### Task 8: `avatarHash` on public read-models

**Files:**
- Modify: `packages/read-models/src/survivors.ts` (SurvivorRow + one batched join), `packages/read-models/src/life-timeline.ts`
- Modify: API serializers if they whitelist fields (grep the two routes)
- Test: extend `packages/read-models/test/survivors.test.ts` + `life-timeline.test.ts`

**Interfaces:**
- Consumes: `avatars` table (Task 4).
- Produces: `SurvivorRow.avatarHash: string | null`; `getLifeTimeline(...)` result gains `avatarHash: string | null`. Join shape (batched for survivors — one query for the page of rows, not per-row):

```ts
const rows = await db
  .select({ gamertag: gamertagLinks.gamertag, hash: avatars.hash })
  .from(gamertagLinks)
  .innerJoin(avatars, and(eq(avatars.userId, gamertagLinks.userId), isNotNull(avatars.image)))
  .where(and(eq(gamertagLinks.status, "verified"),
    inArray(sql`lower(${gamertagLinks.gamertag})`, pageGamertags.map((g) => g.toLowerCase()))));
```

- [ ] **Step 1: Failing tests** — verified user with live avatar → hash on their row; unverified player → null; tombstoned → null; pending (unverified) link → null (mutation kills dropping the `status = 'verified'` clause or the `image IS NOT NULL` clause).

- [ ] **Step 2: Red → implement → green → commit**

```bash
git add -A && git commit -m "feat(read-models): avatarHash on survivor rows and the life timeline"
```

---

### Task 9: Web surfaces

**Files:**
- Modify: `apps/web/src/lib/types.ts` (`SurvivorRow.avatarHash`, timeline DTO), `apps/web/src/lib/api.ts` (+`uploadAvatar(file: File)`, `syncAvatar()`, `removeAvatar()` — multipart via raw `fetch` to `/api/me/avatar`; note `apiSend` sets JSON content-type only with a body, multipart must NOT set content-type manually)
- Modify: `apps/web/src/components/survivors/survivor-row.tsx` + `life/hero.tsx` (thread real `avatarHash` into `Avatar`), masthead `apps/web/src/components/shell/account-affordance.tsx` (avatar disc when the session user has one). The session's own hash comes from `GET /me/avatar` → `{ hash: string | null }` (add it to `avatars.ts` in Task 6 if not present; session-gated, `cache-control: no-store, private`) consumed via `useQuery({ queryKey: ["avatar"] })` here and in the /you panel. Never derive from `useSession()`'s `user.image` — that is the raw provider URL, which public surfaces must not hotlink.
- Create: `apps/web/src/components/account/avatar-panel.tsx` (+ test) mounted on `/you`
- Test: update `survivor-row.test.tsx`, `hero.test.tsx`; new `avatar-panel.test.tsx`

**Interfaces:**
- Consumes: `Avatar`/`avatarSrc` (Task 3), routes (Task 6 — including the `GET /me/avatar` state route this task adds there if not already present; keep it in `avatars.ts` with the same session gate, `cache-control: no-store, private`).
- Produces: `AvatarPanel` — shows current avatar (Avatar component, 76px), buttons Upload (file input, accept `image/*`), Refresh from login provider, Remove. Disabled while any mutation pending; result announced via the shared `SrStatus` ON SETTLEMENT («Avatar updated» / «Avatar removed» / mapped error text for `too_large`, `not_an_image`, `no_provider_image`); success invalidates `["avatar"]`.

- [ ] **Step 1: Failing tests** — panel: upload success announces on settlement and never at click; `no_provider_image` maps to visible text; row/hero: render `img` when `avatarHash` present, silhouette otherwise.

- [ ] **Step 2: Red → implement → green**

- [ ] **Step 3: Browser sanity** (needs the dev stack): `/you` upload round-trip, board hero row shows the avatar, masthead disc updates after upload.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(web): avatars on boards, life hero, masthead; /you avatar panel"
```

---

### Task 10: Docs, gates, PR

**Files:**
- Modify: `CHANGELOG.md` (Unreleased: Added — login avatars; Removed — character portraits/pipeline), `CLAUDE.md` (SP5 entry: mark the character pipeline REMOVED with a pointer to the spec; add an avatars paragraph noting the durable table, the tombstone rule, hash-addressed public serving, and that provider CDNs are never hotlinked), `deploy/README.md` (sharp native dep note; migration 0029 is plain deploy, no `--rebuild`)

- [ ] **Step 1: Full gates**

Run: `TEST_DATABASE_URL=... pnpm turbo run test --concurrency=1 --force && pnpm turbo run typecheck`
Expected: PASS.

- [ ] **Step 2: Docs edits per Files list**

- [ ] **Step 3: Code review** (superpowers:requesting-code-review), fix findings

- [ ] **Step 4: Commit docs, then keel:finish-work** (changelog gate needs the CHANGELOG commit included)

```bash
git add -A && git commit -m "docs: changelog + CLAUDE.md + deploy notes for login avatars"
```
