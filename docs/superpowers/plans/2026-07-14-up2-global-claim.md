# UP2 — Global Gamertag Claim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the gamertag claim/verification global (server-agnostic) and replace the claim UI's server dropdown with a gamertag autocomplete over unverified observed players.

**Architecture:** Stacked on UP1 (global `players`). `gamertag_links` drops `server_id`; the claim route, verifier, and web claim flow stop scoping by server; a new read-model + route feed the autocomplete.

**Tech Stack:** TypeScript/ESM, Drizzle + Postgres, Fastify, Next.js + React Query, Vitest.

## Global Constraints

- DB tests need `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5432/onelife_test`.
- `pnpm --filter <pkg> test` / `typecheck`. TDD: red → green → commit.
- Builds on UP1 (branch `feature/up1-global-player`); `players` is already global.
- New migration is `0006` (UP1 added `0005`).
- Do NOT rebuild `gamertag_links` (durable). `verification_challenges` schema unchanged.

---

### Task 1: `gamertag_links` schema + migration 0006

**Files:** Modify `packages/db/src/schema.ts:226-238`; Create `packages/db/drizzle/0006_*.sql`.

- [ ] **Step 1: Edit schema.** Replace the `gamertagLinks` table body:
```typescript
export const gamertagLinks = pgTable("gamertag_links", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: text("user_id").notNull().references(() => user.id),
  gamertag: text("gamertag").notNull(),
  status: text("status").notNull().default("pending"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqUserGamertag: uniqueIndex("gamertag_links_user_gamertag_uniq").on(t.userId, t.gamertag),
  uniqVerified: uniqueIndex("gamertag_links_verified_uniq").on(t.gamertag).where(sql`${t.status} = 'verified'`),
  byGamertag: index("gamertag_links_gamertag_idx").on(t.gamertag),
}));
```
- [ ] **Step 2: Generate migration.** `cd packages/db && TEST_DATABASE_URL=… pnpm db:generate` → `0006_*.sql`. Confirm it only alters `gamertag_links` (drops `server_id` + old indexes, adds new ones). If the shared `onelife_test` has conflicting legacy rows, `dropdb onelife_test` (harness recreates).
- [ ] **Step 3: Apply.** `TEST_DATABASE_URL=… pnpm --filter @onelife/db db:migrate` → success.
- [ ] **Step 4: Commit** `feat(db): global gamertag_links — drop server_id, verified-unique on gamertag (0006)`.

---

### Task 2: Verifier matches by gamertag

**Files:** Modify `apps/verifier/src/pg-store.ts` + `apps/verifier/src/tick.ts`; Test `apps/verifier/test/tick.test.ts`.

- [ ] **Step 1: Failing test.** A pending claim for gamertag "G" (no server on the link) verifies when an `emote.performed` for "G" arrives on ANY server, completing the sequence; a second user's pending claim for "G" is cancelled once "G" is verified. Assert final link statuses.
- [ ] **Step 2: Run → FAIL** (`findPendingChallenges` etc. still take serverId). `TEST_DATABASE_URL=… pnpm --filter @onelife/verifier test`
- [ ] **Step 3: Implement.** In `pg-store.ts` drop the `serverId` param + `eq(gamertagLinks.serverId, …)` clause from `findPendingChallenges`, `getVerifiedLinkId`, `cancelOtherPendingLinks`. In `tick.ts` change the three call sites (lines ~24, ~34, ~39) to pass `payload.gamertag` only (drop `row.serverId`).
- [ ] **Step 4: Run → PASS** (full verifier suite). **Step 5: Commit** `feat(verifier): match gamertag links globally by gamertag`.

---

### Task 3: Claim route drops serverId

**Files:** Modify `apps/api/src/routes/gamertag-links.ts`; Test `apps/api/test/gamertag-links.test.ts`.

- [ ] **Step 1: Failing test.** POST `/me/gamertag-links` with body `{ gamertag }` (no serverId) creates a pending link + challenge; a second user claiming a gamertag that is already `verified` gets 409; the response has no `serverId`.
- [ ] **Step 2: Run → FAIL.** `TEST_DATABASE_URL=… pnpm --filter @onelife/api test -- gamertag-links`
- [ ] **Step 3: Implement.** `claimBody = z.object({ gamertag: z.string().min(1) })`. Remove `serverId` from: the D3 verified check (`where(and(eq(gamertagLinks.gamertag, gamertag), eq(gamertagLinks.status, "verified")))`), the existing-link lookup (`(userId, gamertag)`), the insert values, `loadLink`'s returned object, and the 201 response body. Keep D6 (already `eq(players.gamertag, gamertag)` from UP1), the challenge upsert, and the GET/DELETE routes as-is (minus serverId in loadLink's return).
- [ ] **Step 4: Run → PASS** (full api gamertag-links suite). **Step 5: Commit** `feat(api): server-agnostic gamertag claim`.

---

### Task 4: Autocomplete read-model + route

**Files:** Create read-model in `packages/read-models/src/` (e.g. `claimable.ts`) + export from index; Modify `apps/api/src/routes/players.ts`; Tests in both packages.

