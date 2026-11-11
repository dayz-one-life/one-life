import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { servers, players, lives, sessions, kills, playerGamertags } from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { getPlayerPage } from "../src/player-page.js";
import { getLifeTimeline } from "../src/life-timeline.js";
import { getAliveSurvivors } from "../src/survivors.js";
import { getLeaderboard, LEADERBOARDS } from "../src/leaderboards.js";
import { qualifiedLifeCondition } from "../src/qualified-lives.js";

/**
 * A trap kill is a kill (death-verdict spec 2.4, revision 3): the behavioural pin. The same placer
 * and victim are seeded once with a `kill_line` row and once with a `trap_placement` row, and every
 * reader that decides or shows a kill must answer the same — apart from the marker itself
 * (`basis`, `killBasis`). The enforcer's `planBans` and the notifier's lives generator are pinned
 * in their own packages (enforcer `tick.test.ts`, notifier `generators-lives-offline-placer.test.ts`);
 * the deny-then-sweep path in the projector (`apps/projector/test/trap-kill-readers.test.ts`).
 *
 * ⚠️ Invented players and server. The kill-line twin carries the trap row's weapon and null
 * distance on purpose, so the only thing that differs between the two worlds is the basis.
 */
const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 54e7;
const SLUG = `tkp-${svc}`;
const T0 = new Date("2031-05-01T10:00:00Z");
const at = (m: number) => new Date(T0.getTime() + m * 60_000);
const NOW = at(24 * 60);
const PLACER = `Placer Person ${svc}`;
const VICTIM = `Victim One ${svc}`;
const LONER = `Loner Placer ${svc}`;
let sid: number, placerId: number, victimId: number, lonerId: number;
let placerLife: number, victimLife: number, lonerLife: number, victimLife2: number;

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "tkp", map: "chernarusplus", slug: SLUG, active: true }).returning();
  sid = s!.id;
  const [p] = await db.insert(players).values({ gamertag: PLACER, firstSeenAt: T0, lastSeenAt: at(1) }).returning();
  placerId = Number(p!.id);
  const [v] = await db.insert(players).values({ gamertag: VICTIM, firstSeenAt: T0, lastSeenAt: at(300) }).returning();
  victimId = Number(v!.id);
  const [lo] = await db.insert(players).values({ gamertag: LONER, firstSeenAt: T0, lastSeenAt: at(5) }).returning();
  lonerId = Number(lo!.id);
  await db.insert(playerGamertags).values([
    { playerId: placerId, gamertag: PLACER, firstSeenAt: T0, lastSeenAt: T0 },
    { playerId: victimId, gamertag: VICTIM, firstSeenAt: T0, lastSeenAt: T0 },
    { playerId: lonerId, gamertag: LONER, firstSeenAt: T0, lastSeenAt: T0 },
  ]);
  // The placer: an OPEN life of 60 s (one closed session), set the trap and logged off.
  const [pl] = await db.insert(lives).values({ serverId: sid, playerId: placerId, lifeNumber: 1, startedAt: T0, endedAt: null, playtimeSeconds: 60 }).returning();
  placerLife = Number(pl!.id);
  await db.insert(sessions).values({ serverId: sid, playerId: placerId, lifeId: placerLife, connectedAt: T0, disconnectedAt: at(1), durationSeconds: 60, closeReason: "disconnect" });
  // The victim: a life that counts on its own (600 s), ended by the trap at +5 h.
  const [vl] = await db.insert(lives).values({
    serverId: sid, playerId: victimId, lifeNumber: 1, startedAt: at(200), endedAt: at(300), playtimeSeconds: 600, deathCause: "explosion",
  }).returning();
  victimLife = Number(vl!.id);
  await db.insert(sessions).values({ serverId: sid, playerId: victimId, lifeId: victimLife, connectedAt: at(290), disconnectedAt: at(300), durationSeconds: 600, closeReason: "death" });
  const [vl2] = await db.insert(lives).values({
    serverId: sid, playerId: victimId, lifeNumber: 2, startedAt: at(400), endedAt: at(500), playtimeSeconds: 600, deathCause: "explosion",
  }).returning();
  victimLife2 = Number(vl2!.id);
  // A placer whose only life ended before their trap fired, and who has not respawned.
  const [ll] = await db.insert(lives).values({
    serverId: sid, playerId: lonerId, lifeNumber: 1, startedAt: T0, endedAt: at(5), playtimeSeconds: 300, deathCause: "fall",
  }).returning();
  lonerLife = Number(ll!.id);
});
afterEach(async () => {
  await db.delete(kills).where(eq(kills.serverId, sid));
  await db.update(players).set({ gamertag: PLACER }).where(eq(players.id, placerId));
});
afterAll(async () => {
  await db.delete(sessions).where(eq(sessions.serverId, sid));
  await db.delete(lives).where(eq(lives.serverId, sid));
  await db.delete(playerGamertags).where(inArray(playerGamertags.playerId, [placerId, victimId, lonerId]));
  await db.delete(players).where(inArray(players.id, [placerId, victimId, lonerId]));
  await db.delete(servers).where(eq(servers.id, sid));
  await sql.end();
});

