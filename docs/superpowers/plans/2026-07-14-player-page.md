# Player Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public, SEO-optimized player profile page at `/players/[slug]` that shows a survivor's cross-server totals, current standing per server (alive / banned / idle), and an expandable history of every past life, with an owner-only spend-token self-unban action.

**Architecture:** A new `getPlayerPage` read-model assembles the whole page payload in one call (reusing existing per-server helpers); the existing `GET /players/:gamertag` route is extended to return it. The Next.js page is server-rendered from that single fetch; past-life and alive-card expansion use native `<details>` so all content is in the crawlable HTML. Owner actions (`SelfUnbanButton`) are an isolated client component that never affects the public render. Verified users are routed here after login and from the masthead.

**Tech Stack:** TypeScript/ESM, pnpm + turbo monorepo, Postgres + Drizzle, Fastify (API), Next.js App Router + Tailwind (web), Vitest + `@onelife/test-support` (tests).

## Global Constraints

- **Module system:** ESM. Intra-package relative imports use the `.js` extension (e.g. `./player-kills.js`).
- **Tests:** `pnpm turbo run test --concurrency=1`. DB suites need `TEST_DATABASE_URL`. Typecheck: `pnpm turbo run typecheck`. Run a single package's tests with `pnpm --filter <pkg> test`.
- **Testing convention (repo rule):** read-models get Postgres integration tests; pure functions + presentational components get unit tests; **thin hook wrappers, server components, OG image routes, and the resolver route are NOT unit-tested.**
- **Slug parity:** `slugNorm` in `packages/read-models/src/player-aggregate.ts` and `playerSlug` in `apps/web/src/lib/slug.ts` are hand-duplicated and MUST stay identical.
- **Tailwind tokens in use:** `border-line`, `bg-panel`, `bg-panel-2`, `text-amber`, `text-bone`, `text-muted`, `font-hand`, `font-display`, `font-mono`; `cn()` from `@/lib/utils`.
- **Dates over the wire:** the API serializes `Date` → ISO string; web-side types use `string` for date fields and parse where needed.
- **Stats scope:** kills, longest kill, time alive, death details, at-death vitals, kill list, character avatar (no persona name). **Distance traveled and hits are OUT of scope.**
- **Workflow:** feature work must be on a **fork**, on a `feature/*` branch, PR → `develop`. CHANGELOG.md + CLAUDE.md are the last edits before the PR. (The canonical repo blocks feature commits; branch on the fork first via the `starting-work` skill.)
- **Spec:** `docs/superpowers/specs/2026-07-14-player-page-design.md`.

---

## Phase 1 — Backend: read-models & API

### Task 1: `getLifeKills` read-model helper

Per-life kill list, matched by gamertag + server + time window (kills have no `killerLifeId`).

**Files:**
- Create: `packages/read-models/src/player-kills.ts`
- Test: `packages/read-models/test/player-kills.test.ts`
- Modify: `packages/read-models/src/index.ts` (export)

**Interfaces:**
- Produces: `PlayerKill = { victimGamertag: string; weapon: string | null; distanceMeters: number | null; occurredAt: Date }` and `getLifeKills(db, serverId: number, killerGamertag: string, startedAt: Date, endedAt: Date | null): Promise<PlayerKill[]>` (newest first).

- [ ] **Step 1: Write the failing test**

```ts
// packages/read-models/test/player-kills.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, kills } from "@onelife/db";
import { eq } from "drizzle-orm";
import { getLifeKills } from "../src/player-kills.js";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 46e7;
let serverId: number;
const start = new Date("2026-07-14T10:00:00Z");
const end = new Date("2026-07-14T14:00:00Z");

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "rm-kills" }).returning();
  serverId = s!.id;
  await db.insert(players).values({ gamertag: "Sniper", firstSeenAt: start, lastSeenAt: end });
  await db.insert(kills).values([
    { serverId, killerGamertag: "Sniper", victimGamertag: "early", weapon: "Mosin", distance: 50, occurredAt: new Date("2026-07-14T09:00:00Z") }, // before window
    { serverId, killerGamertag: "Sniper", victimGamertag: "a", weapon: "SVD", distance: 312, occurredAt: new Date("2026-07-14T11:00:00Z") },
    { serverId, killerGamertag: "Sniper", victimGamertag: "b", weapon: "M4A1", distance: 45, occurredAt: new Date("2026-07-14T13:00:00Z") },
    { serverId, killerGamertag: "Other", victimGamertag: "c", weapon: "KA-M", distance: 10, occurredAt: new Date("2026-07-14T12:00:00Z") }, // other killer
  ]);
});
afterAll(async () => {
  await db.delete(kills).where(eq(kills.serverId, serverId));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

describe("getLifeKills", () => {
  it("returns this-life kills in the window, newest first", async () => {
    const rows = await getLifeKills(db, serverId, "Sniper", start, end);
    expect(rows.map((r) => r.victimGamertag)).toEqual(["b", "a"]);
    expect(rows[0]).toMatchObject({ weapon: "M4A1", distanceMeters: 45 });
  });
  it("treats a null endedAt as open-ended", async () => {
    const rows = await getLifeKills(db, serverId, "Sniper", start, null);
    expect(rows.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @onelife/read-models test player-kills`
Expected: FAIL — `getLifeKills` not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/read-models/src/player-kills.ts
import type { Database } from "@onelife/db";
import { kills } from "@onelife/db";
import { and, eq, gte, lte, desc } from "drizzle-orm";

export interface PlayerKill {
  victimGamertag: string;
  weapon: string | null;
  distanceMeters: number | null;
  occurredAt: Date;
}

