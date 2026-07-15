# Player Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the shipped `/players/[slug]` page — single roomy column with no expand/collapse, an avatar-free hero with a full-width stat band, state-colored current-standing cards, muted paginated past-life cards, and a survivor-dossier OpenGraph image.

**Architecture:** `getPlayerPage` gains server-side pagination (enrich only the current slice) and drops `heroCharacter`. The web components are rewritten to remove all `<details>` and go single-column; a new `PlayerPagination` links `?page=`. A shared pure `heroStats` helper drives the stat set + highlight rule for both the hero band and the redesigned OG image.

**Tech Stack:** TypeScript/ESM, pnpm+turbo, Postgres+Drizzle, Fastify, Next.js 15 App Router + Tailwind, Vitest + `@onelife/test-support`, `next/og` `ImageResponse`.

## Global Constraints

- **Module system:** ESM; intra-package relative imports use `.js`.
- **Tests:** `pnpm --filter <pkg> test`; DB suites need `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test` (Postgres is on **port 5434** on this machine). Full suite: `pnpm turbo run test --concurrency=1`. Typecheck: `pnpm turbo run typecheck`.
- **Testing convention:** read-models → Postgres integration tests; pure helpers + presentational components → unit tests; **server components, the page route, and the OG image route are NOT unit-tested** (verified by typecheck + `build`, plus a manual visual check for the OG image).
- **Stat set + highlight rule (identical on the hero band AND the OG card):** always show **Lives / Deaths / Longest life**; show **Kills only when kills > 0**; **Longest life is always the amber-highlighted stat**; nothing else is highlighted. This lives in one shared pure helper (`heroStats`) so the two surfaces never diverge.
- **Tailwind tokens in this repo:** `border-line`, `bg-panel`, `bg-panel-2`, `text-amber`, `text-bone`, `text-muted`, `font-hand`, `font-display`, `font-mono`; `cn()` from `@/lib/utils`.
- **Dates over the wire:** API serializes `Date`→ISO string; web types use `string`.
- **No character avatar in the hero** (identity is global). Character avatars stay on per-life/standing cards.
- **Only the logo's skull** may appear as a skull anywhere — never a generic/different one.
- **Workflow:** on branch `feature/player-page-redesign` (already created from `develop`). CHANGELOG + CLAUDE.md are the last edits before the PR.
- **Spec:** `docs/superpowers/specs/2026-07-15-player-page-redesign.md`.

---

## Task 1: Paginate `getPlayerPage`, drop `heroCharacter`

**Files:**
- Modify: `packages/read-models/src/player-page.ts`
- Test: `packages/read-models/test/player-page.test.ts`

**Interfaces:**
- Produces: `getPlayerPage(db, gamertag, now, opts?: { page?: number; pageSize?: number }): Promise<PlayerPage | null>`; `PLAYER_PAST_LIVES_PAGE_SIZE = 10`. `PlayerPage` **loses** `heroCharacter` and **gains** `pastLivesTotal: number; pastLivesPage: number; pastLivesPageSize: number`. `pastLives` is now the current page's slice (newest death first). Totals still reflect all lives.

- [ ] **Step 1: Write the failing test** — add a new pagination fixture + cases to `player-page.test.ts` (keep the existing suite; add this `describe` at the end):

```ts
describe("getPlayerPage pagination", () => {
  const svcP = Math.floor(Math.random() * 1e8) + 49e7;
  let srv: number;
  beforeAll(async () => {
    const [s] = await db.insert(servers).values({ nitradoServiceId: svcP, name: "pg-page", map: "chernarusplus", slug: `pgpage-${svcP}`, active: true }).returning();
    srv = s!.id;
    const [pl] = await db.insert(players).values({ gamertag: "Prolific", firstSeenAt: hoursAgo(1000), lastSeenAt: now }).returning();
    // 12 ended qualified lives, each ≥5min playtime so they qualify; newest first by endedAt
    for (let i = 0; i < 12; i++) {
      await db.insert(lives).values({
        serverId: srv, playerId: pl!.id, lifeNumber: i + 1,
        startedAt: hoursAgo(50 - i * 2), endedAt: hoursAgo(49 - i * 2),
        playtimeSeconds: 600, deathCause: "pvp", deathByGamertag: `killer${i}`,
      });
    }
  });
  afterAll(async () => {
    await db.delete(lives).where(eq(lives.serverId, srv));
    await db.delete(players).where(eq(players.gamertag, "Prolific"));
    await db.delete(servers).where(eq(servers.id, srv));
  });

  it("returns 10 newest on page 1 with the true total", async () => {
    const pg = (await getPlayerPage(db, "Prolific", now, { page: 1 }))!;
    expect(pg.pastLivesTotal).toBe(12);
    expect(pg.pastLivesPage).toBe(1);
    expect(pg.pastLivesPageSize).toBe(10);
    expect(pg.pastLives.length).toBe(10);
    // newest death first
    expect(pg.pastLives[0]!.endedAt.getTime()).toBeGreaterThan(pg.pastLives[1]!.endedAt.getTime());
    // totals reflect ALL lives, not the slice
    expect(pg.totals.deaths).toBe(12);
  });
  it("returns the remainder on page 2", async () => {
    const pg = (await getPlayerPage(db, "Prolific", now, { page: 2 }))!;
    expect(pg.pastLives.length).toBe(2);
    expect(pg.pastLivesPage).toBe(2);
  });
  it("clamps a too-large page to the last page", async () => {
    const pg = (await getPlayerPage(db, "Prolific", now, { page: 99 }))!;
    expect(pg.pastLivesPage).toBe(2);
    expect(pg.pastLives.length).toBe(2);
  });
});
```

Also delete any `heroCharacter` reference the existing suite makes (there are none today — confirm with a grep).

- [ ] **Step 2: Run test to verify it fails**

Run: `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/read-models test player-page`
Expected: FAIL — `pastLivesTotal`/`opts` don't exist yet.

- [ ] **Step 3: Implement** — replace the `PlayerPage` interface and the `getPlayerPage` function in `player-page.ts` (keep the other interfaces, `ACTIVE_BAN_STATUSES`, `longest`, `charShape` unchanged; add the page-size constant):