type Basis = "kill_line" | "trap_placement";
/** This server's standing card: other suites' active servers show up on the page too. */
const mine = <T extends { serverId: number }>(cards: T[]) => cards.find((c) => c.serverId === sid);
async function kill(basis: Basis, o: { killerId?: number; killerName?: string; victimLifeId?: number; at?: Date } = {}) {
  await db.insert(kills).values({
    serverId: sid, killerGamertag: o.killerName ?? PLACER, killerPlayerId: o.killerId ?? placerId, victimGamertag: VICTIM,
    victimPlayerId: victimId, victimLifeId: o.victimLifeId ?? victimLife, weapon: "Tripwire", distance: null, occurredAt: o.at ?? at(300),
    basis, creditSource: basis === "trap_placement" ? "classifier" : null,
  });
}

/** Drop the marker fields — the one thing allowed to differ — so the rest can be compared whole. */
function unmarked<T>(v: T): T {
  return JSON.parse(JSON.stringify(v, (k, x) => (k === "basis" || k === "killBasis" || k === "creditSource" || k === "id" ? undefined : x)));
}

async function everyReader() {
  const page = await getPlayerPage(db, PLACER, NOW);
  const timeline = await getLifeTimeline(db, sid, PLACER, placerLife);
  const survivors = await getAliveSurvivors(db, { slug: SLUG, page: 1 }, NOW);
  const qualified = (await db.select({ id: lives.id }).from(lives).innerJoin(players, eq(players.id, lives.playerId))
    .where(and(eq(lives.serverId, sid), qualifiedLifeCondition(db)))).map((r) => Number(r.id)).sort();
  const boards: Record<string, unknown> = {};
  for (const b of LEADERBOARDS) boards[b] = await getLeaderboard(db, sid, b, NOW, 50);
  return { page, timeline, survivors, qualified, boards };
}

describe("the same kill as a kill line and as a trap", () => {
  it("every reader returns identical results, apart from the basis", async () => {
    await kill("kill_line");
    const asLine = await everyReader();
    await db.delete(kills).where(eq(kills.serverId, sid));
    await kill("trap_placement");
    const asTrap = await everyReader();
    expect(unmarked(asTrap)).toEqual(unmarked(asLine));
    // and the marker is there to be read
    expect(mine(asTrap.page!.standing)!.alive!.killList[0]!.basis).toBe("trap_placement");
    expect(asTrap.timeline!.qualifiedAt).toMatchObject({ by: "kill", killBasis: "trap_placement" });
    expect(asLine.timeline!.qualifiedAt).toMatchObject({ by: "kill", killBasis: "kill_line" });
  });

  it("longest-kills lists only the kill-line row (a trap kill has no distance)", async () => {
    await kill("kill_line", { at: at(300) });
    await db.update(kills).set({ distance: 120, weapon: "M4-A1" }).where(eq(kills.serverId, sid));
    await kill("trap_placement", { victimLifeId: victimLife2, at: at(500) });
    const board = await getLeaderboard(db, sid, "longest-kills", NOW, 50);
    expect(board).toEqual([{ gamertag: PLACER, value: 120, detail: { victim: VICTIM, weapon: "M4-A1" } }]);
  });
});

