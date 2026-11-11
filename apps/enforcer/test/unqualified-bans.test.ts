import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { servers, players, lives, bans, kills, playerGamertags, deathVerdictQueue } from "@onelife/db";
import { eq, inArray } from "drizzle-orm";
import { getTestDb } from "@onelife/test-support";
import type { VerdictSweepBacklog } from "@onelife/read-models";
import { findUnqualifiedBans, parseUnqualifiedArgs, runUnqualifiedBans, SweepNotCaughtUpError } from "../src/unqualified-bans.js";
import { enforcerTick, type BanClient } from "../src/tick.js";

/** ⚠️ Invented players and lives only. */
const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 57e7;
const T0 = new Date("2031-10-01T10:00:00Z");
const hrs = (h: number) => new Date(T0.getTime() + h * 3600_000);
const NOW = hrs(5);
let serverId: number;
const pids: number[] = [];
const caughtUp = async (): Promise<VerdictSweepBacklog> => ({ queued: 0, unswept: 0, foldBehind: false });
let k = 0;

/** A player with one short life (no kill, under five minutes, not a player kill) and a running ban on it. */
async function shortLifeBan(o: { status?: string; tag?: string; dayzId?: string; trapKill?: boolean; startH?: number } = {}) {
  k++;
  const tag = o.tag ?? `Short Life ${svc}-${k}`;
  const [p] = await db.insert(players).values({ gamertag: tag, dayzId: o.dayzId ?? `${svc}${String(k).padStart(4, "0")}`.padEnd(40, "7") }).returning();
  pids.push(p!.id);
  await db.insert(playerGamertags).values({ playerId: p!.id, gamertag: tag, firstSeenAt: T0, lastSeenAt: T0 });
  const start = hrs(o.startH ?? 0);
  const end = new Date(start.getTime() + 120_000);
  const [l] = await db.insert(lives).values({ serverId, playerId: p!.id, lifeNumber: 1, startedAt: start, endedAt: end, deathCause: "infected", playtimeSeconds: 120 }).returning();
  if (o.trapKill) {
    const [v] = await db.insert(players).values({ gamertag: `Victim ${svc}-${k}` }).returning();
    pids.push(v!.id);
    const [vl] = await db.insert(lives).values({ serverId, playerId: v!.id, lifeNumber: 1, startedAt: start, endedAt: new Date(start.getTime() + 60_000), deathCause: "explosion", playtimeSeconds: 3600 }).returning();
    await db.insert(kills).values({ serverId, killerGamertag: tag, killerPlayerId: p!.id, victimGamertag: `Victim ${svc}-${k}`, victimLifeId: vl!.id,
      occurredAt: new Date(start.getTime() + 60_000), weapon: "Tripwire", basis: "trap_placement", creditSource: "classifier" });
  }
  const [b] = await db.insert(bans).values({ serverId, gamertag: tag, dayzId: p!.dayzId, lifeStartedAt: start, reason: "qualified_death",
    qualifiedBy: "kill", bannedAt: end, expiresAt: new Date(end.getTime() + 24 * 3600_000), status: o.status ?? "applied", dryRun: false }).returning();
  return { playerId: p!.id, lifeId: l!.id, banId: Number(b!.id), tag, dayzId: p!.dayzId };
}

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "uq" }).returning();
  serverId = s!.id;
});
afterAll(async () => {
  await db.delete(bans).where(eq(bans.serverId, serverId));
  await db.delete(kills).where(eq(kills.serverId, serverId));
  await db.delete(lives).where(eq(lives.serverId, serverId));
  await db.delete(playerGamertags).where(inArray(playerGamertags.playerId, pids));
  await db.delete(players).where(inArray(players.id, pids));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

const ban = async (id: number) => (await db.select().from(bans).where(eq(bans.id, id)))[0]!;

describe("unqualified-bans", () => {
  it("parses --lift and nothing else", () => {
    expect(parseUnqualifiedArgs(["--"])).toEqual({ lift: false });
    expect(parseUnqualifiedArgs(["--lift"])).toEqual({ lift: true });
    expect(() => parseUnqualifiedArgs(["--force"])).toThrow(/usage/);
  });

  it("lists a ban whose life no longer qualifies, and changes nothing by default", async () => {
    const gone = await shortLifeBan();
    const stands = await shortLifeBan({ trapKill: true });
    const listed = (await findUnqualifiedBans(db)).map((b) => b.id);
    expect(listed).toContain(gone.banId);
    expect(listed).not.toContain(stands.banId); // a trap kill still qualifies the placer's life
    const before = await ban(gone.banId);
    const out: string[] = [];
    const r = await runUnqualifiedBans(db, { lift: false }, { now: NOW, out: (l) => out.push(l), sweepBacklog: caughtUp });
    expect(r.lifted).toBe(0);
    expect(await ban(gone.banId)).toEqual(before);
    expect(out.join("\n")).toContain(`ban ${gone.banId}:`);
    expect(out.join("\n")).toContain("dry-run");
  });

  it("judges a life by the player's kills, not the name: a rename after the ban does not list it", async () => {
    const stands = await shortLifeBan({ trapKill: true });
    expect((await findUnqualifiedBans(db)).map((b) => b.id)).not.toContain(stands.banId);
    const newName = `Renamed ${svc}-${k}`;
    await db.update(players).set({ gamertag: newName }).where(eq(players.id, stands.playerId));
    await db.insert(playerGamertags).values({ playerId: stands.playerId, gamertag: newName, firstSeenAt: hrs(1), lastSeenAt: hrs(1) });
    expect((await findUnqualifiedBans(db)).map((b) => b.id)).not.toContain(stands.banId);
    await runUnqualifiedBans(db, { lift: true }, { now: NOW, out: () => {}, sweepBacklog: caughtUp });
    expect((await ban(stands.banId)).status).toBe("applied");
  });

  it("a kill row with no player id is matched by the name on it, ignoring case; never another player's kill", async () => {
    const byName = await shortLifeBan({ startH: 6 });
    await db.insert(kills).values({ serverId, killerGamertag: byName.tag.toUpperCase(), killerPlayerId: null, victimGamertag: `V ${svc}-${k}`,
      occurredAt: hrs(6.01), weapon: "M4A1", basis: "kill_line" });
    const other = await shortLifeBan({ startH: 7 });
    // Another player's kill logged under this player's name: the id decides.
    const [x] = await db.insert(players).values({ gamertag: `Other ${svc}-${k}` }).returning();
    pids.push(x!.id);
    await db.insert(kills).values({ serverId, killerGamertag: other.tag, killerPlayerId: x!.id, victimGamertag: `W ${svc}-${k}`,
      occurredAt: hrs(7.01), weapon: "M4A1", basis: "kill_line" });
    const listed = (await findUnqualifiedBans(db)).map((b) => b.id);
    expect(listed).not.toContain(byName.banId);
    expect(listed).toContain(other.banId);
  });

  it("--lift sets an applied ban to lift_pending and a pending one to lifted, with lift_reason operator", async () => {
    const applied = await shortLifeBan();
    const pending = await shortLifeBan({ status: "pending" });
    await runUnqualifiedBans(db, { lift: true }, { now: NOW, out: () => {}, sweepBacklog: caughtUp });
    expect(await ban(applied.banId)).toMatchObject({ status: "lift_pending", liftReason: "operator", liftedAt: null });
    expect(await ban(pending.banId)).toMatchObject({ status: "lifted", liftReason: "operator", liftedAt: NOW });
    expect((await findUnqualifiedBans(db)).map((b) => b.id)).not.toContain(applied.banId);
  });

  it("refuses while the verdict queue is not empty, and changes nothing", async () => {
    const b = await shortLifeBan();
    await db.insert(deathVerdictQueue).values({ lifeId: b.lifeId });
    try {
      await expect(runUnqualifiedBans(db, { lift: true }, { now: NOW, out: () => {} })).rejects.toBeInstanceOf(SweepNotCaughtUpError);
      await expect(runUnqualifiedBans(db, { lift: true }, { now: NOW, out: () => {}, sweepBacklog: async () => ({ queued: 0, unswept: 3, foldBehind: false }) }))
        .rejects.toThrow(/has not caught up/);
      expect((await ban(b.banId)).status).toBe("applied");
    } finally {
      await db.delete(deathVerdictQueue).where(eq(deathVerdictQueue.lifeId, b.lifeId));
    }
  });

  it("the lift does not call removeBans while the player has another applied ban", async () => {
    // The player's earlier short life lost its trap kill; a later life of theirs is still banned.
    const tag = `Two Bans ${svc}`;
    const gone = await shortLifeBan({ tag, startH: 1 });
    const later = hrs(2);
    const [l2] = await db.insert(lives).values({ serverId, playerId: gone.playerId, lifeNumber: 2, startedAt: later, endedAt: hrs(3), deathCause: "infected", playtimeSeconds: 3600 }).returning();
    expect(l2).toBeTruthy();
    const [other] = await db.insert(bans).values({ serverId, gamertag: tag, dayzId: gone.dayzId, lifeStartedAt: later, reason: "qualified_death",
      qualifiedBy: "playtime", bannedAt: hrs(3), expiresAt: hrs(27), status: "applied", dryRun: false }).returning();
    await runUnqualifiedBans(db, { lift: true }, { now: NOW, out: () => {}, sweepBacklog: caughtUp });
    expect((await ban(gone.banId)).status).toBe("lift_pending");
    expect((await ban(Number(other!.id))).status).toBe("applied");

    const calls = { remove: [] as string[][] };
    const client: BanClient = { async addBans() {}, async removeBans(names) { calls.remove.push(names); } };
    await enforcerTick(db, { nitradoFor: () => client, dryRun: false, banDurationHours: 24, now: NOW, log: { info: () => {}, error: () => {} } });
    expect(calls.remove.flat()).not.toContain(tag);
    expect(calls.remove.flat()).not.toContain(gone.dayzId);
    expect(await ban(gone.banId)).toMatchObject({ status: "lifted", liftReason: "operator" });
    expect((await ban(Number(other!.id))).status).toBe("applied");
  });
});