```ts
export interface PlayerPage {
  gamertag: string; verified: boolean; firstSeenAt: Date | null; aliveAnywhere: boolean;
  totals: { kills: number; lives: number; deaths: number; longestLifeSeconds: number };
  standing: ServerStanding[];
  pastLives: PastLife[];
  pastLivesTotal: number; pastLivesPage: number; pastLivesPageSize: number;
}

export const PLAYER_PAST_LIVES_PAGE_SIZE = 10;

export async function getPlayerPage(
  db: Database, gamertag: string, now: Date,
  opts: { page?: number; pageSize?: number } = {},
): Promise<PlayerPage | null> {
  const pageSize = opts.pageSize ?? PLAYER_PAST_LIVES_PAGE_SIZE;
  const reqPage = Math.max(1, Math.trunc(opts.page ?? 1) || 1);

  const real = await resolveGamertagBySlug(db, gamertag);
  if (!real) return null;
  gamertag = real;

  const [p] = await db.select().from(players).where(eq(players.gamertag, gamertag));
  const activeServers = await db.select().from(servers).where(eq(servers.active, true));
  const activeBans = await db.select().from(bans).where(and(eq(bans.gamertag, gamertag), inArray(bans.status, ACTIVE_BAN_STATUSES)));
  const [vf] = await db.select({ id: gamertagLinks.id }).from(gamertagLinks).where(and(eq(gamertagLinks.gamertag, gamertag), eq(gamertagLinks.status, "verified"))).limit(1);

  const standing: ServerStanding[] = [];
  const endedLives: { row: Awaited<ReturnType<typeof getPlayerLives>> extends (infer R)[] | null ? R : never; serverId: number; map: string; slug: string }[] = [];
  const totals = { kills: 0, lives: 0, deaths: 0, longestLifeSeconds: 0 };

  for (const s of activeServers) {
    if (!s.slug) continue;
    const livesRows = (await getPlayerLives(db, s.id, gamertag)) ?? [];
    const serverBan = activeBans.find((b) => b.serverId === s.id) ?? null;
    if (livesRows.length === 0 && !serverBan) continue;

    const profile = await getPlayerProfile(db, s.id, gamertag, now);

    totals.lives += livesRows.length;
    totals.deaths += livesRows.filter((l) => l.endedAt !== null).length;
    const kcRow = await db.select({ c: sql<number>`count(*)::int` }).from(kills).where(and(eq(kills.serverId, s.id), eq(kills.killerGamertag, gamertag)));
    totals.kills += kcRow[0]?.c ?? 0;
    for (const l of livesRows) {
      const secs = l.endedAt ? l.playtimeSeconds : (profile?.currentLifeSeconds ?? 0);
      if (secs > totals.longestLifeSeconds) totals.longestLifeSeconds = secs;
    }

    const openLife = livesRows.find((l) => l.endedAt === null) ?? null;
    let card: ServerStanding;
    if (openLife && profile?.alive) {
      const killList = await getLifeKills(db, s.id, gamertag, openLife.startedAt, null);
      card = { serverId: s.id, map: s.map, slug: s.slug, state: "alive", character: await charShape(db, s.id, gamertag, openLife.startedAt, null), alive: { lifeId: openLife.id, startedAt: openLife.startedAt, timeAliveSeconds: profile.currentLifeSeconds, kills: killList.length, longestKillMeters: longest(killList), killList }, ban: null };
    } else if (serverBan) {
      const trig = livesRows.find((l) => l.startedAt.getTime() === serverBan.lifeStartedAt.getTime()) ?? null;
      card = { serverId: s.id, map: s.map, slug: s.slug, state: "banned", character: trig ? await charShape(db, s.id, gamertag, trig.startedAt, trig.endedAt) : null, alive: null, ban: { banId: serverBan.id, bannedAt: serverBan.bannedAt, expiresAt: serverBan.expiresAt, liftPending: serverBan.status === "lift_pending", triggeringLifeNumber: trig?.lifeNumber ?? null } };
    } else {
      const recent = livesRows[0] ?? null;
      card = { serverId: s.id, map: s.map, slug: s.slug, state: "idle", character: recent ? await charShape(db, s.id, gamertag, recent.startedAt, recent.endedAt) : null, alive: null, ban: null };
    }
    standing.push(card);

    for (const l of livesRows.filter((r) => r.endedAt !== null)) {
      endedLives.push({ row: l, serverId: s.id, map: s.map, slug: s.slug });
    }
  }

  const total = endedLives.length;
  if (standing.length === 0 && total === 0) return null;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(reqPage, totalPages);
  endedLives.sort((a, b) => b.row.endedAt!.getTime() - a.row.endedAt!.getTime());
  const pageSlice = endedLives.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);

  const pastLives: PastLife[] = [];
  for (const { row: l, serverId, map, slug } of pageSlice) {
    const killList = await getLifeKills(db, serverId, gamertag, l.startedAt, l.endedAt);
    const scRow = await db.select({ c: sql<number>`count(*)::int` }).from(sessions).where(and(eq(sessions.serverId, serverId), eq(sessions.lifeId, l.id)));
    pastLives.push({ lifeId: l.id, serverId, map, slug, lifeNumber: l.lifeNumber, startedAt: l.startedAt, endedAt: l.endedAt!, timeAliveSeconds: l.playtimeSeconds, kills: killList.length, longestKillMeters: longest(killList), character: await charShape(db, serverId, gamertag, l.startedAt, l.endedAt), death: { cause: l.deathCause, byGamertag: l.deathByGamertag, weapon: l.deathWeapon, distanceMeters: l.deathDistance }, vitals: { energy: l.energyAtDeath, water: l.waterAtDeath, bleedSources: l.bleedSourcesAtDeath }, sessions: scRow[0]?.c ?? 0, killList });
  }

  return { gamertag, verified: !!vf, firstSeenAt: p?.firstSeenAt ?? null, aliveAnywhere: standing.some((s) => s.state === "alive"), totals, standing, pastLives, pastLivesTotal: total, pastLivesPage: page, pastLivesPageSize: pageSize };
}
```

If the `endedLives` element type expression is awkward under the compiler, replace it with a small named type:
```ts
type LifeRow = NonNullable<Awaited<ReturnType<typeof getPlayerLives>>>[number];
// then: const endedLives: { row: LifeRow; serverId: number; map: string; slug: string }[] = [];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/read-models test player-page`
Expected: PASS (existing suite + 3 new pagination tests).