/** Kills scored by `killerGamertag` on `serverId` within [startedAt, endedAt] (endedAt null = open). Newest first. */
export async function getLifeKills(
  db: Database,
  serverId: number,
  killerGamertag: string,
  startedAt: Date,
  endedAt: Date | null,
): Promise<PlayerKill[]> {
  const rows = await db
    .select({
      victimGamertag: kills.victimGamertag,
      weapon: kills.weapon,
      distance: kills.distance,
      occurredAt: kills.occurredAt,
    })
    .from(kills)
    .where(
      and(
        eq(kills.serverId, serverId),
        eq(kills.killerGamertag, killerGamertag),
        gte(kills.occurredAt, startedAt),
        endedAt ? lte(kills.occurredAt, endedAt) : undefined,
      ),
    )
    .orderBy(desc(kills.occurredAt));
  return rows.map((r) => ({
    victimGamertag: r.victimGamertag,
    weapon: r.weapon,
    distanceMeters: r.distance,
    occurredAt: r.occurredAt,
  }));
}
```

Add to `packages/read-models/src/index.ts`:

```ts
export * from "./player-kills.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @onelife/read-models test player-kills`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/read-models/src/player-kills.ts packages/read-models/test/player-kills.test.ts packages/read-models/src/index.ts
git commit -m "feat(read-models): add getLifeKills per-life kill list"
```

---

### Task 2: `getPlayerPage` read-model

Assembles the full page payload: identity, totals, per-server standing, past lives.

**Files:**
- Create: `packages/read-models/src/player-page.ts`
- Test: `packages/read-models/test/player-page.test.ts`
- Modify: `packages/read-models/src/index.ts` (export)

**Interfaces:**
- Consumes: `getPlayerProfile`, `getPlayerLives` (`./queries.js`); `getLifeCharacter` (`./character.js`); `getLifeKills`, `PlayerKill` (`./player-kills.js`); `resolveGamertagBySlug` (`./player-aggregate.js`); `rosterByClass` (`@onelife/domain`).
- Produces the types below and `getPlayerPage(db, gamertag: string, now: Date): Promise<PlayerPage | null>`.

```ts
export interface PlayerCharacter { name: string | null; head: string | null; gender: string | null; }
export interface AliveStanding { lifeId: number; startedAt: Date; timeAliveSeconds: number; kills: number; longestKillMeters: number | null; killList: PlayerKill[]; }
export interface BanStanding { banId: number; bannedAt: Date; expiresAt: Date | null; liftPending: boolean; triggeringLifeNumber: number | null; }
export interface ServerStanding { serverId: number; map: string; slug: string; state: "alive" | "banned" | "idle"; character: PlayerCharacter | null; alive: AliveStanding | null; ban: BanStanding | null; }
export interface PastLife { lifeId: number; serverId: number; map: string; slug: string; lifeNumber: number; startedAt: Date; endedAt: Date; timeAliveSeconds: number; kills: number; longestKillMeters: number | null; character: PlayerCharacter | null; death: { cause: string | null; byGamertag: string | null; weapon: string | null; distanceMeters: number | null }; vitals: { energy: number | null; water: number | null; bleedSources: number | null }; sessions: number; killList: PlayerKill[]; }
export interface PlayerPage { gamertag: string; verified: boolean; firstSeenAt: Date | null; aliveAnywhere: boolean; heroCharacter: PlayerCharacter | null; totals: { kills: number; lives: number; deaths: number; longestLifeSeconds: number }; standing: ServerStanding[]; pastLives: PastLife[]; }
```

**Behavior decisions (from spec, refined):**
- A **standing card** is emitted for each active, slugged server where the player has ≥1 qualified life **or** an active ban (avoids empty cards for never-played servers — this refines the spec's looser "all active servers" wording).
- Standing state precedence: **alive** (open qualified life) → **banned** (a `bans` row with `status IN ('applied','pending','lift_pending')`) → **idle**.
- `pastLives` = qualified, ended lives across all servers, newest death (`endedAt`) first.
- `heroCharacter` = character of the life with the max `startedAt` overall.
- Returns `null` when the resolved gamertag has no qualified life anywhere.

- [ ] **Step 1: Write the failing test**

```ts
// packages/read-models/test/player-page.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, sessions, kills, bans, gamertagLinks, user } from "@onelife/db";
import { eq, inArray } from "drizzle-orm";
import { getPlayerPage } from "../src/player-page.js";

