# Cross-linking PR-1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add every cross-link between players, lives, and articles that needs no schema change — controls-rail server cards → life timeline, article dossier → life timeline, and life timeline → its obituary.

**Architecture:** Almost all the data already exists and is being discarded in a projection. `ServerStanding` carries `alive.lifeNumber` and `ban.triggeringLifeNumber`, and `serverCards()` drops both; the idle branch already computes the most recent life row and ignores it. So the bulk of this is widening one pure projection and rendering links with the existing `lifeHref` helper. Only the last task adds a query.

**Tech Stack:** TypeScript/ESM, Next.js 15 App Router, React 19, Tailwind, Drizzle + Postgres, Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-21-cross-linking-design.md` (§4 is this PR).

## Global Constraints

- Branch is `feature/cross-linking`, already created from `origin/develop`. Do not create another.
- **⚠️ Two surfaces, opposite backgrounds.** The controls rail is the light paper surface; `ControlsSheet` is `bg-dark`. Any element rendered on both MUST swap its colour tokens. `--red-deep` is a **light-surface-only** token (on dark it drops to ~3.2:1 and fails AA); dark surfaces use `red-soft`. The existing "Obituary →" / "Obit →" links in `server-cards.tsx:47` and `sheet.tsx:188` are the precedent — copy their token pairing exactly.
- **Never render a link to a life that may not exist.** `triggeringLifeNumber` and the new `lastLifeNumber` are both nullable. Branch on null and render no link, never a link to life `0` or `undefined`.
- Only `status = 'published'` articles may be linked. A retracted, draft, or failed-stub article must never be linked to.
- Presentational components stay props-only and unit-tested; hooks/containers stay thin and untested, per existing convention.
- Run the whole web suite before each commit: `cd apps/web && pnpm vitest run`.
- Do not run `git add -A` at the repo root; stage explicit paths.

---

### Task 1: `lifeHrefBySlug` — build a life URL from an already-slugified callsign

The rail and sheet hold `ownSlug` (already `playerSlug(gamertag)`), not the raw gamertag, so they cannot call the existing `lifeHref(gamertag, …)` without re-deriving. Extract the slug-taking form and make the existing function delegate to it, so there is exactly one place that knows the URL shape.

**Files:**
- Modify: `apps/web/src/lib/life-href.ts`
- Test: `apps/web/src/lib/life-href.test.ts`

**Interfaces:**
- Consumes: `playerSlug` from `apps/web/src/lib/slug.ts`
- Produces: `lifeHrefBySlug(playerSlugValue: string, mapSlug: string, lifeNumber: number): string`, and the unchanged public signature `lifeHref(gamertag: string, mapSlug: string, lifeNumber: number): string`

- [ ] **Step 1: Write the failing test**

Create or append to `apps/web/src/lib/life-href.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { lifeHref, lifeHrefBySlug } from "./life-href";