- [ ] **Step 5: Commit**

```bash
git add packages/read-models/src/player-page.ts packages/read-models/test/player-page.test.ts
git commit -m "feat(read-models): paginate getPlayerPage, drop heroCharacter"
```

---

## Task 2: API route `?page=`

**Files:**
- Modify: `apps/api/src/routes/player-aggregate.ts`
- Test: `apps/api/test/player-aggregate-routes.test.ts` (add a case)

**Interfaces:**
- Consumes: `getPlayerPage` (now accepts `{ page }`). Produces: `GET /players/:gamertag?page=N` → `PlayerPage` with `pastLivesTotal/Page/PageSize`.

- [ ] **Step 1: Write the failing test** (append inside the existing `describe`):

```ts
  it("carries pagination fields and accepts ?page=", async () => {
    const res = await app.inject({ method: "GET", url: `/players/Twhizzle4life?page=2` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("pastLivesTotal");
    expect(body).toHaveProperty("pastLivesPage");
    expect(body).toHaveProperty("pastLivesPageSize");
    expect(body).not.toHaveProperty("heroCharacter");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/api test player-aggregate-routes`
Expected: FAIL — body lacks `pastLivesTotal`.

- [ ] **Step 3: Implement** — update the first route in `player-aggregate.ts`. Add a query schema and pass `page`:

```ts
const pageQ = z.object({ page: z.coerce.number().int().positive().catch(1) });
// ...
  app.get("/players/:gamertag", async (req, reply) => {
    const p = gt.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: "bad_request" });
    const { page } = pageQ.parse(req.query);
    const pg = await getPlayerPage(db, p.data.gamertag, new Date(), { page });
    if (!pg) return reply.code(404).send({ error: "not_found" });
    return pg;
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/api test player-aggregate-routes`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/player-aggregate.ts apps/api/test/player-aggregate-routes.test.ts
git commit -m "feat(api): accept ?page= on GET /players/:gamertag"
```

---

## Task 3: Shared player-page helpers (`heroStats`, `monthYear`, `relativeDate`)

**Files:**
- Modify: `apps/web/src/components/player/format.ts`
- Test: `apps/web/src/components/player/format.test.ts` (extend)

**Interfaces:**
- Produces (used by the hero, OG image, and past-life card):
  - `type HeroStat = { label: string; value: string; hot: boolean }`
  - `heroStats(totals: { kills:number; lives:number; deaths:number; longestLifeSeconds:number }): HeroStat[]`
  - `monthYear(iso: string): string` → e.g. `"Mar 2026"`
  - `relativeDate(iso: string, now: Date): string` → e.g. `"2 days ago"`

- [ ] **Step 1: Write the failing test** (append to `format.test.ts`):

```ts
import { heroStats, monthYear, relativeDate } from "./format";

describe("heroStats", () => {
  it("drops Kills when 0 and always highlights Longest life", () => {
    const s = heroStats({ kills: 0, lives: 7, deaths: 6, longestLifeSeconds: 3600 });
    expect(s.map((x) => x.label)).toEqual(["Lives", "Deaths", "Longest life"]);
    expect(s.find((x) => x.hot)!.label).toBe("Longest life");
  });
  it("includes Kills when > 0, and only Longest life is hot", () => {
    const s = heroStats({ kills: 42, lives: 7, deaths: 6, longestLifeSeconds: 3600 });
    expect(s.map((x) => x.label)).toEqual(["Kills", "Lives", "Deaths", "Longest life"]);
    expect(s.filter((x) => x.hot).map((x) => x.label)).toEqual(["Longest life"]);
    expect(s[0]).toMatchObject({ value: "42", hot: false });
  });
});

describe("monthYear / relativeDate", () => {
  it("formats month + year (UTC)", () => {
    expect(monthYear("2026-03-09T00:00:00Z")).toBe("Mar 2026");
  });
  it("formats relative dates", () => {
    const now = new Date("2026-07-15T12:00:00Z");
    expect(relativeDate("2026-07-15T09:00:00Z", now)).toBe("today");
    expect(relativeDate("2026-07-14T09:00:00Z", now)).toBe("yesterday");
    expect(relativeDate("2026-07-12T12:00:00Z", now)).toBe("3 days ago");
    expect(relativeDate("2026-06-20T12:00:00Z", now)).toBe("3 weeks ago");
  });
});
```

- [ ] **Step 2: Run test** → FAIL. `pnpm --filter @onelife/web test player/format`

- [ ] **Step 3: Implement** — append to `format.ts`:

```ts
export type HeroStat = { label: string; value: string; hot: boolean };