**Interfaces:** Produces `searchClaimableGamertags(db, prefix: string, limit: number): Promise<string[]>` and `GET /players/search?q=`.

- [ ] **Step 1: Failing read-model test.** Seed players `Alpha`, `Alalpha`, `Beta`; verify `Alpha` via a verified `gamertag_links` row. `searchClaimableGamertags(db, "Al", 10)` returns `["Alalpha"]` (prefix match, verified `Alpha` excluded), case-insensitive.
- [ ] **Step 2: Run → FAIL** (function missing). `TEST_DATABASE_URL=… pnpm --filter @onelife/read-models test -- claimable`
- [ ] **Step 3: Implement read-model.**
```typescript
import { and, eq, ilike, notExists, asc } from "drizzle-orm";
import { players, gamertagLinks } from "@onelife/db";
export async function searchClaimableGamertags(db, prefix, limit) {
  const rows = await db.select({ g: players.gamertag }).from(players)
    .where(and(
      ilike(players.gamertag, `${prefix}%`),
      notExists(db.select().from(gamertagLinks).where(and(
        eq(gamertagLinks.gamertag, players.gamertag), eq(gamertagLinks.status, "verified")))),
    ))
    .orderBy(asc(players.gamertag)).limit(limit);
  return rows.map((r) => r.g);
}
```
Export it from `packages/read-models/src/index.ts`.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Failing route test + implement.** In `players.ts` add:
```typescript
app.get("/players/search", async (req) => {
  const q = z.object({ q: z.string() }).safeParse(req.query);
  const prefix = q.success ? q.data.q.trim() : "";
  if (prefix.length < 2) return [];
  return searchClaimableGamertags(db, prefix, 10);
});
```
Test: `/players/search?q=Al` → `["Alalpha"]`; `?q=A` → `[]` (min length).
- [ ] **Step 6: Run → PASS** (api players suite). **Step 7: Commit** `feat(api): gamertag autocomplete over unverified players`.

---

### Task 5: Web — remove dropdown, add autocomplete

**Files:** Modify `apps/web/src/components/claim-form.tsx`, `apps/web/src/app/account/claim/page.tsx`, `apps/web/src/lib/use-gamertag-links.ts`, `apps/web/src/lib/api.ts`; Tests `apps/web/src/components/claim-form.test.tsx`.

- [ ] **Step 1: Failing test.** `claim-form.test.tsx`: renders NO element with `aria-label="Server"`; typing ≥2 chars in the gamertag input shows suggestions from a stubbed fetch; clicking a suggestion + submit calls `onSubmit("<gamertag>")`.
- [ ] **Step 2: Run → FAIL.** `pnpm --filter @onelife/web test -- claim-form`
- [ ] **Step 3: Implement.**
  - `api.ts`: add `export const searchClaimableGamertags = (q: string) => apiGet<string[]>(\`/api/players/search?q=${encodeURIComponent(q)}\`);`
  - `use-gamertag-links.ts`: `useClaimGamertag` mutationFn takes `{ gamertag }` and posts `{ gamertag }`.
  - `claim-form.tsx`: drop `servers` prop + `<select>`; keep the gamertag `<Input>`; add a debounced (React `useState`+`useEffect` or react-query) query to `searchClaimableGamertags` for the current input (≥2 chars); render a suggestion list; `onSubmit(gamertag)` on submit. Signature `onSubmit: (gamertag: string) => void`.
  - `claim/page.tsx`: remove the `useQuery(["servers"])` + servers-loading branch; render `<ClaimForm pending={…} error={…} onSubmit={(gamertag) => claim.mutate({ gamertag }, { onSuccess: (res) => setLinkId(res.linkId) })} />`; update the 422 copy to "…on any server yet".
- [ ] **Step 4: Run → PASS** (web claim-form + web suite). **Step 5: Commit** `feat(web): global gamertag claim with autocomplete, no server dropdown`.

---

### Task 6: Repo-green

- [ ] **Step 1: Straggler grep.** `grep -rn "gamertagLinks.serverId\|gamertag_links.*server_id\|link.serverId" apps packages --include=*.ts | grep -v drizzle` → empty; fix any real hit (e.g. leftover `serverId` in a `loadLink` caller or web `Server` type import that's now unused in the claim path).
- [ ] **Step 2: Full typecheck** `pnpm turbo run typecheck` → 19/19.
- [ ] **Step 3: Full suite** `TEST_DATABASE_URL=… pnpm turbo run test --concurrency=1` → all pass.
- [ ] **Step 4: Commit** any straggler fix.

---

## Self-review
- **Spec coverage:** schema+0006 (T1), verifier (T2), claim route (T3), autocomplete read-model+route (T4), web (T5), repo-green (T6). All UP2 spec sections mapped. ✓
- **Placeholders:** none.
- **Type consistency:** `searchClaimableGamertags(db, prefix, limit)` and the `onSubmit(gamertag: string)` signature are consistent across T4→T5.