describe("lifeHrefBySlug", () => {
  it("builds the life URL from an already-slugified callsign", () => {
    expect(lifeHrefBySlug("dead-eye-jim", "sakhal", 4)).toBe("/players/dead-eye-jim/sakhal/lives/4");
  });

  it("encodes a map slug that needs escaping", () => {
    expect(lifeHrefBySlug("dead-eye-jim", "a b", 1)).toBe("/players/dead-eye-jim/a%20b/lives/1");
  });

  it("agrees with lifeHref for the same player", () => {
    // The two entry points must never drift — lifeHref is the gamertag-taking wrapper.
    expect(lifeHref("Dead Eye Jim", "sakhal", 4)).toBe(lifeHrefBySlug("dead-eye-jim", "sakhal", 4));
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd apps/web && pnpm vitest run src/lib/life-href.test.ts`
Expected: FAIL — `lifeHrefBySlug` is not exported.

- [ ] **Step 3: Write the implementation**

Replace the body of `apps/web/src/lib/life-href.ts` with:

```ts
import { playerSlug } from "./slug";

/** Pure href builder for a single life's timeline page, from an ALREADY-slugified callsign.
 *  The controls rail and sheet hold `ownSlug`, not the raw gamertag — this is their entry point. */
export function lifeHrefBySlug(playerSlugValue: string, mapSlug: string, lifeNumber: number): string {
  return `/players/${playerSlugValue}/${encodeURIComponent(mapSlug)}/lives/${lifeNumber}`;
}

/** Pure href builder for a single life's timeline page, from a raw gamertag. */
export function lifeHref(gamertag: string, mapSlug: string, lifeNumber: number): string {
  return lifeHrefBySlug(playerSlug(gamertag), mapSlug, lifeNumber);
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `cd apps/web && pnpm vitest run src/lib/life-href.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Run the full web suite**

Run: `cd apps/web && pnpm vitest run`
Expected: all files pass. `lifeHref`'s behaviour is unchanged, so every existing caller stays green.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/life-href.ts apps/web/src/lib/life-href.test.ts
git commit -m "refactor(web): extract lifeHrefBySlug for slug-holding callers"
```

---

### Task 2: Carry `lifeNumber` through the rail's card projection

`serverCards()` maps `ServerStanding` → `ServerCardData` and currently discards both life numbers. Add one nullable field that resolves whichever one applies to the card's state.

**Files:**
- Modify: `apps/web/src/components/controls/format.ts:16-39`
- Test: `apps/web/src/components/controls/format.test.ts`

**Interfaces:**
- Consumes: `ServerStanding` from `apps/web/src/lib/types.ts:138` (fields `alive.lifeNumber`, `ban.triggeringLifeNumber`)
- Produces: `ServerCardData` gains `lifeNumber: number | null`

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/components/controls/format.test.ts`:

```ts
import { serverCards } from "./format";
import type { Server, ServerStanding } from "@/lib/types";

const server = (slug: string): Server => ({ id: 1, name: "S", map: "sakhal", slug } as Server);

const aliveStanding = (slug: string): ServerStanding => ({
  serverId: 1, map: "sakhal", slug, state: "alive", character: null,
  alive: { lifeId: 9, lifeNumber: 4, startedAt: "2026-07-01T00:00:00Z", timeAliveSeconds: 100, kills: 0, longestKillMeters: null, killList: [] },
  ban: null,
} as unknown as ServerStanding);

const bannedStanding = (slug: string, triggeringLifeNumber: number | null): ServerStanding => ({
  serverId: 1, map: "sakhal", slug, state: "banned", character: null, alive: null,
  ban: { banId: 3, bannedAt: "2026-07-01T00:00:00Z", expiresAt: "2026-07-02T00:00:00Z", liftPending: false, triggeringLifeNumber },
} as unknown as ServerStanding);

describe("serverCards lifeNumber", () => {
  it("carries the open life's number on an alive card", () => {
    expect(serverCards([server("sakhal")], [aliveStanding("sakhal")])[0]!.lifeNumber).toBe(4);
  });

  it("carries the triggering life's number on a banned card", () => {
    expect(serverCards([server("sakhal")], [bannedStanding("sakhal", 7)])[0]!.lifeNumber).toBe(7);
  });

  it("is null when a banned card's triggering life could not be identified", () => {
    // Nullable upstream. Must not become 0 or undefined — a link would 404.
    expect(serverCards([server("sakhal")], [bannedStanding("sakhal", null)])[0]!.lifeNumber).toBeNull();
  });

  it("is null on a card with no standing at all", () => {
    expect(serverCards([server("sakhal")], [])[0]!.lifeNumber).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd apps/web && pnpm vitest run src/components/controls/format.test.ts`
Expected: FAIL — `lifeNumber` does not exist on `ServerCardData`.

- [ ] **Step 3: Write the implementation**

In `apps/web/src/components/controls/format.ts`, add the field to the type:

```ts
export type ServerCardData = {
  slug: string;
  map: string;
  state: "alive" | "banned" | "idle";
  /** The life this card should link to: the open life when alive, the ban's triggering life when
   *  banned. Null when there is no identifiable life — render no link rather than a broken one. */
  lifeNumber: number | null;
  alive: { timeAliveSeconds: number; kills: number } | null;
  ban: { banId: number; bannedAt: string; expiresAt: string | null; liftPending: boolean } | null;
};
```

and populate it inside the `.map(...)` in `serverCards`, immediately after `state`:

```ts
        state: st?.state ?? "idle",
        lifeNumber: st?.alive?.lifeNumber ?? st?.ban?.triggeringLifeNumber ?? null,
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `cd apps/web && pnpm vitest run src/components/controls/format.test.ts`
Expected: PASS.

- [ ] **Step 5: Fix type errors in existing test fixtures**

Adding a required field breaks any `ServerCardData` literal. Run: `cd apps/web && pnpm tsc --noEmit`
Fix each reported literal — `src/components/controls/sheet.test.tsx:85` is known to have one — by adding `lifeNumber: 7,` to the fixture. Re-run until clean.

- [ ] **Step 6: Run the full web suite and commit**

```bash
cd apps/web && pnpm vitest run && pnpm tsc --noEmit
cd ../.. && git add apps/web/src/components/controls/format.ts apps/web/src/components/controls/format.test.ts apps/web/src/components/controls/sheet.test.tsx
git commit -m "feat(web): carry lifeNumber through the server-card projection"
```

---

### Task 3: Render the `TIMELINE →` link on both surfaces

**Files:**
- Modify: `apps/web/src/components/controls/server-cards.tsx` (light surface)
- Modify: `apps/web/src/components/controls/sheet.tsx:158-193` (dark surface)
- Test: `apps/web/src/components/controls/server-cards.test.tsx`, `apps/web/src/components/controls/sheet.test.tsx`

**Interfaces:**
- Consumes: `ServerCardData.lifeNumber` (Task 2), `lifeHrefBySlug` (Task 1), existing props `card`, `ownSlug`

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/src/components/controls/server-cards.test.tsx`:

```ts
it("links an alive card to the life timeline", () => {
  render(<ServerCard card={{ ...aliveCard, lifeNumber: 4 }} ownSlug="dead-eye-jim" balance={0} now={new Date()} onRedeem={() => {}} redeeming={false} />);
  expect(screen.getByRole("link", { name: /timeline/i })).toHaveAttribute("href", "/players/dead-eye-jim/sakhal/lives/4");
});

it("renders no timeline link when the life number is unknown", () => {
  render(<ServerCard card={{ ...aliveCard, lifeNumber: null }} ownSlug="dead-eye-jim" balance={0} now={new Date()} onRedeem={() => {}} redeeming={false} />);
  expect(screen.queryByRole("link", { name: /timeline/i })).toBeNull();
});

it("renders no timeline link when the viewer has no slug", () => {
  render(<ServerCard card={{ ...aliveCard, lifeNumber: 4 }} ownSlug={null} balance={0} now={new Date()} onRedeem={() => {}} redeeming={false} />);
  expect(screen.queryByRole("link", { name: /timeline/i })).toBeNull();
});
```

If `aliveCard` does not already exist in that file, define it above the tests:

```ts
const aliveCard: ServerCardData = {
  slug: "sakhal", map: "sakhal", state: "alive", lifeNumber: 4,
  alive: { timeAliveSeconds: 3600, kills: 2 }, ban: null,
};
```

Append to `apps/web/src/components/controls/sheet.test.tsx`:

```ts
it("links to the life timeline with ON-DARK tokens, not the light-surface red", () => {
  const card: ServerCardData = { ...bannedCard, lifeNumber: 7 };
  render(<SheetServerRow card={card} ownSlug="dead-eye-jim" balance={0} now={new Date("2026-07-16T09:00:00Z")} onRedeem={() => {}} redeeming={false} />);
  const link = screen.getByRole("link", { name: /timeline/i });
  expect(link).toHaveAttribute("href", "/players/dead-eye-jim/sakhal/lives/7");
  // ⚠️ --red-deep is a light-surface-only token: on bg-dark it fails AA. RTL asserts the DOM,
  // not contrast, so this token assertion is the only thing standing between us and an
  // invisible-but-present control on a phone.
  expect(link.className).toContain("red-soft");
  expect(link.className).not.toContain("red-deep");
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `cd apps/web && pnpm vitest run src/components/controls/server-cards.test.tsx src/components/controls/sheet.test.tsx`
Expected: FAIL — no link with an accessible name matching `/timeline/i`.

- [ ] **Step 3: Implement on the light surface**

In `apps/web/src/components/controls/server-cards.tsx`, add the import:

```ts
import { lifeHrefBySlug } from "@/lib/life-href";
```

and inside the `<p>` fact line, immediately after the existing `banned && ownSlug` "Obituary →" block, add:

```tsx
        {card.lifeNumber !== null && ownSlug && (
          <>
            {" · "}
            <Link href={lifeHrefBySlug(ownSlug, card.slug, card.lifeNumber)} className="font-bold text-red-deep">
              Timeline →
            </Link>
          </>
        )}
```

- [ ] **Step 4: Implement on the dark surface**

In `apps/web/src/components/controls/sheet.tsx`, add the same import, then inside the `<span>` fact line after the existing "Obit →" block, add:

```tsx
          {card.lifeNumber !== null && ownSlug && (
            <>
              {" · "}
              <Link href={lifeHrefBySlug(ownSlug, card.slug, card.lifeNumber)} className="text-red-soft">
                Timeline →
              </Link>
            </>
          )}
```

- [ ] **Step 5: Run the tests and verify they pass**

Run: `cd apps/web && pnpm vitest run src/components/controls`
Expected: PASS.

- [ ] **Step 6: Run the full web suite and commit**

```bash
cd apps/web && pnpm vitest run && pnpm tsc --noEmit
cd ../.. && git add apps/web/src/components/controls
git commit -m "feat(web): link server cards to the life timeline on both surfaces"
```

---

### Task 4: Give idle cards a life to link to

An idle `ServerStanding` has `alive` and `ban` both null, so Task 2 leaves `lifeNumber` null on every idle card. The idle branch in the read model already computes `recent` (the newest life row) and throws it away.

**Files:**
- Modify: `packages/read-models/src/player-page.ts:14` (interface) and `:88-90` (idle branch)
- Modify: `apps/web/src/lib/types.ts:138` (DTO mirror)
- Modify: `apps/web/src/components/controls/format.ts` (fallback chain)
- Test: `packages/read-models/test/player-page.test.ts`, `apps/web/src/components/controls/format.test.ts`

**Interfaces:**
- Produces: `ServerStanding` gains `lastLifeNumber: number | null` in both the read-model interface and the web DTO. `serverCards`'s fallback chain becomes `alive → ban → lastLifeNumber → null`.

- [ ] **Step 1: Write the failing read-model test**

`packages/read-models/test/player-page.test.ts` seeds two servers in `beforeAll` — `chern` (alive, `lifeNumber: 2`) and `sakh` (banned, `lifeNumber: 1`). There is no idle server, so add one.

At the top, next to the existing `svcA` / `svcB`, add `const svcC = ...` following the same pattern, and `let idle: number;`.

In `beforeAll`, after the `sakh` insert:

```ts
  const [c] = await db.insert(servers).values({ nitradoServiceId: svcC, name: "pp-idle", map: "enoch", slug: `idle-${svcC}`, active: true }).returning();
  idle = c!.id;
  // Two ENDED lives, no ban, no open life → an idle standing. Inserted oldest-first so the test
  // proves the read model picks the most recent, not merely the first row it happens to see.
  await db.insert(lives).values({ serverId: idle, playerId: p!.id, lifeNumber: 1, startedAt: hoursAgo(90), endedAt: hoursAgo(80), playtimeSeconds: 36000 });
  await db.insert(lives).values({ serverId: idle, playerId: p!.id, lifeNumber: 2, startedAt: hoursAgo(70), endedAt: hoursAgo(60), playtimeSeconds: 36000 });
```

In `afterAll`, add `idle` to every `inArray(..., [chern, sakh])` array so the new rows are cleaned up: `[chern, sakh, idle]` in the `kills`, `sessions`, `bans`, `lives`, and `servers` deletes.

Then the tests:

```ts
it("gives an idle standing the player's most recent life to link to", () => {
  const pg = ...; // however the surrounding describe obtains it, e.g. await getPlayerPage(db, "Legend", now)
  const card = pg.standing.find((s) => s.serverId === idle)!;
  expect(card.state).toBe("idle");
  // `livesRows` is ordered newest-first, which is why the read model names `livesRows[0]`
  // `recent`. This pins that ordering: if it ever flips, the UI would silently link every idle
  // card to the player's FIRST life instead of their last.
  expect(card.lastLifeNumber).toBe(2);
});

it("carries the open life's number on an alive standing", () => {
  const pg = ...;
  expect(pg.standing.find((s) => s.serverId === chern)!.lastLifeNumber).toBe(2);
});

it("carries the triggering life's number on a banned standing", () => {
  const pg = ...;
  expect(pg.standing.find((s) => s.serverId === sakh)!.lastLifeNumber).toBe(1);
});
```

Match the surrounding `describe`'s existing style for obtaining `pg` — the file uses `const pg = (await getPlayerPage(db, "Legend", now))!;` inside each `it`.

- [ ] **Step 2: Run it and verify it fails**

Run: `cd packages/read-models && TEST_DATABASE_URL=... pnpm vitest run test/player-page.test.ts`
Expected: FAIL — `lastLifeNumber` is undefined.

- [ ] **Step 3: Implement in the read model**

In `packages/read-models/src/player-page.ts`, extend the interface at line 14:

```ts
export interface ServerStanding { serverId: number; map: string; slug: string; state: "alive" | "banned" | "idle"; character: PlayerCharacter | null; alive: AliveStanding | null; ban: BanStanding | null; lastLifeNumber: number | null; }
```

Then add `lastLifeNumber` to all three `card = { ... }` assignments:

- alive branch (line ~83): `..., ban: null, lastLifeNumber: openLife.lifeNumber };`
- banned branch (line ~86): `..., triggeringLifeNumber: trig?.lifeNumber ?? null }, lastLifeNumber: trig?.lifeNumber ?? livesRows[0]?.lifeNumber ?? null };`
- idle branch (line ~89): `..., alive: null, ban: null, lastLifeNumber: recent?.lifeNumber ?? null };`

No new query — `openLife`, `trig`, and `recent` are all already in scope.

- [ ] **Step 4: Run the read-model test and verify it passes**

Run: `cd packages/read-models && TEST_DATABASE_URL=... pnpm vitest run test/player-page.test.ts`
Expected: PASS.

- [ ] **Step 5: Mirror the DTO and widen the fallback chain**

In `apps/web/src/lib/types.ts:138`, add `lastLifeNumber: number | null` to the `ServerStanding` type.

In `apps/web/src/components/controls/format.ts`, extend the fallback:

```ts
        lifeNumber: st?.alive?.lifeNumber ?? st?.ban?.triggeringLifeNumber ?? st?.lastLifeNumber ?? null,
```

- [ ] **Step 6: Add the idle-card projection test**

Append to `apps/web/src/components/controls/format.test.ts`:

```ts
it("falls back to the last life on an idle card", () => {
  const idle = { serverId: 1, map: "sakhal", slug: "sakhal", state: "idle", character: null, alive: null, ban: null, lastLifeNumber: 3 } as unknown as ServerStanding;
  expect(serverCards([server("sakhal")], [idle])[0]!.lifeNumber).toBe(3);
});

it("stays null on an idle card for a player who has never had a life there", () => {
  const idle = { serverId: 1, map: "sakhal", slug: "sakhal", state: "idle", character: null, alive: null, ban: null, lastLifeNumber: null } as unknown as ServerStanding;
  expect(serverCards([server("sakhal")], [idle])[0]!.lifeNumber).toBeNull();
});
```

- [ ] **Step 7: Run everything and commit**

```bash
cd packages/read-models && pnpm vitest run
cd ../../apps/web && pnpm vitest run && pnpm tsc --noEmit
cd ../.. && pnpm turbo run typecheck
git add packages/read-models/src/player-page.ts packages/read-models/test/player-page.test.ts apps/web/src/lib/types.ts apps/web/src/components/controls/format.ts apps/web/src/components/controls/format.test.ts
git commit -m "feat: link idle server cards to the player's most recent life"
```

---

### Task 5: Article dossier → life timeline

**Files:**
- Modify: `apps/web/src/components/obituaries/obituary-article.tsx:30`
- Modify: `apps/web/src/components/birth-notices/birth-notice-article.tsx`
- Test: the matching `.test.tsx` for each

**Interfaces:**
- Consumes: `lifeHref` (gamertag form, Task 1 — these components hold the raw gamertag), and the article fields `gamertag`, `map`, `lifeNumber`

- [ ] **Step 1: Write the failing tests**

For each of the two article components, add a test asserting that the byline's `Life {n}` text is a link to `lifeHref(article.gamertag, article.map, article.lifeNumber)`, and a second test asserting that when `map` is null **no link renders and the page does not throw** — `mapSlug` is nullable and the news interior already degrades this way.

```tsx
it("links the life number to that life's timeline", () => {
  render(<ObituaryArticle article={{ ...articleFixture, gamertag: "Dead Eye Jim", map: "sakhal", lifeNumber: 4 }} />);
  expect(screen.getByRole("link", { name: /life 4/i })).toHaveAttribute("href", "/players/dead-eye-jim/sakhal/lives/4");
});

it("renders the life number as plain text when the server has no slug", () => {
  render(<ObituaryArticle article={{ ...articleFixture, map: null, lifeNumber: 4 }} />);
  expect(screen.queryByRole("link", { name: /life 4/i })).toBeNull();
  expect(screen.getByText(/life 4/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run and verify they fail**

Run: `cd apps/web && pnpm vitest run src/components/obituaries src/components/birth-notices`
Expected: FAIL — no link with that name.

- [ ] **Step 3: Implement**

In `obituary-article.tsx`, replace the bare `Life {article.lifeNumber}` in the byline (line ~30) with a conditional link:

```tsx
{article.map ? (
  <Link href={lifeHref(article.gamertag, article.map, article.lifeNumber)} className="font-bold text-ink underline">
    Life {article.lifeNumber}
  </Link>
) : (
  <>Life {article.lifeNumber}</>
)}
```

Add `import Link from "next/link";` and `import { lifeHref } from "@/lib/life-href";` if not already present. Apply the same change to `birth-notice-article.tsx`.

- [ ] **Step 4: Run and verify they pass**

Run: `cd apps/web && pnpm vitest run src/components/obituaries src/components/birth-notices`
Expected: PASS.

- [ ] **Step 5: Run the full suite and commit**

```bash
cd apps/web && pnpm vitest run && pnpm tsc --noEmit
cd ../.. && git add apps/web/src/components/obituaries apps/web/src/components/birth-notices
git commit -m "feat(web): link an article's dossier to that life's timeline"
```

---

### Task 6: Life timeline → its obituary

The only task that adds a query. An obituary carries `(server_id, gamertag, life_number)` as real columns, so this needs no `article_subjects`.

**Files:**
- Modify: `packages/read-models/src/life-timeline.ts:10-23` (interface) and the `Promise.all` at `:36-41`
- Modify: `apps/web/src/lib/types.ts` (`LifeTimelineData`)
- Modify: `apps/web/src/components/life/hero.tsx` (render the link)
- Test: `packages/read-models/test/life-timeline.test.ts`, `apps/web/src/components/life/hero.test.tsx`

**Interfaces:**
- Produces: `LifeTimeline` and `LifeTimelineData` each gain `obituarySlug: string | null`

- [ ] **Step 1: Write the failing read-model tests**

Append to `packages/read-models/test/life-timeline.test.ts`. The file already seeds `serverId`, `pid`, `deadLifeId`, and `openLifeId` in `beforeAll`, and the player's gamertag is `` `LtHero-${svc}` `` — reuse them. Add `articles` to the existing `@onelife/db` import.

```ts
describe("obituarySlug", () => {
  it("is null when the paper has not written about this life", async () => {
    const t = await getLifeTimeline(db, serverId, `LtHero-${svc}`, deadLifeId);
    expect(t!.obituarySlug).toBeNull();
  });

  it("finds a published obituary for this exact life", async () => {
    await db.insert(articles).values({
      kind: "obituary", status: "published", slug: `lt-obit-${svc}`,
      serverId, gamertag: `LtHero-${svc}`, lifeNumber: 1, lifeStartedAt: start,
      headline: "Last Light On The Ridge", body: "x", deathAt: mins(360),
    });
    const t = await getLifeTimeline(db, serverId, `LtHero-${svc}`, deadLifeId);
    expect(t!.obituarySlug).toBe(`lt-obit-${svc}`);
  });

  it("ignores a retracted article for the same life", async () => {
    // A retraction is a public correction, not the life's obituary. Linking it would present a
    // withdrawn story as the record of this death.
    await db.update(articles).set({ status: "retracted" }).where(eq(articles.slug, `lt-obit-${svc}`));
    const t = await getLifeTimeline(db, serverId, `LtHero-${svc}`, deadLifeId);
    expect(t!.obituarySlug).toBeNull();
  });
});
```

Import `eq` from `drizzle-orm` alongside the existing `inArray`. These three tests run in order and share state deliberately: the second seeds the row the third mutates. If the suite's cleanup in `afterAll` filters by `inArray`, add the new article slug to it.

- [ ] **Step 2: Run and verify they fail**

Run: `cd packages/read-models && TEST_DATABASE_URL=... pnpm vitest run test/life-timeline.test.ts`
Expected: FAIL — `obituarySlug` is undefined.

- [ ] **Step 3: Implement in the read model**

In `packages/read-models/src/life-timeline.ts`, add to the `LifeTimeline` interface:

```ts
  /** Slug of this life's published obituary, or null. Published only — a retracted article is a
   *  correction, not the life's obituary, and must never be linked as one. */
  obituarySlug: string | null;
```

Add a fourth promise to the existing `Promise.all` (it already destructures four values; this makes five):

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
          eq(articles.lifeNumber, life.lifeNumber),
        ),
      )
      .limit(1),
```

Import `articles` from `@onelife/db` alongside the existing imports. Destructure the new value as `obituaryRows` and return `obituarySlug: obituaryRows[0]?.slug ?? null` in the result object.

Gamertag comparison is case-insensitive, matching the rest of the codebase.

- [ ] **Step 4: Run and verify they pass**

Run: `cd packages/read-models && TEST_DATABASE_URL=... pnpm vitest run test/life-timeline.test.ts`
Expected: PASS, 3 new tests.

- [ ] **Step 5: Mirror the DTO and render the link**

Add `obituarySlug: string | null` to `LifeTimelineData` in `apps/web/src/lib/types.ts`.

Confirm the API route for `GET /players/:gamertag/:map/lives/:n` passes the read-model result through rather than picking fields; if it picks fields explicitly, add `obituarySlug` there too.

In `apps/web/src/components/life/hero.tsx`, render a link when `obituarySlug` is non-null:

```tsx
{obituarySlug && (
  <Link href={`/obituaries/${obituarySlug}`} className="font-mono text-[11px] font-bold uppercase tracking-[.06em] text-red-deep underline">
    Read the obituary →
  </Link>
)}
```

`hero.tsx` renders on the light paper surface only, so `red-deep` is correct here.

- [ ] **Step 6: Write and run the hero test**

```tsx
it("links to the obituary when one is published", () => {
  render(<LifeHero {...heroProps} obituarySlug="last-light-on-the-ridge" />);
  expect(screen.getByRole("link", { name: /obituary/i })).toHaveAttribute("href", "/obituaries/last-light-on-the-ridge");
});

it("renders no obituary link when there is none", () => {
  render(<LifeHero {...heroProps} obituarySlug={null} />);
  expect(screen.queryByRole("link", { name: /obituary/i })).toBeNull();
});
```

Run: `cd apps/web && pnpm vitest run src/components/life`
Expected: PASS.

- [ ] **Step 7: Run everything and commit**

```bash
cd packages/read-models && pnpm vitest run
cd ../../apps/web && pnpm vitest run && pnpm tsc --noEmit
cd ../.. && pnpm turbo run typecheck
git add packages/read-models/src/life-timeline.ts packages/read-models/test/life-timeline.test.ts apps/web/src/lib/types.ts apps/web/src/components/life apps/api/src/routes
git commit -m "feat: link a life timeline to its published obituary"
```

---

### Task 7: Changelog, CLAUDE.md, and the PR

The guard blocks the PR unless both `CHANGELOG.md` and `CLAUDE.md` changed on this branch.

**Files:**
- Modify: `CHANGELOG.md` (`Unreleased` → `Added`)
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add the changelog entry**

Under `## [Unreleased]` → `### Added`, in user-facing terms:

```markdown
- Cross-links between players, lives, and articles. Server cards in the account rail now open
  the life they describe; an article's dossier links to that life's full event timeline; and a
  life timeline links to its obituary when the paper has published one.
```

- [ ] **Step 2: Update CLAUDE.md**

Add to the Player pages / life timeline area: `lifeHrefBySlug` is the entry point for callers holding an already-slugified callsign (the rail and sheet), `lifeHref` wraps it for gamertag holders, and `ServerStanding.lastLifeNumber` exists so an idle card has something to link to. Note that only `status='published'` articles are ever linked.

- [ ] **Step 3: Verify the whole repo is green**

```bash
pnpm turbo run typecheck
pnpm turbo run test --concurrency=1
```

- [ ] **Step 4: Commit and open the PR**

```bash
git add CHANGELOG.md CLAUDE.md
git commit -m "docs: changelog + CLAUDE.md for cross-linking PR-1"
git push -u origin feature/cross-linking
```

Then open the PR into `develop` with a body covering what changed, why the life numbers were already available, and the two-surface token note. Use the `finishing-a-feature` skill, which sequences this correctly.

---

## Deployment

Plain `./deploy/deploy.sh`. **No `--rebuild`** — no migration, no projection-table shape change.

## Follow-on work

PR-2 (`article_subjects` + In The Paper) and PR-3 (prose linkification) get their own plans. PR-2's backfill should not be planned in detail until the `facts` jsonb shape has been inspected against a production dump — see §5.3 and §9.1 of the spec.