describe("a placer on a 60-second open life with one trap kill", () => {
  it("is qualified everywhere", async () => {
    await kill("trap_placement");
    const r = await everyReader();
    expect(mine(r.page!.standing)).toMatchObject({ state: "alive", alive: { qualified: true, kills: 1 } });
    expect(r.page!.aliveAnywhere).toBe(true);
    expect(r.page!.totals.kills).toBe(1);
    expect(r.timeline!.qualifiedAt).toMatchObject({ by: "kill", killBasis: "trap_placement" });
    expect(r.survivors.rows.map((x) => x.gamertag)).toContain(PLACER);
    expect(r.qualified).toContain(placerLife);
    expect((r.boards["most-kills"] as { gamertag: string }[]).map((x) => x.gamertag)).toContain(PLACER);
    expect((r.boards["longest-killstreak"] as { gamertag: string }[]).map((x) => x.gamertag)).toContain(PLACER);
    expect((r.boards["alive-longest"] as { gamertag: string }[]).map((x) => x.gamertag)).toContain(PLACER);
  });

  it("is not qualified anywhere without it", async () => {
    const r = await everyReader();
    expect(mine(r.page!.standing)).toMatchObject({ state: "alive", alive: { qualified: false } });
    expect(r.qualified).not.toContain(placerLife);
    expect(r.survivors.rows.map((x) => x.gamertag)).not.toContain(PLACER);
  });
});

describe("a trap kill dated when the placer has no open life", () => {
  it("is in the career total and in no life", async () => {
    await kill("trap_placement", { killerId: lonerId, killerName: LONER, at: at(300) });
    const page = (await getPlayerPage(db, LONER, NOW))!;
    expect(page.totals.kills).toBe(1);
    expect(page.pastLives.map((l) => l.kills)).toEqual([0]);
    const tl = (await getLifeTimeline(db, sid, LONER, lonerLife))!;
    expect(tl.kills).toEqual([]);
  });
});

describe("most-kills orders level players by name", () => {
  it("two players on the same count come back in the same order every time", async () => {
    await kill("trap_placement");
    await kill("kill_line", { killerId: lonerId, killerName: LONER, victimLifeId: victimLife2, at: at(500) });
    const board = await getLeaderboard(db, sid, "most-kills", NOW, 50);
    expect(board.map((r) => r.gamertag)).toEqual([LONER, PLACER].sort());
  });
});

describe("a rename after the row is written", () => {
  /**
   * A trap row carries the placer's name when the sweep wrote it. Until killer-id matching (PR
   * #398, residual question Q8) ships, the readers that match a kill to a player BY NAME lose the
   * kill after a rename; the readers that match by `killer_player_id` keep it. This pins today's
   * behaviour and names the readers on each side; once #398 merges, the four name readers move to
   * the "keeps it" side and this test must be changed to assert agreement.
   */
  it("id readers keep the kill; name readers (most-kills by name, killstreak, alive-longest) do not yet", async () => {
    await kill("trap_placement");
    const RENAMED = `Renamed Placer ${svc}`;
    await db.update(players).set({ gamertag: RENAMED }).where(eq(players.id, placerId));
    await db.insert(playerGamertags).values({ playerId: placerId, gamertag: RENAMED, firstSeenAt: NOW, lastSeenAt: NOW });
    try {
      // by id: the page, the timeline and qualification
      const page = (await getPlayerPage(db, RENAMED, NOW))!;
      expect(page.totals.kills).toBe(1);
      expect(mine(page.standing)).toMatchObject({ alive: { qualified: true, kills: 1 } });
      const tl = (await getLifeTimeline(db, sid, RENAMED, placerLife))!;
      expect(tl.kills).toHaveLength(1);
      // by name: the board shows the name on the row, the streak and alive-longest lose it
      const most = await getLeaderboard(db, sid, "most-kills", NOW, 50);
      expect(most.map((r) => r.gamertag)).toEqual([PLACER]);
      const streak = await getLeaderboard(db, sid, "longest-killstreak", NOW, 50);
      expect(streak.map((r) => r.gamertag)).not.toContain(RENAMED);
      const alive = await getLeaderboard(db, sid, "alive-longest", NOW, 50);
      expect(alive.map((r) => r.gamertag)).not.toContain(RENAMED);
    } finally {
      await db.delete(playerGamertags).where(and(eq(playerGamertags.playerId, placerId), eq(playerGamertags.gamertag, RENAMED)));
    }
  });
});