export function heroStats(totals: { kills: number; lives: number; deaths: number; longestLifeSeconds: number }): HeroStat[] {
  const out: HeroStat[] = [];
  if (totals.kills > 0) out.push({ label: "Kills", value: String(totals.kills), hot: false });
  out.push({ label: "Lives", value: String(totals.lives), hot: false });
  out.push({ label: "Deaths", value: String(totals.deaths), hot: false });
  out.push({ label: "Longest life", value: formatDuration(totals.longestLifeSeconds), hot: true });
  return out;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function monthYear(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function relativeDate(iso: string, now: Date): string {
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) { const w = Math.floor(days / 7); return `${w} week${w > 1 ? "s" : ""} ago`; }
  const m = Math.floor(days / 30);
  return `${m} month${m > 1 ? "s" : ""} ago`;
}
```

- [ ] **Step 4: Run test** → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/player/format.ts apps/web/src/components/player/format.test.ts
git commit -m "feat(web): shared heroStats + date helpers for player page"
```

---

## Task 4: Web types/client + hero rewrite (avatar-free stat band)

**Files:**
- Modify: `apps/web/src/lib/types.ts` (drop `heroCharacter`; add pagination fields)
- Modify: `apps/web/src/lib/api.ts` (`getPlayerPage(slug, page?)`)
- Modify: `apps/web/src/components/player/player-hero.tsx` (rewrite)
- Test: `apps/web/src/components/player/player-hero.test.tsx` (create)

**Interfaces:**
- Consumes: `heroStats`, `monthYear`, `heroStatusLine` (Task 3 / existing). Produces the new `PlayerPage` web type + `getPlayerPage(slug: string, page?: number)`.

- [ ] **Step 1: Update the type** in `apps/web/src/lib/types.ts` — in the `PlayerPage` type, **remove** the `heroCharacter` field and **add** `pastLivesTotal: number; pastLivesPage: number; pastLivesPageSize: number;`. (Leave `PlayerCharacter` — still used by standing/past-life cards.)

- [ ] **Step 2: Update the client** in `apps/web/src/lib/api.ts`:

```ts
export const getPlayerPage = (slug: string, page?: number) =>
  getOrNull<PlayerPage>(`/api/players/${encodeURIComponent(slug)}${page && page > 1 ? `?page=${page}` : ""}`);
```

- [ ] **Step 3: Write the failing hero test** `player-hero.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { PlayerHero } from "./player-hero";

const base: any = { gamertag: "yrjustbad", verified: true, firstSeenAt: "2026-03-09T00:00:00Z", aliveAnywhere: false, standing: [], totals: { kills: 42, lives: 7, deaths: 6, longestLifeSeconds: 64800 } };

describe("PlayerHero", () => {
  it("renders the gamertag and no character avatar", () => {
    const { container } = render(<PlayerHero page={base} />);
    expect(screen.getByRole("heading", { name: "yrjustbad" })).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull(); // no avatar image
  });
  it("shows the stat band and drops Kills when 0", () => {
    render(<PlayerHero page={{ ...base, totals: { ...base.totals, kills: 0 } }} />);
    expect(screen.queryByText("Kills")).toBeNull();
    expect(screen.getByText("Longest life")).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run test** → FAIL (old hero renders an avatar + always shows Kills). `pnpm --filter @onelife/web test player-hero`

- [ ] **Step 5: Rewrite** `player-hero.tsx`:

```tsx
import type { PlayerPage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { heroStats, monthYear, heroStatusLine } from "./format";

export function PlayerHero({ page }: { page: PlayerPage }) {
  const stats = heroStats(page.totals);
  const since = page.firstSeenAt ? monthYear(page.firstSeenAt) : null;
  const status = page.aliveAnywhere ? heroStatusLine(page) : null;
  const sub = [since ? `First seen ${since}` : null, status].filter(Boolean).join(" · ");
  return (
    <header className="space-y-6">
      <div className="text-center">
        <h1 className="font-display text-4xl text-bone sm:text-5xl">{page.gamertag}</h1>
        {page.verified && (
          <p className="mt-3">
            <span className="rounded-full border border-emerald-500/40 px-3 py-1 text-xs text-emerald-400">✓ Verified survivor</span>
          </p>
        )}
        {sub && <p className="mt-3 text-xs text-muted">{sub}</p>}
      </div>
      <div className="flex overflow-hidden rounded-xl border border-line">
        {stats.map((st, i) => (
          <div key={st.label} className={cn("flex-1 bg-panel-2 px-2 py-4 text-center", i > 0 && "border-l border-line")}>
            <span className={cn("block font-display text-2xl", st.hot ? "text-amber" : "text-bone")}>{st.value}</span>
            <span className="mt-1 block text-[9px] uppercase tracking-wide text-muted">{st.label}</span>
          </div>
        ))}
      </div>
    </header>
  );
}
```

- [ ] **Step 6: Verify** — `pnpm --filter @onelife/web test player-hero` PASS; then `pnpm --filter @onelife/web typecheck` PASS (confirms nothing else referenced `heroCharacter`).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/types.ts apps/web/src/lib/api.ts apps/web/src/components/player/player-hero.tsx apps/web/src/components/player/player-hero.test.tsx
git commit -m "feat(web): avatar-free hero + paginated PlayerPage type/client"
```

---

## Task 5: Rewrite standing + past-life cards (no `<details>`, state/archive color)

**Files:**
- Modify: `apps/web/src/components/player/standing-card.tsx`
- Modify: `apps/web/src/components/player/past-life-card.tsx`
- Test: `apps/web/src/components/player/standing-card.test.tsx`, `apps/web/src/components/player/past-life-card.test.tsx`

**Interfaces:**
- `StandingCard` prop becomes `{ standing: ServerStanding; now: Date; pageGamertag: string }` (single required `pageGamertag`, drop the old `& { pageGamertag? }` intersection). `PastLifeCard` prop becomes `{ life: PastLife; now: Date }` (adds `now` for `relativeDate`).

- [ ] **Step 1: Update the tests** — both must assert **no `<details>`** and that content is visible without interaction.

`standing-card.test.tsx` (keep the `QueryClientProvider` wrapper — `SelfUnbanButton` uses a query hook; mirror the existing wrapper). Pass `pageGamertag` as a prop:

```tsx
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect } from "vitest";
import { StandingCard } from "./standing-card";

const now = new Date("2026-07-14T12:00:00Z");
const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
const base: any = { serverId: 1, map: "chernarusplus", slug: "chern", character: null, alive: null, ban: null };

describe("StandingCard", () => {
  it("shows alive stats + kill list with no <details>", () => {
    const { container } = wrap(<StandingCard now={now} pageGamertag="Legend" standing={{ ...base, state: "alive", alive: { lifeId: 1, startedAt: now.toISOString(), timeAliveSeconds: 3600, kills: 9, longestKillMeters: 312, killList: [] } }} />);
    expect(container.querySelector("details")).toBeNull();
    expect(screen.getByText("Chernarus")).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();
    expect(screen.getByText("312m")).toBeInTheDocument();
  });
  it("shows the ban countdown", () => {
    wrap(<StandingCard now={now} pageGamertag="Legend" standing={{ ...base, state: "banned", ban: { banId: 5, bannedAt: now.toISOString(), expiresAt: "2026-07-14T14:00:00Z", liftPending: false, triggeringLifeNumber: 1 } }} />);
    expect(screen.getByText(/2h 0m/)).toBeInTheDocument();
    expect(screen.getByText(/ban lifts in/i)).toBeInTheDocument();
  });
});
```

`past-life-card.test.tsx` (pass `now`; assert no `<details>` and detail visible):

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { PastLifeCard } from "./past-life-card";

const now = new Date("2026-07-14T12:00:00Z");
const life: any = { lifeId: 1, serverId: 1, map: "sakhal", slug: "sakh", lifeNumber: 6, startedAt: "2026-07-12T00:00:00Z", endedAt: "2026-07-12T04:00:00Z", timeAliveSeconds: 14400, kills: 5, longestKillMeters: 340, character: null, death: { cause: "pvp", byGamertag: "BanditKing", weapon: "SVD", distanceMeters: 340 }, vitals: { energy: 3200, water: 2800, bleedSources: 2 }, sessions: 3, killList: [{ victimGamertag: "freshmeat", weapon: "Mosin", distanceMeters: 210, occurredAt: "2026-07-12T01:00:00Z" }] };

describe("PastLifeCard", () => {
  it("renders full detail with no <details>", () => {
    const { container } = render(<PastLifeCard life={life} now={now} />);
    expect(container.querySelector("details")).toBeNull();
    expect(screen.getByText("Sakhal")).toBeInTheDocument();
    expect(screen.getByText(/killed by/i)).toHaveTextContent("BanditKing");
    expect(screen.getByText("freshmeat")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests** → FAIL (current cards use `<details>` and StandingCard's old prop shape). `pnpm --filter @onelife/web test player/standing-card player/past-life-card`

- [ ] **Step 3: Rewrite** `standing-card.tsx`:

```tsx
import type { ServerStanding } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PlayerAvatar } from "./player-avatar";
import { KillList } from "./kill-list";
import { SelfUnbanButton } from "./self-unban-button";
import { formatDuration, banCountdown, mapLabel } from "./format";

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex-1 rounded-lg bg-black/20 py-3 text-center">
      <span className="block font-mono text-lg text-bone">{value}</span>
      <span className="mt-1 block text-[9px] uppercase tracking-wide text-muted">{label}</span>
    </div>
  );
}

export function StandingCard({ standing, now, pageGamertag }: { standing: ServerStanding; now: Date; pageGamertag: string }) {
  const tone =
    standing.state === "alive" ? "border-emerald-500/40 bg-emerald-500/[0.06]"
    : standing.state === "banned" ? "border-red-500/40 bg-red-500/[0.06]"
    : "border-line";
  const pill =
    standing.state === "alive" ? "bg-emerald-500/15 text-emerald-300"
    : standing.state === "banned" ? "bg-red-500/15 text-red-300"
    : "bg-white/10 text-muted";
  const sub =
    standing.state === "alive" && standing.alive ? `Alive ${formatDuration(standing.alive.timeAliveSeconds)}`
    : standing.state === "banned" ? "Died — awaiting respawn"
    : "No open life";
  return (
    <div className={cn("rounded-xl border p-5", tone)}>
      <div className="flex items-center gap-3">
        <PlayerAvatar character={standing.character} size={48} dim={standing.state !== "alive"} />
        <div className="flex-1">
          <p className="font-hand text-lg text-bone">{mapLabel(standing.map)}</p>
          <p className="text-xs text-muted">{sub}</p>
        </div>
        <span className={cn("rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wide", pill)}>
          {standing.state === "alive" ? "● Alive" : standing.state === "banned" ? "⛔ Banned" : "Idle"}
        </span>
      </div>

      {standing.state === "alive" && standing.alive && (
        <>
          <div className="mt-4 flex gap-2">
            <Stat value={String(standing.alive.kills)} label="Kills" />
            <Stat value={standing.alive.longestKillMeters == null ? "—" : `${Math.round(standing.alive.longestKillMeters)}m`} label="Longest kill" />
            <Stat value={formatDuration(standing.alive.timeAliveSeconds)} label="Time alive" />
          </div>
          <KillList kills={standing.alive.killList} limit={10} />
        </>
      )}

      {standing.state === "banned" && standing.ban && (
        <div className="mt-4 text-center">
          {banCountdown(standing.ban.expiresAt, now) && (
            <p className="font-display text-2xl text-red-300">
              {banCountdown(standing.ban.expiresAt, now)}
              <span className="mt-1 block text-[9px] uppercase tracking-wide text-muted">ban lifts in</span>
            </p>
          )}
          <SelfUnbanButton banId={standing.ban.banId} pageGamertag={pageGamertag} liftPending={standing.ban.liftPending} />
        </div>
      )}
    </div>
  );
}
```

Rewrite `past-life-card.tsx`:

```tsx
import type { PastLife } from "@/lib/types";
import { PlayerAvatar } from "./player-avatar";
import { KillList } from "./kill-list";
import { GamertagLink } from "@/components/gamertag-link";
import { formatDuration, mapLabel, relativeDate } from "./format";

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex-1 rounded-lg bg-black/20 py-3 text-center">
      <span className="block font-mono text-lg text-bone">{value}</span>
      <span className="mt-1 block text-[9px] uppercase tracking-wide text-muted">{label}</span>
    </div>
  );
}

export function PastLifeCard({ life, now }: { life: PastLife; now: Date }) {
  return (
    <div className="rounded-xl border border-line/70 bg-white/[0.015] p-5">
      <div className="flex items-center gap-3">
        <PlayerAvatar character={life.character} size={40} dim />
        <div>
          <p className="font-hand text-lg text-bone">{mapLabel(life.map)}</p>
          <p className="text-xs text-muted">{relativeDate(life.endedAt, now)} · lasted {formatDuration(life.timeAliveSeconds)}</p>
        </div>
      </div>

      {life.death?.cause && (
        <p className="mt-4 rounded-lg bg-red-500/[0.05] px-3 py-2 text-xs text-red-300/90">
          ☠ {life.death.cause === "pvp" ? "Killed by " : "Died — "}
          {life.death.byGamertag ? <GamertagLink gamertag={life.death.byGamertag} /> : life.death.cause}
          {life.death.weapon ? ` · ${life.death.weapon}` : ""}
          {life.death.distanceMeters != null ? ` · ${Math.round(life.death.distanceMeters)}m` : ""}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <Stat value={String(life.kills)} label="Kills" />
        <Stat value={life.longestKillMeters == null ? "—" : `${Math.round(life.longestKillMeters)}m`} label="Longest kill" />
        <Stat value={String(life.sessions)} label="Sessions" />
      </div>

      <KillList kills={life.killList} />

      {(life.vitals.energy != null || life.vitals.bleedSources != null) && (
        <p className="mt-3 text-[10px] text-muted">At death: energy {life.vitals.energy ?? "—"} · water {life.vitals.water ?? "—"} · bleeding from {life.vitals.bleedSources ?? 0}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests** → PASS. Then `pnpm --filter @onelife/web typecheck` — note this will FAIL in `player-profile.tsx` because it doesn't yet pass `now` to `PastLifeCard`; that's fixed in Task 6. To keep this task's commit green on its own, **also apply the one-line profile fix now**: in `player-profile.tsx` change `<PastLifeCard key={...} life={l} />` to `<PastLifeCard key={...} life={l} now={now} />`. (Full profile rewrite is Task 6.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/player/standing-card.tsx apps/web/src/components/player/past-life-card.tsx apps/web/src/components/player/standing-card.test.tsx apps/web/src/components/player/past-life-card.test.tsx apps/web/src/components/player/player-profile.tsx
git commit -m "feat(web): always-visible state-colored standing + archive past-life cards"
```

---

## Task 6: Single-column profile + `PlayerPagination`

**Files:**
- Create: `apps/web/src/components/player/player-pagination.tsx`
- Modify: `apps/web/src/components/player/player-profile.tsx`
- Test: `apps/web/src/components/player/player-pagination.test.tsx`

**Interfaces:**
- `PlayerPagination` props: `{ slug: string; page: number; total: number; pageSize: number }`; links `/players/{slug}` (page 1) / `/players/{slug}?page=N`.

- [ ] **Step 1: Write the failing test** `player-pagination.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { PlayerPagination } from "./player-pagination";

describe("PlayerPagination", () => {
  it("returns nothing when there is a single page", () => {
    const { container } = render(<PlayerPagination slug="legend" page={1} total={8} pageSize={10} />);
    expect(container).toBeEmptyDOMElement();
  });
  it("links to page 2 and bare page 1", () => {
    render(<PlayerPagination slug="legend" page={1} total={25} pageSize={10} />);
    expect(screen.getByRole("link", { name: /older/i })).toHaveAttribute("href", "/players/legend?page=2");
    // Newer on page 1 points at bare /players/legend
    expect(screen.getByRole("link", { name: /newer/i })).toHaveAttribute("href", "/players/legend");
    expect(screen.getByText(/page 1 of 3/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test** → FAIL. `pnpm --filter @onelife/web test player-pagination`

- [ ] **Step 3: Implement** `player-pagination.tsx`:

```tsx
import Link from "next/link";
import { cn } from "@/lib/utils";

const href = (slug: string, page: number) => (page <= 1 ? `/players/${slug}` : `/players/${slug}?page=${page}`);

export function PlayerPagination({ slug, page, total, pageSize }: { slug: string; page: number; total: number; pageSize: number }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;
  const base = "rounded-lg border border-line bg-panel px-4 py-2 text-muted hover:text-bone";
  const off = "pointer-events-none opacity-30";
  return (
    <nav aria-label="Past lives pagination" className="flex items-center justify-center gap-4 pt-2 text-sm">
      <Link href={href(slug, page - 1)} aria-disabled={page <= 1} className={cn(base, page <= 1 && off)}>‹ Newer</Link>
      <span className="text-muted">Page {page} of {totalPages}</span>
      <Link href={href(slug, page + 1)} aria-disabled={page >= totalPages} className={cn(base, page >= totalPages && off)}>Older ›</Link>
    </nav>
  );
}
```

- [ ] **Step 4: Rewrite** `player-profile.tsx` (single column, section dividers, paginated past lives):

```tsx
import type { PlayerPage } from "@/lib/types";
import { absoluteUrl, profileLd } from "@/lib/seo";
import { playerSlug } from "@/lib/slug";
import { PlayerHero } from "./player-hero";
import { StandingCard } from "./standing-card";
import { PastLifeCard } from "./past-life-card";
import { PlayerPagination } from "./player-pagination";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-3 text-xs font-bold uppercase tracking-widest text-muted">
      <span>{children}</span>
      <span className="h-px flex-1 bg-line" />
    </h2>
  );
}

export function PlayerProfile({ page, now }: { page: PlayerPage; now: Date }) {
  const slug = playerSlug(page.gamertag);
  const aliveOrBanned = page.standing.filter((s) => s.state !== "idle");
  const ld = profileLd(page, absoluteUrl(`/players/${slug}`));
  return (
    <main className="mx-auto max-w-xl space-y-10 p-4 py-8 sm:p-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <PlayerHero page={page} />

      {aliveOrBanned.length > 0 && (
        <section className="space-y-4">
          <SectionHeading>Current standing</SectionHeading>
          {aliveOrBanned.map((s) => <StandingCard key={s.serverId} standing={s} now={now} pageGamertag={page.gamertag} />)}
        </section>
      )}

      {page.pastLivesTotal > 0 && (
        <section className="space-y-4">
          <SectionHeading>Past lives · {page.pastLivesTotal}</SectionHeading>
          {page.pastLives.map((l) => <PastLifeCard key={`${l.serverId}:${l.lifeId}`} life={l} now={now} />)}
          <PlayerPagination slug={slug} page={page.pastLivesPage} total={page.pastLivesTotal} pageSize={page.pastLivesPageSize} />
        </section>
      )}
    </main>
  );
}
```

- [ ] **Step 5: Verify** — `pnpm --filter @onelife/web test player-pagination` PASS; `pnpm --filter @onelife/web typecheck` PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/player/player-pagination.tsx apps/web/src/components/player/player-pagination.test.tsx apps/web/src/components/player/player-profile.tsx
git commit -m "feat(web): single-column player profile with paginated past lives"
```

---

## Task 7: Page route reads `?page=` + per-page canonical

**Files:**
- Modify: `apps/web/src/app/players/[slug]/page.tsx`

**Interfaces:** Consumes `getPlayerPage(slug, page)`. Untested (server component) — verified by typecheck + build.

- [ ] **Step 1: Rewrite** `page.tsx`:

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPlayerPage } from "@/lib/api";
import { absoluteUrl } from "@/lib/seo";
import { playerSlug } from "@/lib/slug";
import { PlayerProfile } from "@/components/player/player-profile";
import { formatDuration } from "@/components/player/format";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ page?: string }> };

function parsePage(raw?: string): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : 1;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params;
  const pageNum = parsePage((await searchParams).page);
  const page = await getPlayerPage(slug, pageNum).catch(() => null);
  if (!page) return { title: "Survivor not found — One Life" };
  const desc = `${page.totals.kills} kills · ${page.totals.lives} lives · longest life ${formatDuration(page.totals.longestLifeSeconds)}.`;
  const canonicalBase = absoluteUrl(`/players/${playerSlug(page.gamertag)}`);
  const url = page.pastLivesPage > 1 ? `${canonicalBase}?page=${page.pastLivesPage}` : canonicalBase;
  return {
    title: `${page.gamertag} — One Life DayZ survivor`,
    description: desc,
    alternates: { canonical: url },
    openGraph: { title: page.gamertag, description: desc, url, type: "profile" },
    twitter: { card: "summary_large_image", title: page.gamertag, description: desc },
  };
}

export default async function PlayerPageRoute({ params, searchParams }: Props) {
  const { slug } = await params;
  const pageNum = parsePage((await searchParams).page);
  const page = await getPlayerPage(slug, pageNum);
  if (!page) notFound();
  return <PlayerProfile page={page} now={new Date()} />;
}
```

(Note: `rel=prev/next` is intentionally omitted — search engines deprecated it and the App Router Metadata API has no first-class `<link rel="prev/next">`; the per-page `canonical` is the SEO signal we set.)

- [ ] **Step 2: Verify** — `pnpm --filter @onelife/web typecheck` PASS; `pnpm --filter @onelife/web build` PASS (route `/players/[slug]` builds). Manual: with API+web+seeded DB, `/players/<gamertag>?page=2` shows page 2 of past lives; hero + standing still render.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/players/[slug]/page.tsx"
git commit -m "feat(web): player page reads ?page= with per-page canonical"
```

---

## Task 8: OpenGraph card — survivor-dossier redesign

**Files:**
- Create asset: `apps/web/src/app/players/[slug]/skull.png` (cropped from the logo)
- Create asset: `apps/web/src/app/players/[slug]/logo.png` (copy of `one-life-horizontal.png`)
- Create assets: `apps/web/src/app/players/[slug]/oswald-700.ttf`, `space-mono-400.ttf`, `space-mono-700.ttf`
- Modify: `apps/web/src/app/players/[slug]/opengraph-image.tsx`

**Interfaces:** Consumes `getPlayerPage`, `heroStats`, `monthYear`. Untested (image route) — verified by build **and a manual visual render**.

**Reference design (validated in-browser during design):** dark radial bg `radial-gradient(130% 110% at 80% 15%, #14170f 0%, #0a0c0a 46%, #060706 100%)`; bone ink `#e7e3d7`/`#f3efe4`; amber `#e0a13a`; muted `#7a7568`. Logo top-left (h=46), callsign (Oswald 700, ~124px, size-down for long names), "Surviving since {MON YYYY}" (Space Mono), stat readout (same rule as hero — Longest life amber). Real logo skull faint (7%) bleeding off the right. Amber accent bar top-left. (Omit the tactical-grid overlay — satori doesn't tile background images.)

- [ ] **Step 1: Generate the skull asset + copy the logo**

```bash
# from repo root; [slug] must be quoted for the shell
python3 -m pip install --quiet Pillow 2>/dev/null || true
python3 - apps/web/public/one-life-horizontal.png "apps/web/src/app/players/[slug]/skull.png" <<'PY'
import sys
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGBA"); W,H = im.size; a = im.split()[3]; px = a.load()
cols = [sum(1 for y in range(0,H,3) if px[x,y] > 20) for x in range(W)]
started=False; gap=None
for x in range(W):
    if cols[x] > 0: started=True
    elif started and cols[x] == 0:
        run=0; xx=x
        while xx < W and cols[xx] == 0: run+=1; xx+=1
        if run > W*0.015: gap=x; break
skull = im.crop((0,0,gap,H)); skull = skull.crop(skull.getbbox()); skull.save(out)
print("skull saved", skull.size)
PY
cp apps/web/public/one-life-horizontal.png "apps/web/src/app/players/[slug]/logo.png"
```

- [ ] **Step 2: Fetch the fonts** (static TTFs from the fontsource jsDelivr CDN)

```bash
D="apps/web/src/app/players/[slug]"
curl -sfL -o "$D/oswald-700.ttf"     "https://cdn.jsdelivr.net/fontsource/fonts/oswald@latest/latin-700-normal.ttf"
curl -sfL -o "$D/space-mono-400.ttf" "https://cdn.jsdelivr.net/fontsource/fonts/space-mono@latest/latin-400-normal.ttf"
curl -sfL -o "$D/space-mono-700.ttf" "https://cdn.jsdelivr.net/fontsource/fonts/space-mono@latest/latin-700-normal.ttf"
# sanity: each file should be tens–hundreds of KB, not an HTML error page
ls -l "$D"/*.ttf
```

If a URL 404s, substitute the equivalent static TTF for the same family/weight from another source; the visual check in Step 4 confirms the fonts actually rendered.

- [ ] **Step 3: Rewrite** `opengraph-image.tsx`:

```tsx
import { ImageResponse } from "next/og";
import { getPlayerPage } from "@/lib/api";
import { heroStats, monthYear } from "@/components/player/format";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "One Life survivor profile";

const asset = (name: string) => fetch(new URL(`./${name}`, import.meta.url)).then((r) => r.arrayBuffer());
const dataUri = (buf: ArrayBuffer) => `data:image/png;base64,${Buffer.from(buf).toString("base64")}`;

export default async function OgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [page, oswald, mono, monoBold, logoBuf, skullBuf] = await Promise.all([
    getPlayerPage(slug).catch(() => null),
    asset("oswald-700.ttf"), asset("space-mono-400.ttf"), asset("space-mono-700.ttf"),
    asset("logo.png"), asset("skull.png"),
  ]);
  const gamertag = page?.gamertag ?? "Unknown survivor";
  const stats = page ? heroStats(page.totals) : [];
  const since = page?.firstSeenAt ? monthYear(page.firstSeenAt) : null;
  const gtSize = gamertag.length > 12 ? 84 : gamertag.length > 9 ? 104 : 124;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "66px 74px", background: "radial-gradient(130% 110% at 80% 15%, #14170f 0%, #0a0c0a 46%, #060706 100%)", color: "#e7e3d7", fontFamily: "Oswald", position: "relative" }}>
        <div style={{ position: "absolute", top: 0, left: 0, width: "34%", height: 5, background: "#e0a13a" }} />
        <img src={dataUri(skullBuf)} width={470} height={582} style={{ position: "absolute", right: -70, top: 24, opacity: 0.07 }} />
        <img src={dataUri(logoBuf)} height={46} />
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: gtSize, fontWeight: 700, lineHeight: 1, letterSpacing: -1, color: "#f3efe4" }}>{gamertag}</div>
          {since && (
            <div style={{ display: "flex", fontFamily: "Space Mono", fontSize: 22, color: "#8b8578", marginTop: 26 }}>
              Surviving since&nbsp;<span style={{ fontWeight: 700, color: "#c3bdae", textTransform: "uppercase" }}>{since}</span>
            </div>
          )}
        </div>
        <div style={{ display: "flex", borderTop: "1.5px solid rgba(231,227,215,.16)", paddingTop: 26 }}>
          {stats.map((st, i) => (
            <div key={st.label} style={{ flex: 1, display: "flex", flexDirection: "column", borderLeft: i > 0 ? "1px solid rgba(231,227,215,.1)" : "none", paddingLeft: i > 0 ? 24 : 0 }}>
              <span style={{ fontSize: 60, fontWeight: 700, lineHeight: 1, color: st.hot ? "#e0a13a" : "#efeadd" }}>{st.value}</span>
              <span style={{ fontFamily: "Space Mono", fontSize: 16, letterSpacing: 2, textTransform: "uppercase", color: "#7a7568", marginTop: 9 }}>{st.label}</span>
            </div>
          ))}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Oswald", data: oswald, weight: 700, style: "normal" },
        { name: "Space Mono", data: mono, weight: 400, style: "normal" },
        { name: "Space Mono", data: monoBold, weight: 700, style: "normal" },
      ],
    },
  );
}
```

- [ ] **Step 4: Verify** — `pnpm --filter @onelife/web typecheck` PASS; `pnpm --filter @onelife/web build` PASS (the `/players/[slug]/opengraph-image` route builds). **Manual visual check (required):** run the web app and open `/players/<a-known-gamertag>/opengraph-image`; confirm the logo renders, the skull motif is the logo's skull (faint, right), Oswald + Space Mono fonts applied, Longest life is amber, and Kills is absent for a 0-kills player. If a font didn't load (text falls back to a default sans), fix the font file/URL before continuing.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/players/[slug]/opengraph-image.tsx" "apps/web/src/app/players/[slug]/skull.png" "apps/web/src/app/players/[slug]/logo.png" "apps/web/src/app/players/[slug]/oswald-700.ttf" "apps/web/src/app/players/[slug]/space-mono-400.ttf" "apps/web/src/app/players/[slug]/space-mono-700.ttf"
git commit -m "feat(web): survivor-dossier OpenGraph card"
```

---

## Task 9: Docs (CHANGELOG + CLAUDE.md) + full suite

**Files:** Modify `CHANGELOG.md`, `CLAUDE.md`.

- [ ] **Step 1: CHANGELOG** — under `## [Unreleased]` → `### Changed`:

```markdown
- **Player page redesign.** Rebuilt `/players/{slug}` as a single roomy column with everything visible (no expand/collapse): an avatar-free hero with a full-width stat band (Kills shown only when > 0, Longest life always the highlighted stat), state-colored current-standing cards (green alive / red banned), and muted archive cards for past lives — now **paginated** (`?page=`, 10/page, server-side, enriching only the visible slice). The OpenGraph share image is redesigned as a survivor dossier (logo + logo-skull motif, callsign, "surviving since," all-time stats, on Oswald/Space Mono).
```

- [ ] **Step 2: CLAUDE.md** — update the existing **Player pages** bullet to note the redesign: avatar-free hero + stat band with the Kills-if-any / Longest-life-highlighted rule; no `<details>` (single column, always visible); state-colored standing vs muted past lives; **`getPlayerPage` paginates past lives (`?page=`, `PLAYER_PAST_LIVES_PAGE_SIZE = 10`, enriches only the slice) and no longer returns `heroCharacter`**; survivor-dossier OG image (`opengraph-image.tsx` with co-located logo/skull/font assets). Keep it at the density of the neighboring bullets.

- [ ] **Step 3: Full suite + typecheck**

Run: `pnpm turbo run typecheck && TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm turbo run test --concurrency=1`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md CLAUDE.md
git commit -m "docs: player page redesign in CHANGELOG + CLAUDE.md"
```

- [ ] **Step 5:** Hand off to `finishing-a-feature` (opens the PR into `develop`).

---

## Self-Review

**Spec coverage:**
- §1 avatar-free hero + stat band + Kills-if-any/Longest-life-hot rule → Tasks 3 (helper), 4 (hero). ✅
- §2 state-colored, always-visible standing (no `<details>`) → Task 5. ✅
- §3 muted past-life cards, no `<details>`, 3-stat row, relative date, **pagination 10/page server-side** → Tasks 1 (read-model), 5 (card), 6 (pagination + profile), 7 (route). ✅
- §4 single column + spacing/section dividers → Task 6. ✅
- §5 OG dossier redesign (real logo + logo-skull only, callsign, since, stat rule, Oswald/Space Mono) → Task 8. ✅
- Backend: paginate + drop `heroCharacter` → Tasks 1, 2, 4. ✅
- SEO per-page canonical (rel prev/next consciously omitted) → Task 7. ✅
- Testing convention (read-model integration, pure/presentational units, server/OG untested + OG visual check) → all tasks + Task 8 Step 4. ✅
- CHANGELOG + CLAUDE.md last → Task 9. ✅

**Placeholder scan:** none — every step has real code/commands.

**Type consistency:** `heroStats`/`HeroStat` (Task 3) consumed by hero (Task 4) + OG (Task 8); `getPlayerPage` `{page}` opts (Task 1) consumed by API (Task 2) + web client (Task 4) + route (Task 7); `pastLivesTotal/Page/PageSize` (Task 1) mirrored in web type (Task 4) and consumed by profile/pagination (Task 6); `PlayerPagination` props consistent between test and impl (Task 6); `StandingCard` single `pageGamertag: string` and `PastLifeCard` `now` prop (Task 5) matched by the profile call site (Tasks 5 step 4 / 6). `heroCharacter` removed everywhere in one coherent set (Tasks 1, 4).