const { db, sql } = getTestDb();
const now = new Date("2026-07-14T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);
const svcA = Math.floor(Math.random() * 1e8) + 47e7;
const svcB = Math.floor(Math.random() * 1e8) + 48e7;
const uid = `pp-${svcA}`;
let chern: number; let sakh: number;

beforeAll(async () => {
  const [a] = await db.insert(servers).values({ nitradoServiceId: svcA, name: "pp-chern", map: "chernarusplus", slug: `chern-${svcA}`, active: true }).returning();
  const [b] = await db.insert(servers).values({ nitradoServiceId: svcB, name: "pp-sakh", map: "sakhal", slug: `sakh-${svcB}`, active: true }).returning();
  chern = a!.id; sakh = b!.id;
  const [p] = await db.insert(players).values({ gamertag: "Legend", firstSeenAt: hoursAgo(100), lastSeenAt: now }).returning();
  // Alive qualified life on Chernarus (open session, 1 kill)
  const [alive] = await db.insert(lives).values({ serverId: chern, playerId: p!.id, lifeNumber: 2, startedAt: hoursAgo(6), endedAt: null, playtimeSeconds: 0 }).returning();
  await db.insert(sessions).values({ serverId: chern, playerId: p!.id, lifeId: alive!.id, connectedAt: hoursAgo(6) });
  await db.insert(kills).values({ serverId: chern, killerGamertag: "Legend", victimGamertag: "BanditKing", weapon: "SVD", distance: 312, occurredAt: hoursAgo(2) });
  // Past qualified (PvP) life on Sakhal that ended + triggered a ban
  const [dead] = await db.insert(lives).values({ serverId: sakh, playerId: p!.id, lifeNumber: 1, startedAt: hoursAgo(30), endedAt: hoursAgo(6), playtimeSeconds: 14520, deathCause: "pvp", deathByGamertag: "NightOwl", deathWeapon: "KA-M", deathDistance: 120, energyAtDeath: 3200, waterAtDeath: 2800, bleedSourcesAtDeath: 2 }).returning();
  await db.insert(sessions).values({ serverId: sakh, playerId: p!.id, lifeId: dead!.id, connectedAt: hoursAgo(30), disconnectedAt: hoursAgo(6), durationSeconds: 14520 });
  await db.insert(bans).values({ serverId: sakh, gamertag: "Legend", lifeStartedAt: hoursAgo(30), reason: "qualified_death", qualifiedBy: "pvp-death", bannedAt: hoursAgo(6), expiresAt: hoursAgo(-18), status: "applied", dryRun: false });
  await db.insert(user).values({ id: uid, name: "x", email: `${uid}@example.com` });
  await db.insert(gamertagLinks).values({ userId: uid, gamertag: "Legend", status: "verified", verifiedAt: hoursAgo(50) });
});
afterAll(async () => {
  await db.delete(kills).where(inArray(kills.serverId, [chern, sakh]));
  await db.delete(sessions).where(inArray(sessions.serverId, [chern, sakh]));
  await db.delete(bans).where(inArray(bans.serverId, [chern, sakh]));
  await db.delete(lives).where(inArray(lives.serverId, [chern, sakh]));
  await db.delete(gamertagLinks).where(eq(gamertagLinks.userId, uid));
  await db.delete(user).where(eq(user.id, uid));
  await db.delete(players).where(eq(players.gamertag, "Legend"));
  await db.delete(servers).where(inArray(servers.id, [chern, sakh]));
  await sql.end();
});

describe("getPlayerPage", () => {
  it("returns null for an unknown gamertag", async () => {
    expect(await getPlayerPage(db, "nobody-xyz", now)).toBeNull();
  });
  it("marks verified and totals", async () => {
    const pg = (await getPlayerPage(db, "legend", now))!; // slug-normalized lookup
    expect(pg.gamertag).toBe("Legend");
    expect(pg.verified).toBe(true);
    expect(pg.aliveAnywhere).toBe(true);
    expect(pg.totals.lives).toBe(2);
    expect(pg.totals.deaths).toBe(1);
    expect(pg.totals.kills).toBe(1);
  });
  it("has an alive standing on Chernarus with the kill list", async () => {
    const pg = (await getPlayerPage(db, "Legend", now))!;
    const alive = pg.standing.find((s) => s.state === "alive")!;
    expect(alive.map).toBe("chernarusplus");
    expect(alive.alive!.kills).toBe(1);
    expect(alive.alive!.longestKillMeters).toBe(312);
    expect(alive.alive!.killList[0].victimGamertag).toBe("BanditKing");
  });
  it("has a banned standing on Sakhal with a lift time", async () => {
    const pg = (await getPlayerPage(db, "Legend", now))!;
    const banned = pg.standing.find((s) => s.state === "banned")!;
    expect(banned.ban!.expiresAt).not.toBeNull();
    expect(banned.ban!.liftPending).toBe(false);
    expect(banned.ban!.triggeringLifeNumber).toBe(1);
  });
  it("lists the past (ended) life with death + vitals", async () => {
    const pg = (await getPlayerPage(db, "Legend", now))!;
    expect(pg.pastLives.length).toBe(1);
    const life = pg.pastLives[0];
    expect(life.death).toMatchObject({ cause: "pvp", byGamertag: "NightOwl", weapon: "KA-M" });
    expect(life.vitals).toMatchObject({ energy: 3200, bleedSources: 2 });
    expect(life.sessions).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @onelife/read-models test player-page`
Expected: FAIL — `getPlayerPage` not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/read-models/src/player-page.ts
import type { Database } from "@onelife/db";
import { servers, players, lives, sessions, bans, gamertagLinks, kills } from "@onelife/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getPlayerProfile, getPlayerLives } from "./queries.js";
import { getLifeCharacter } from "./character.js";
import { getLifeKills, type PlayerKill } from "./player-kills.js";
import { resolveGamertagBySlug } from "./player-aggregate.js";
import { rosterByClass } from "@onelife/domain";

export interface PlayerCharacter { name: string | null; head: string | null; gender: string | null; }
export interface AliveStanding { lifeId: number; startedAt: Date; timeAliveSeconds: number; kills: number; longestKillMeters: number | null; killList: PlayerKill[]; }
export interface BanStanding { banId: number; bannedAt: Date; expiresAt: Date | null; liftPending: boolean; triggeringLifeNumber: number | null; }
export interface ServerStanding { serverId: number; map: string; slug: string; state: "alive" | "banned" | "idle"; character: PlayerCharacter | null; alive: AliveStanding | null; ban: BanStanding | null; }
export interface PastLife { lifeId: number; serverId: number; map: string; slug: string; lifeNumber: number; startedAt: Date; endedAt: Date; timeAliveSeconds: number; kills: number; longestKillMeters: number | null; character: PlayerCharacter | null; death: { cause: string | null; byGamertag: string | null; weapon: string | null; distanceMeters: number | null }; vitals: { energy: number | null; water: number | null; bleedSources: number | null }; sessions: number; killList: PlayerKill[]; }
export interface PlayerPage { gamertag: string; verified: boolean; firstSeenAt: Date | null; aliveAnywhere: boolean; heroCharacter: PlayerCharacter | null; totals: { kills: number; lives: number; deaths: number; longestLifeSeconds: number }; standing: ServerStanding[]; pastLives: PastLife[]; }

const ACTIVE_BAN_STATUSES = ["applied", "pending", "lift_pending"];

function longest(killList: PlayerKill[]): number | null {
  return killList.reduce<number | null>((m, k) => (k.distanceMeters == null ? m : m === null ? k.distanceMeters : Math.max(m, k.distanceMeters)), null);
}

async function charShape(db: Database, serverId: number, gamertag: string, startedAt: Date, endedAt: Date | null): Promise<PlayerCharacter | null> {
  const lc = await getLifeCharacter(db, serverId, gamertag, startedAt, endedAt);
  const rc = lc?.characterClass ? rosterByClass(lc.characterClass) : null;
  return rc ? { name: rc.name, head: rc.head, gender: rc.gender } : null;
}

export async function getPlayerPage(db: Database, gamertag: string, now: Date): Promise<PlayerPage | null> {
  const real = await resolveGamertagBySlug(db, gamertag);
  if (!real) return null;
  gamertag = real;

  const [p] = await db.select().from(players).where(eq(players.gamertag, gamertag));
  const activeServers = await db.select().from(servers).where(eq(servers.active, true));
  const activeBans = await db.select().from(bans).where(and(eq(bans.gamertag, gamertag), inArray(bans.status, ACTIVE_BAN_STATUSES)));
  const [vf] = await db.select({ id: gamertagLinks.id }).from(gamertagLinks).where(and(eq(gamertagLinks.gamertag, gamertag), eq(gamertagLinks.status, "verified"))).limit(1);

  const standing: ServerStanding[] = [];
  const pastLives: PastLife[] = [];
  const totals = { kills: 0, lives: 0, deaths: 0, longestLifeSeconds: 0 };
  let heroChar: PlayerCharacter | null = null;
  let heroAt = 0;

  for (const s of activeServers) {
    if (!s.slug) continue;
    const livesRows = (await getPlayerLives(db, s.id, gamertag)) ?? [];
    const serverBan = activeBans.find((b) => b.serverId === s.id) ?? null;
    if (livesRows.length === 0 && !serverBan) continue;

    const profile = await getPlayerProfile(db, s.id, gamertag, now);

    // totals
    totals.lives += livesRows.length;
    totals.deaths += livesRows.filter((l) => l.endedAt !== null).length;
    const [{ c: kc }] = await db.select({ c: sql<number>`count(*)::int` }).from(kills).where(and(eq(kills.serverId, s.id), eq(kills.killerGamertag, gamertag)));
    totals.kills += kc ?? 0;
    for (const l of livesRows) {
      const secs = l.endedAt ? l.playtimeSeconds : (profile?.currentLifeSeconds ?? 0);
      if (secs > totals.longestLifeSeconds) totals.longestLifeSeconds = secs;
      if (l.startedAt.getTime() > heroAt) { heroAt = l.startedAt.getTime(); heroChar = await charShape(db, s.id, gamertag, l.startedAt, l.endedAt); }
    }

    // standing
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

    // past lives (ended)
    for (const l of livesRows.filter((r) => r.endedAt !== null)) {
      const killList = await getLifeKills(db, s.id, gamertag, l.startedAt, l.endedAt);
      const [{ c: sc }] = await db.select({ c: sql<number>`count(*)::int` }).from(sessions).where(and(eq(sessions.serverId, s.id), eq(sessions.lifeId, l.id)));
      pastLives.push({ lifeId: l.id, serverId: s.id, map: s.map, slug: s.slug, lifeNumber: l.lifeNumber, startedAt: l.startedAt, endedAt: l.endedAt!, timeAliveSeconds: l.playtimeSeconds, kills: killList.length, longestKillMeters: longest(killList), character: await charShape(db, s.id, gamertag, l.startedAt, l.endedAt), death: { cause: l.deathCause, byGamertag: l.deathByGamertag, weapon: l.deathWeapon, distanceMeters: l.deathDistance }, vitals: { energy: l.energyAtDeath, water: l.waterAtDeath, bleedSources: l.bleedSourcesAtDeath }, sessions: sc ?? 0, killList });
    }
  }

  if (standing.length === 0 && pastLives.length === 0) return null;
  pastLives.sort((a, b) => b.endedAt.getTime() - a.endedAt.getTime());

  return { gamertag, verified: !!vf, firstSeenAt: p?.firstSeenAt ?? null, aliveAnywhere: standing.some((s) => s.state === "alive"), heroCharacter: heroChar, totals, standing, pastLives };
}
```

Add to `packages/read-models/src/index.ts`:

```ts
export * from "./player-page.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @onelife/read-models test player-page`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/read-models/src/player-page.ts packages/read-models/test/player-page.test.ts packages/read-models/src/index.ts
git commit -m "feat(read-models): add getPlayerPage full player-page payload"
```

---

### Task 3: Extend `GET /players/:gamertag` to return `PlayerPage`

**Files:**
- Modify: `apps/api/src/routes/player-aggregate.ts:10-17`
- Test: `apps/api/test/player-aggregate-routes.test.ts` (add cases)

**Interfaces:**
- Consumes: `getPlayerPage` from `@onelife/read-models`.
- Produces: `GET /players/:gamertag` → `PlayerPage` (200) or `{ error: "not_found" }` (404).

- [ ] **Step 1: Write the failing test** (append inside the existing `describe`)

```ts
  it("returns the full player page payload", async () => {
    const res = await app.inject({ method: "GET", url: `/players/Hero` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("standing");
    expect(body).toHaveProperty("pastLives");
    expect(body).toHaveProperty("totals");
    expect(body.gamertag).toBe("Hero");
  });
```

(If the existing suite has no `Hero` fixture, mirror `apps/api/test/players.test.ts`'s `beforeAll` to insert a server + player + one ended qualified life.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @onelife/api test player-aggregate-routes`
Expected: FAIL — response lacks `standing`.

- [ ] **Step 3: Write minimal implementation** — replace the first route in `player-aggregate.ts`:

```ts
import { getPlayerPage, getLifeDetail, getPlayerLives, resolveGamertagBySlug, getLifeCharacter } from "@onelife/read-models";
// ...
  app.get("/players/:gamertag", async (req, reply) => {
    const p = gt.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: "bad_request" });
    const page = await getPlayerPage(db, p.data.gamertag, new Date());
    if (!page) return reply.code(404).send({ error: "not_found" });
    return page;
  });
```

(Remove the now-unused `getPlayerAcrossServers` import if nothing else uses it.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @onelife/api test player-aggregate-routes`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/player-aggregate.ts apps/api/test/player-aggregate-routes.test.ts
git commit -m "feat(api): serve full PlayerPage from GET /players/:gamertag"
```

---

### Task 4: Web API client + types for `PlayerPage`

**Files:**
- Modify: `apps/web/src/lib/types.ts` (add types)
- Modify: `apps/web/src/lib/api.ts:119-120` (replace `getPlayerAggregate`)

**Interfaces:**
- Produces: web `PlayerPage` type (string dates) and `getPlayerPage(slug: string): Promise<PlayerPage | null>`.

- [ ] **Step 1: Add types** to `apps/web/src/lib/types.ts`:

```ts
export type PlayerCharacter = { name: string | null; head: string | null; gender: string | null };
export type PlayerKill = { victimGamertag: string; weapon: string | null; distanceMeters: number | null; occurredAt: string };
export type AliveStanding = { lifeId: number; startedAt: string; timeAliveSeconds: number; kills: number; longestKillMeters: number | null; killList: PlayerKill[] };
export type BanStanding = { banId: number; bannedAt: string; expiresAt: string | null; liftPending: boolean; triggeringLifeNumber: number | null };
export type ServerStanding = { serverId: number; map: string; slug: string; state: "alive" | "banned" | "idle"; character: PlayerCharacter | null; alive: AliveStanding | null; ban: BanStanding | null };
export type PastLife = { lifeId: number; serverId: number; map: string; slug: string; lifeNumber: number; startedAt: string; endedAt: string; timeAliveSeconds: number; kills: number; longestKillMeters: number | null; character: PlayerCharacter | null; death: { cause: string | null; byGamertag: string | null; weapon: string | null; distanceMeters: number | null }; vitals: { energy: number | null; water: number | null; bleedSources: number | null }; sessions: number; killList: PlayerKill[] };
export type PlayerPage = { gamertag: string; verified: boolean; firstSeenAt: string | null; aliveAnywhere: boolean; heroCharacter: PlayerCharacter | null; totals: { kills: number; lives: number; deaths: number; longestLifeSeconds: number }; standing: ServerStanding[]; pastLives: PastLife[] };
```

- [ ] **Step 2: Replace the client helper** in `apps/web/src/lib/api.ts` (line ~119). Remove `PlayerAggregate` from the import if unused elsewhere; add `PlayerPage`:

```ts
export const getPlayerPage = (slug: string) =>
  getOrNull<PlayerPage>(`/api/players/${encodeURIComponent(slug)}`);
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @onelife/web typecheck`
Expected: PASS (fix any references to the removed `getPlayerAggregate`; there are none in `app/` today).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/types.ts apps/web/src/lib/api.ts
git commit -m "feat(web): PlayerPage types + getPlayerPage client"
```

---

## Phase 2 — Web: helpers, components, page, OG image

### Task 5: Player-page pure helpers (formatters + standing derivations)

**Files:**
- Create: `apps/web/src/components/player/format.ts`
- Test: `apps/web/src/components/player/format.test.ts`

**Interfaces:**
- Produces: `formatDuration(seconds)`, `avatarSrc(character)`, `banCountdown(expiresAt: string | null, now: Date)`, `heroStatusLine(page)`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/components/player/format.test.ts
import { describe, it, expect } from "vitest";
import { formatDuration, avatarSrc, banCountdown, heroStatusLine } from "./format";

describe("player format helpers", () => {
  it("formats durations as Xh Ym", () => {
    expect(formatDuration(3720)).toBe("1h 2m");
    expect(formatDuration(-5)).toBe("0h 0m");
  });
  it("builds avatar src from character name", () => {
    expect(avatarSrc({ name: "Helga", head: null, gender: null })).toBe("/characters/helga.webp");
    expect(avatarSrc(null)).toBeNull();
  });
  it("computes ban countdown, clamped at zero", () => {
    const now = new Date("2026-07-14T12:00:00Z");
    expect(banCountdown("2026-07-14T14:30:00Z", now)).toBe("2h 30m");
    expect(banCountdown("2026-07-14T11:00:00Z", now)).toBe("0h 0m");
    expect(banCountdown(null, now)).toBeNull();
  });
  it("summarizes alive servers", () => {
    const page: any = { standing: [{ state: "alive", map: "chernarusplus" }, { state: "banned", map: "sakhal" }] };
    expect(heroStatusLine(page)).toBe("Alive on Chernarus");
  });
});
```

- [ ] **Step 2: Run test** → FAIL. `pnpm --filter @onelife/web test player/format`

- [ ] **Step 3: Implement**

```ts
// apps/web/src/components/player/format.ts
import type { PlayerCharacter, PlayerPage } from "@/lib/types";

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

export function avatarSrc(character: PlayerCharacter | null): string | null {
  if (!character || !character.name) return null;
  return `/characters/${character.name.toLowerCase()}.webp`;
}

export function banCountdown(expiresAt: string | null, now: Date): string | null {
  if (!expiresAt) return null;
  return formatDuration((new Date(expiresAt).getTime() - now.getTime()) / 1000);
}

const MAP_LABEL: Record<string, string> = { chernarusplus: "Chernarus", sakhal: "Sakhal" };
export function mapLabel(map: string): string {
  return MAP_LABEL[map] ?? map.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function heroStatusLine(page: Pick<PlayerPage, "standing">): string {
  const alive = page.standing.filter((s) => s.state === "alive").map((s) => mapLabel(s.map));
  return alive.length ? `Alive on ${alive.join(", ")}` : "No open lives";
}
```

- [ ] **Step 4: Run test** → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/player/format.ts apps/web/src/components/player/format.test.ts
git commit -m "feat(web): player-page format helpers"
```

---

### Task 6: Avatar + `SelfUnbanButton` (client owner action)

**Files:**
- Create: `apps/web/src/components/player/player-avatar.tsx`
- Create: `apps/web/src/components/player/self-unban-button.tsx`
- Test: `apps/web/src/components/player/self-unban-button.test.tsx`

**Interfaces:**
- Consumes: `avatarSrc` (`./format`); `getTokens`, `redeemToken` (`@/lib/api`); `useSession` (`@/lib/auth-client`); `useGamertagLinks` (`@/lib/use-gamertag-links`).
- Produces: `<PlayerAvatar character size />`; `<SelfUnbanButton banId pageGamertag />` rendering nothing when the viewer is not the verified owner.

**Ownership rule:** render owner UI only when `session.user` exists AND the viewer has an **active verified** link whose gamertag equals `pageGamertag`. Pending links render nothing.

- [ ] **Step 1: Write the failing test** (presentational states via props — inject data through a `deps` prop so the test needs no network)

```tsx
// apps/web/src/components/player/self-unban-button.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { UnbanView } from "./self-unban-button";

describe("UnbanView", () => {
  it("shows spend button when owner has tokens", () => {
    render(<UnbanView state="ready" balance={3} onRedeem={() => {}} />);
    expect(screen.getByRole("button", { name: /spend 1 token/i })).toBeEnabled();
  });
  it("disables when owner has no tokens", () => {
    render(<UnbanView state="no-tokens" balance={0} onRedeem={() => {}} />);
    expect(screen.getByRole("button", { name: /no unban tokens/i })).toBeDisabled();
  });
  it("shows pending state", () => {
    render(<UnbanView state="pending" balance={2} onRedeem={() => {}} />);
    expect(screen.getByText(/unban pending/i)).toBeInTheDocument();
  });
  it("renders nothing when not owner", () => {
    const { container } = render(<UnbanView state="hidden" balance={0} onRedeem={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run test** → FAIL. `pnpm --filter @onelife/web test self-unban-button`

- [ ] **Step 3: Implement** — split the pure view (`UnbanView`, tested) from the wiring (`SelfUnbanButton`, untested wrapper):

```tsx
// apps/web/src/components/player/self-unban-button.tsx
"use client";
import { useState } from "react";
import { useSession } from "@/lib/auth-client";
import { useGamertagLinks } from "@/lib/use-gamertag-links";
import { activeLink } from "@/lib/active-link";
import { getTokens, redeemToken } from "@/lib/api";
import { cn } from "@/lib/utils";

export type UnbanState = "hidden" | "ready" | "no-tokens" | "pending";

export function UnbanView({ state, balance, onRedeem }: { state: UnbanState; balance: number; onRedeem: () => void }) {
  if (state === "hidden") return null;
  if (state === "pending") {
    return <p className="mt-3 rounded bg-panel-2 px-3 py-2 text-center text-sm text-muted">⏳ Unban pending — lifting shortly…</p>;
  }
  const ready = state === "ready";
  return (
    <div className="mt-3">
      <button
        onClick={ready ? onRedeem : undefined}
        disabled={!ready}
        className={cn("w-full rounded px-3 py-2 text-sm font-hand", ready ? "bg-amber text-black" : "border border-line text-muted")}
      >
        {ready ? "Spend 1 token to unban now" : "No unban tokens"}
      </button>
      <p className="mt-1 text-center text-xs text-muted">
        {ready ? `🎟️ You have ${balance} unban token${balance === 1 ? "" : "s"}` : "Earn tokens monthly, by referral, or on verification"}
      </p>
    </div>
  );
}

export function SelfUnbanButton({ banId, pageGamertag, liftPending }: { banId: number; pageGamertag: string; liftPending: boolean }) {
  const { data: session } = useSession();
  const links = useGamertagLinks(!!session?.user);
  const link = activeLink(links.data);
  const isOwner = !!session?.user && link?.status === "verified" && link.gamertag === pageGamertag;
  const [pending, setPending] = useState(liftPending);
  const [tokens, setTokens] = useState<number | null>(null);

  // fetch balance lazily once owner is known
  if (isOwner && tokens === null) {
    getTokens().then((t) => setTokens(t.balance)).catch(() => setTokens(0));
  }
  if (!isOwner) return <UnbanView state="hidden" balance={0} onRedeem={() => {}} />;
  const state: UnbanState = pending ? "pending" : (tokens ?? 0) > 0 ? "ready" : "no-tokens";
  const onRedeem = async () => { setPending(true); try { await redeemToken(banId); } catch { setPending(false); } };
  return <UnbanView state={state} balance={tokens ?? 0} onRedeem={onRedeem} />;
}
```

```tsx
// apps/web/src/components/player/player-avatar.tsx
import type { PlayerCharacter } from "@/lib/types";
import { avatarSrc } from "./format";
import { cn } from "@/lib/utils";

export function PlayerAvatar({ character, size = 44, dim = false }: { character: PlayerCharacter | null; size?: number; dim?: boolean }) {
  const src = avatarSrc(character);
  const box = { width: size, height: size };
  if (src) {
    return <img src={src} alt={character?.name ?? "survivor"} style={box} className={cn("rounded-full border border-line object-cover", dim && "opacity-60 grayscale")} />;
  }
  return (
    <span aria-label="Unknown survivor" style={box} className={cn("flex items-center justify-center rounded-full border border-line bg-panel-2 text-muted", dim && "opacity-60")}>
      <svg viewBox="0 0 24 24" width={size * 0.5} height={size * 0.5} fill="currentColor" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" /></svg>
    </span>
  );
}
```

- [ ] **Step 4: Run test** → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/player/player-avatar.tsx apps/web/src/components/player/self-unban-button.tsx apps/web/src/components/player/self-unban-button.test.tsx
git commit -m "feat(web): PlayerAvatar + owner-only SelfUnbanButton"
```

---

### Task 7: Presentational blocks — hero, standing card, past-life card, kill list

**Files:**
- Create: `apps/web/src/components/player/kill-list.tsx`
- Create: `apps/web/src/components/player/player-hero.tsx`
- Create: `apps/web/src/components/player/standing-card.tsx`
- Create: `apps/web/src/components/player/past-life-card.tsx`
- Test: `apps/web/src/components/player/standing-card.test.tsx`, `apps/web/src/components/player/past-life-card.test.tsx`

**Interfaces:**
- Consumes: `PlayerAvatar`, `SelfUnbanButton`, `formatDuration`, `banCountdown`, `mapLabel`, `GamertagLink`, types from `@/lib/types`.
- Produces stateless components keyed by props; a `now: Date` prop is threaded in for deterministic countdown tests.

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/web/src/components/player/standing-card.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { StandingCard } from "./standing-card";
const now = new Date("2026-07-14T12:00:00Z");

describe("StandingCard", () => {
  const base: any = { serverId: 1, map: "chernarusplus", slug: "chern", character: null, alive: null, ban: null, pageGamertag: "Legend" };
  it("shows alive stats", () => {
    render(<StandingCard now={now} standing={{ ...base, state: "alive", alive: { lifeId: 1, startedAt: now.toISOString(), timeAliveSeconds: 3600, kills: 9, longestKillMeters: 312, killList: [] } }} />);
    expect(screen.getByText("Chernarus")).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();
    expect(screen.getByText("312m")).toBeInTheDocument();
  });
  it("shows ban countdown", () => {
    render(<StandingCard now={now} standing={{ ...base, state: "banned", ban: { banId: 5, bannedAt: now.toISOString(), expiresAt: "2026-07-14T14:00:00Z", liftPending: false, triggeringLifeNumber: 1 } }} />);
    expect(screen.getByText(/2h 0m/)).toBeInTheDocument();
    expect(screen.getByText(/ban lifts in/i)).toBeInTheDocument();
  });
});
```

```tsx
// apps/web/src/components/player/past-life-card.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { PastLifeCard } from "./past-life-card";

const life: any = { lifeId: 1, serverId: 1, map: "sakhal", slug: "sakh", lifeNumber: 6, startedAt: "2026-07-12T00:00:00Z", endedAt: "2026-07-12T04:00:00Z", timeAliveSeconds: 14400, kills: 5, longestKillMeters: 340, character: null, death: { cause: "pvp", byGamertag: "BanditKing", weapon: "SVD", distanceMeters: 340 }, vitals: { energy: 3200, water: 2800, bleedSources: 2 }, sessions: 3, killList: [{ victimGamertag: "freshmeat", weapon: "Mosin", distanceMeters: 210, occurredAt: "2026-07-12T01:00:00Z" }] };

describe("PastLifeCard", () => {
  it("renders a details summary with map + kills", () => {
    render(<PastLifeCard life={life} />);
    expect(screen.getByText("Sakhal")).toBeInTheDocument();
    expect(screen.getByText(/killed by/i)).toHaveTextContent("BanditKing");
  });
  it("keeps detail in the DOM (SEO) via <details>", () => {
    const { container } = render(<PastLifeCard life={life} />);
    expect(container.querySelector("details")).not.toBeNull();
    expect(screen.getByText("freshmeat")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests** → FAIL. `pnpm --filter @onelife/web test player/standing-card player/past-life-card`

- [ ] **Step 3: Implement the four components**

```tsx
// apps/web/src/components/player/kill-list.tsx
import type { PlayerKill } from "@/lib/types";
import { GamertagLink } from "@/components/gamertag-link";

export function KillList({ kills, limit }: { kills: PlayerKill[]; limit?: number }) {
  if (kills.length === 0) return <p className="text-xs text-muted">No kills this life.</p>;
  const shown = limit ? kills.slice(0, limit) : kills;
  return (
    <div className="mt-2">
      <p className="mb-1 text-[10px] uppercase tracking-wide text-muted">Kills this life</p>
      <ul className="space-y-1">
        {shown.map((k, i) => (
          <li key={i} className="flex justify-between border-b border-line/40 pb-1 text-xs text-bone">
            <GamertagLink gamertag={k.victimGamertag} />
            <span className="font-mono text-muted">{k.weapon ?? "—"}{k.distanceMeters != null ? ` · ${Math.round(k.distanceMeters)}m` : ""}</span>
          </li>
        ))}
      </ul>
      {limit && kills.length > limit && <p className="mt-1 text-xs text-muted">+ {kills.length - limit} more</p>}
    </div>
  );
}
```

```tsx
// apps/web/src/components/player/player-hero.tsx
import type { PlayerPage } from "@/lib/types";
import { PlayerAvatar } from "./player-avatar";
import { formatDuration, heroStatusLine } from "./format";

function Kpi({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex-1 rounded border border-line bg-panel-2 px-2 py-2 text-center">
      <span className="block font-display text-xl text-bone">{value}</span>
      <span className="text-[9px] uppercase tracking-wide text-muted">{label}</span>
    </div>
  );
}

export function PlayerHero({ page }: { page: PlayerPage }) {
  return (
    <header className="rounded-lg border border-line bg-panel p-4 sm:flex sm:items-center sm:gap-5">
      <div className="flex items-center gap-4 sm:flex-1">
        <PlayerAvatar character={page.heroCharacter} size={80} />
        <div>
          <h1 className="font-display text-2xl text-amber">{page.gamertag}</h1>
          {page.verified && <p className="text-xs text-emerald-400">✓ Verified survivor</p>}
          <p className="text-xs text-muted">{heroStatusLine(page)}</p>
        </div>
      </div>
      <div className="mt-4 flex gap-2 sm:mt-0">
        <Kpi value={String(page.totals.kills)} label="Kills" />
        <Kpi value={String(page.totals.lives)} label="Lives" />
        <Kpi value={String(page.totals.deaths)} label="Deaths" />
        <Kpi value={formatDuration(page.totals.longestLifeSeconds)} label="Longest life" />
      </div>
    </header>
  );
}
```

```tsx
// apps/web/src/components/player/standing-card.tsx
import type { ServerStanding } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PlayerAvatar } from "./player-avatar";
import { KillList } from "./kill-list";
import { SelfUnbanButton } from "./self-unban-button";
import { formatDuration, banCountdown, mapLabel } from "./format";

function Stat({ value, label }: { value: string; label: string }) {
  return <div className="flex-1 rounded bg-panel-2 py-2 text-center"><span className="block font-mono text-bone">{value}</span><span className="text-[9px] uppercase text-muted">{label}</span></div>;
}

export function StandingCard({ standing, now, pageGamertag }: { standing: ServerStanding & { pageGamertag?: string }; now: Date; pageGamertag?: string }) {
  const gt = pageGamertag ?? standing.pageGamertag ?? "";
  const border = standing.state === "alive" ? "border-emerald-500/40" : standing.state === "banned" ? "border-red-500/40" : "border-line";
  return (
    <div className={cn("rounded-lg border bg-panel p-4", border)}>
      <div className="flex items-center gap-3">
        <PlayerAvatar character={standing.character} size={44} dim={standing.state !== "alive"} />
        <div className="flex-1">
          <p className="font-hand text-bone">{mapLabel(standing.map)}</p>
          <p className="text-xs text-muted">
            {standing.state === "alive" && standing.alive ? `Alive ${formatDuration(standing.alive.timeAliveSeconds)}` : standing.state === "banned" ? "Banned" : "No open life"}
          </p>
        </div>
        <span className="text-[9px] uppercase">{standing.state === "alive" ? "🟢 Alive" : standing.state === "banned" ? "⛔ Banned" : "⚪ Idle"}</span>
      </div>

      {standing.state === "alive" && standing.alive && (
        <details className="mt-3">
          <summary className="flex cursor-pointer gap-2 list-none">
            <Stat value={String(standing.alive.kills)} label="Kills" />
            <Stat value={standing.alive.longestKillMeters == null ? "—" : `${Math.round(standing.alive.longestKillMeters)}m`} label="Longest kill" />
            <Stat value={formatDuration(standing.alive.timeAliveSeconds)} label="Time alive" />
          </summary>
          <KillList kills={standing.alive.killList} limit={10} />
        </details>
      )}

      {standing.state === "banned" && standing.ban && (
        <div className="mt-3 text-center">
          {banCountdown(standing.ban.expiresAt, now) && (
            <p className="font-display text-xl text-red-300">{banCountdown(standing.ban.expiresAt, now)}<span className="block text-[9px] uppercase text-muted">ban lifts in</span></p>
          )}
          <SelfUnbanButton banId={standing.ban.banId} pageGamertag={gt} liftPending={standing.ban.liftPending} />
        </div>
      )}
    </div>
  );
}
```

```tsx
// apps/web/src/components/player/past-life-card.tsx
import type { PastLife } from "@/lib/types";
import { PlayerAvatar } from "./player-avatar";
import { KillList } from "./kill-list";
import { GamertagLink } from "@/components/gamertag-link";
import { formatDuration, mapLabel } from "./format";

function Stat({ value, label }: { value: string; label: string }) {
  return <div className="flex-1 rounded bg-panel-2 py-2 text-center"><span className="block font-mono text-bone">{value}</span><span className="text-[9px] uppercase text-muted">{label}</span></div>;
}

export function PastLifeCard({ life }: { life: PastLife }) {
  return (
    <details className="rounded-lg border border-line bg-panel p-3">
      <summary className="flex cursor-pointer items-center gap-3 list-none">
        <PlayerAvatar character={life.character} size={34} dim />
        <span className="font-hand text-bone">{mapLabel(life.map)}</span>
        <span className="text-xs text-muted">{formatDuration(life.timeAliveSeconds)} · {life.kills} kills</span>
      </summary>
      <div className="mt-2">
        {life.death?.cause && (
          <p className="text-xs text-red-300">☠ {life.death.cause === "pvp" ? "Killed by " : "Died — "}
            {life.death.byGamertag ? <GamertagLink gamertag={life.death.byGamertag} /> : life.death.cause}
            {life.death.weapon ? ` · ${life.death.weapon}` : ""}{life.death.distanceMeters != null ? ` · ${Math.round(life.death.distanceMeters)}m` : ""}
          </p>
        )}
        <div className="mt-2 flex gap-2">
          <Stat value={String(life.kills)} label="Kills" />
          <Stat value={life.longestKillMeters == null ? "—" : `${Math.round(life.longestKillMeters)}m`} label="Longest kill" />
          <Stat value={formatDuration(life.timeAliveSeconds)} label="Time alive" />
          <Stat value={String(life.sessions)} label="Sessions" />
        </div>
        <KillList kills={life.killList} />
        {(life.vitals.energy != null || life.vitals.bleedSources != null) && (
          <p className="mt-2 text-[10px] text-muted">At death: energy {life.vitals.energy ?? "—"} · water {life.vitals.water ?? "—"} · bleeding from {life.vitals.bleedSources ?? 0}</p>
        )}
      </div>
    </details>
  );
}
```

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/player/kill-list.tsx apps/web/src/components/player/player-hero.tsx apps/web/src/components/player/standing-card.tsx apps/web/src/components/player/past-life-card.tsx apps/web/src/components/player/standing-card.test.tsx apps/web/src/components/player/past-life-card.test.tsx
git commit -m "feat(web): player-page presentational blocks"
```

---

### Task 8: The page — `app/players/[slug]/page.tsx` + metadata + JSON-LD

**Files:**
- Create: `apps/web/src/app/players/[slug]/page.tsx`
- Create: `apps/web/src/components/player/player-profile.tsx` (assembles the blocks + JSON-LD)

**Interfaces:**
- Consumes: `getPlayerPage` (`@/lib/api`), `absoluteUrl` (`@/lib/seo`), the Phase-2 components.
- Untested per convention (server component + thin assembly).

- [ ] **Step 1: Implement `PlayerProfile`**

```tsx
// apps/web/src/components/player/player-profile.tsx
import type { PlayerPage } from "@/lib/types";
import { absoluteUrl } from "@/lib/seo";
import { playerSlug } from "@/lib/slug";
import { PlayerHero } from "./player-hero";
import { StandingCard } from "./standing-card";
import { PastLifeCard } from "./past-life-card";

function profileLd(page: PlayerPage) {
  return {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    url: absoluteUrl(`/players/${playerSlug(page.gamertag)}`),
    mainEntity: { "@type": "Person", name: page.gamertag },
  };
}

export function PlayerProfile({ page, now }: { page: PlayerPage; now: Date }) {
  const aliveOrBanned = page.standing.filter((s) => s.state !== "idle");
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(profileLd(page)) }} />
      <PlayerHero page={page} />

      {aliveOrBanned.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-bold uppercase tracking-wide text-muted">Current standing</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {aliveOrBanned.map((s) => <StandingCard key={s.serverId} standing={s} now={now} pageGamertag={page.gamertag} />)}
          </div>
        </section>
      )}

      {page.pastLives.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-bold uppercase tracking-wide text-muted">Past lives · {page.pastLives.length}</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {page.pastLives.map((l) => <PastLifeCard key={`${l.serverId}:${l.lifeId}`} life={l} />)}
          </div>
        </section>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Implement the route** with `generateMetadata` (dynamic OG image is auto-wired by Task 9's `opengraph-image.tsx` colocation, so metadata only needs title/description/canonical):

```tsx
// apps/web/src/app/players/[slug]/page.tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPlayerPage } from "@/lib/api";
import { absoluteUrl } from "@/lib/seo";
import { PlayerProfile } from "@/components/player/player-profile";
import { formatDuration } from "@/components/player/format";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const page = await getPlayerPage(slug).catch(() => null);
  if (!page) return { title: "Survivor not found — One Life" };
  const desc = `${page.totals.kills} kills · ${page.totals.lives} lives · longest life ${formatDuration(page.totals.longestLifeSeconds)}.`;
  const url = absoluteUrl(`/players/${slug}`);
  return {
    title: `${page.gamertag} — One Life DayZ survivor`,
    description: desc,
    alternates: { canonical: url },
    openGraph: { title: page.gamertag, description: desc, url, type: "profile" },
    twitter: { card: "summary_large_image", title: page.gamertag, description: desc },
  };
}

export default async function PlayerPageRoute({ params }: Props) {
  const { slug } = await params;
  const page = await getPlayerPage(slug);
  if (!page) notFound();
  return <PlayerProfile page={page} now={new Date()} />;
}
```

- [ ] **Step 3: Verify build + manual smoke**

Run: `pnpm --filter @onelife/web typecheck` → PASS.
Manual: with the API + web running (`docker compose up -d postgres`, then dev servers), open `/players/<a-known-gamertag>` and confirm hero, standing, and past-life expansion render; open `/players/nobody` → 404.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/players apps/web/src/components/player/player-profile.tsx
git commit -m "feat(web): player profile page with metadata + JSON-LD"
```

---

### Task 9: Dynamic OpenGraph image

**Files:**
- Create: `apps/web/src/app/players/[slug]/opengraph-image.tsx`

**Interfaces:**
- Consumes: `getPlayerPage` (`@/lib/api`), `formatDuration`. Next.js `ImageResponse`. Untested per convention.

- [ ] **Step 1: Implement**

```tsx
// apps/web/src/app/players/[slug]/opengraph-image.tsx
import { ImageResponse } from "next/og";
import { getPlayerPage } from "@/lib/api";
import { formatDuration } from "@/components/player/format";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "One Life survivor profile";

export default async function OgImage({ params }: { params: { slug: string } }) {
  const page = await getPlayerPage(params.slug).catch(() => null);
  const gamertag = page?.gamertag ?? "Unknown survivor";
  const stats = page
    ? [
        [String(page.totals.kills), "Kills"],
        [String(page.totals.lives), "Lives"],
        [formatDuration(page.totals.longestLifeSeconds), "Longest life"],
      ]
    : [];
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", background: "#0d1017", color: "#fff", padding: 80, fontFamily: "sans-serif" }}>
        <div style={{ fontSize: 64, fontWeight: 800 }}>{gamertag}</div>
        {page?.verified && <div style={{ fontSize: 24, color: "#7fdca0", marginTop: 8 }}>✓ Verified survivor</div>}
        <div style={{ display: "flex", gap: 20, marginTop: 40 }}>
          {stats.map(([v, l]) => (
            <div key={l} style={{ display: "flex", flexDirection: "column", background: "rgba(120,180,255,0.12)", borderRadius: 12, padding: "16px 28px" }}>
              <span style={{ fontSize: 44, fontWeight: 800 }}>{v}</span>
              <span style={{ fontSize: 18, opacity: 0.7 }}>{l}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 40, fontSize: 20, letterSpacing: 2, opacity: 0.5 }}>ONE LIFE · DAYZ</div>
      </div>
    ),
    size,
  );
}
```

- [ ] **Step 2: Verify**

Run: `pnpm --filter @onelife/web typecheck` → PASS.
Manual: open `/players/<gamertag>/opengraph-image` and confirm a 1200×630 PNG renders with the gamertag and stats.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/players/[slug]/opengraph-image.tsx
git commit -m "feat(web): dynamic per-player OpenGraph image"
```

---

## Phase 3 — Cross-cutting links & auth routing

### Task 10: Wire `GamertagLink` into the survivors board

**Files:**
- Modify: `apps/web/src/components/survivors/survivor-row.tsx:61`
- Test: `apps/web/src/components/survivors/survivor-row.test.tsx` (create if absent)

**Interfaces:**
- Consumes: existing `GamertagLink` (`@/components/gamertag-link`).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/components/survivors/survivor-row.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { SurvivorRow } from "./survivor-row";

const row: any = { gamertag: "xSgt Hartman", map: "chernarusplus", slug: "chern", timeAliveSeconds: 3600, killsThisLife: 2, longestKillMeters: 100, character: null };

describe("SurvivorRow", () => {
  it("links the gamertag to the player page", () => {
    render(<SurvivorRow row={row} rank={1} showMap={false} sort="time" />);
    expect(screen.getByRole("link", { name: "xSgt Hartman" })).toHaveAttribute("href", "/players/xsgt-hartman");
  });
});
```

- [ ] **Step 2: Run test** → FAIL (gamertag is a plain span). `pnpm --filter @onelife/web test survivor-row`

- [ ] **Step 3: Implement** — in `survivor-row.tsx`, import and replace the span:

```tsx
import { GamertagLink } from "@/components/gamertag-link";
// ...
// replace: <span className="font-hand text-bone">{row.gamertag}</span>
<GamertagLink gamertag={row.gamertag} />
```

- [ ] **Step 4: Run test** → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/survivors/survivor-row.tsx apps/web/src/components/survivors/survivor-row.test.tsx
git commit -m "feat(web): link survivor-row gamertags to player pages"
```

---

### Task 11: Route verified users to their player page (masthead + post-login resolver)

**Files:**
- Modify: `apps/web/src/components/masthead-slot.tsx` (verified `href`)
- Create: `apps/web/src/app/welcome/page.tsx` (post-login resolver)
- Modify: `apps/web/src/components/login-panel.tsx:12,15` (`callbackURL` → `/welcome`)
- Test: update `apps/web/src/components/header.test.tsx` for the new verified href.

**Interfaces:**
- Consumes: `playerSlug` (`@/lib/slug`), `apiGet("/api/auth/get-session")` + `getGamertagLinks` server-side (the `account/layout.tsx` pattern), `activeLink`.

- [ ] **Step 1: Update the masthead test** to expect the player-page href

In `apps/web/src/components/header.test.tsx`, change the verified-state expectation so the amber CTA links to `/players/<slug>` (e.g. for gamertag `Alpha` → `/players/alpha`) instead of `/account`.

- [ ] **Step 2: Run test** → FAIL. `pnpm --filter @onelife/web test header`

- [ ] **Step 3: Implement the masthead change** in `masthead-slot.tsx`:

```tsx
import { playerSlug } from "@/lib/slug";
// verified branch:
// was: <Link href="/account">{status.link.gamertag}</Link>
<Link href={`/players/${playerSlug(status.link.gamertag)}`} className="...existing amber CTA classes...">{status.link.gamertag}</Link>
```

- [ ] **Step 4: Run test** → PASS.

- [ ] **Step 5: Add the post-login resolver route**

```tsx
// apps/web/src/app/welcome/page.tsx
import { redirect } from "next/navigation";
import { apiGet, getGamertagLinks } from "@/lib/api";
import { activeLink } from "@/lib/active-link";
import { playerSlug } from "@/lib/slug";

export default async function Welcome() {
  const session = await apiGet<{ user?: { id: string } }>("/api/auth/get-session").catch(() => null);
  if (!session?.user) redirect("/login");
  const links = await getGamertagLinks().catch(() => []);
  const link = activeLink(links);
  if (link?.status === "verified") redirect(`/players/${playerSlug(link.gamertag)}`);
  if (link?.status === "pending") redirect("/account");
  redirect("/account/claim");
}
```

- [ ] **Step 6: Point login at the resolver** — in `login-panel.tsx`, change both `callbackURL: "/account"` to `callbackURL: "/welcome"`.

- [ ] **Step 7: Verify + smoke**

Run: `pnpm --filter @onelife/web typecheck && pnpm --filter @onelife/web test header` → PASS.
Manual: sign in as a verified user → lands on `/players/<slug>`; verify the masthead gamertag chip links there too.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/masthead-slot.tsx apps/web/src/app/welcome/page.tsx apps/web/src/components/login-panel.tsx apps/web/src/components/header.test.tsx
git commit -m "feat(web): route verified users to their player page after login"
```

---

## Phase 4 — Docs (last pre-PR step)

### Task 12: CHANGELOG.md + CLAUDE.md

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add a CHANGELOG entry** under the appropriate unreleased/next-version heading, e.g.:

```markdown
- **Player pages**: public, SEO-optimized profile at `/players/{slug}` — cross-server totals,
  per-server current standing (alive / banned / idle) with a ban countdown, expandable past-life
  history with kill lists, dynamic OpenGraph share image, and owner-only spend-token self-unban.
  Gamertags across the site now link to player pages; verified users land on their own page after
  login.
```

- [ ] **Step 2: Add a CLAUDE.md bullet** in the sub-projects list summarizing the player page (route shape, `getPlayerPage` read-model, the `/welcome` resolver, and that owner mode requires a verified link) — matching the density of the existing "Survivors leaderboard" bullet.

- [ ] **Step 3: Run the full suite + typecheck**

Run: `pnpm turbo run typecheck && pnpm turbo run test --concurrency=1`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md CLAUDE.md
git commit -m "docs: player page in CHANGELOG + CLAUDE.md"
```

- [ ] **Step 5: Open the PR** into `develop` (use the `finishing-a-feature` skill).

---

## Self-Review

**Spec coverage:**
- Route `/players/[slug]`, SSR, 404 → Task 8. ✅
- Hero + totals → Task 7 (`PlayerHero`), data in Task 2. ✅
- Current standing (alive/banned/idle) + ban countdown → Tasks 2, 7. ✅
- Owner-only spend-token unban, **verified-only**, 4 states → Task 6. ✅
- Past lives (combined, recency, `<details>`, kill list, vitals, sessions) → Tasks 2, 7. ✅
- Stats scope (kill list new; distance/hits deferred) → Tasks 1, 2. ✅
- Avatar kept, persona name dropped → Tasks 6, 7 (no name rendered). ✅
- Dynamic OG image → Task 9. Metadata + JSON-LD → Task 8. ✅
- Gamertag links everywhere → Task 10 (survivor board) + `GamertagLink` used in kill lists / death-by (Task 7). ✅
- Post-login landing + masthead → Task 11. ✅
- Testing convention → integration for read-models, unit for pure/presentational, wrappers untested. ✅
- Fork workflow + CHANGELOG/CLAUDE last → Global Constraints + Task 12. ✅

**Placeholder scan:** none — every step has real code/commands.

**Type consistency:** `PlayerPage`/`ServerStanding`/`PastLife`/`PlayerKill`/`PlayerCharacter` defined in Task 2 (backend, `Date`) and mirrored in Task 4 (web, `string` dates); `getLifeKills`/`PlayerKill` from Task 1 consumed by Task 2; `UnbanView`/`UnbanState` consistent between Task 6 test and impl; `banCountdown`/`formatDuration`/`mapLabel` from Task 5 used in Tasks 7/8/9.

**Note on `PlayerAggregate`:** Task 3 replaces the route payload and Task 4 removes the web `getPlayerAggregate`; the old `PlayerAggregate` read-model/type can remain exported (harmless) or be removed in a follow-up — no current consumer depends on it in `app/`.
