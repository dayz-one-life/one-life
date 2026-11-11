import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { servers, players, lives, kills, bans } from "@onelife/db";
import { and, eq, inArray } from "drizzle-orm";
import { getTestDb } from "@onelife/test-support";
import { enforcerTick, type BanClient } from "../src/tick.js";

// A death the enforcer only gets to judge long after it happened, through a real tick with
// ENFORCER_DRY_RUN=false. Invented data.
//
// The way it arises: a `kills` row that qualifies an old short life turns up later (a rebuild
// with a parser that reads a line the old one skipped; the two-second posthumous-kill grace is
// what lets such a row count). The player has since died again and is serving that ban.
//
//   LB Old   life 1  07-10 10:00 - 10:03  explosion, 180 s   kill row for 10:03:01 appears later
//            life 2  07-20 10:00 - 11:00  pvp                ban applied, 23 h left at `now`
//   LB Twice two applied bans at once: one due, one with hours left
//   LB Renamed (id LBX1) one due ban under the old name, one running ban under "LB Newname"
//
// Each case removes its own rows, so the row counts tick.test.ts asserts are untouched.
const { db, sql } = getTestDb();
const log = { info: () => {}, error: () => {} };
const NOW = new Date("2026-07-20T12:00:00Z");
const H = 3600_000;
let serverId: number;
const playerIds: number[] = [];

function fakeNitrado() {
  const calls: string[] = [];
  const client: BanClient = {
    async addBans(names) { calls.push(`add ${names.join(",")}`); },
    async removeBans(names) { calls.push(`remove ${names.join(",")}`); },
  };
  return { calls, nitradoFor: (_sid: number) => client };
}
/** Only this file's players: other suites leave rows of their own in the shared database. */
const mine = (calls: string[]) => calls.filter((c) => c.includes("LB"));
const tick = (fake: ReturnType<typeof fakeNitrado>, now: Date) =>
  enforcerTick(db, { nitradoFor: fake.nitradoFor, dryRun: false, banDurationHours: 24, now, log });
const myBans = () => db.select().from(bans).where(eq(bans.serverId, serverId)).orderBy(bans.id);

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: 555078, name: "enf-late-ban" }).returning();
  serverId = s!.id;
});
afterAll(async () => {
  await db.delete(bans).where(eq(bans.serverId, serverId));
  await db.delete(kills).where(eq(kills.serverId, serverId));
  await db.delete(lives).where(eq(lives.serverId, serverId));
  if (playerIds.length > 0) await db.delete(players).where(inArray(players.id, playerIds));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

describe("enforcerTick — a qualifying kill row that appears for a death long past", () => {
  it("records no ban, sends nothing to Nitrado, and leaves the ban being served in place", async () => {
    const [p] = await db.insert(players).values({ gamertag: "LB Old", dayzId: "LBOLD1" }).returning();
    playerIds.push(Number(p!.id));
    const old0 = new Date("2026-07-10T10:00:00Z"), old1 = new Date("2026-07-10T10:03:00Z");
    const cur0 = new Date("2026-07-20T10:00:00Z"), cur1 = new Date("2026-07-20T11:00:00Z");
    await db.insert(lives).values([
      { serverId, playerId: p!.id, lifeNumber: 1, startedAt: old0, endedAt: old1, deathCause: "explosion", playtimeSeconds: 180 },
      { serverId, playerId: p!.id, lifeNumber: 2, startedAt: cur0, endedAt: cur1, deathCause: "pvp", playtimeSeconds: 3600 },
    ]);
    await db.insert(bans).values({
      serverId, gamertag: "LB Old", dayzId: "LBOLD1", lifeStartedAt: cur0, reason: "qualified_death",
      qualifiedBy: "pvp-death", bannedAt: cur1, expiresAt: new Date(cur1.getTime() + 24 * H),
      status: "applied", dryRun: false, appliedAt: cur1,
    });

    const before = fakeNitrado();
    await tick(before, NOW);
    expect(mine(before.calls)).toEqual([]);

    // The kill line stamped one second after the old death now exists.
    await db.insert(kills).values({
      serverId, killerGamertag: "LB Old", killerPlayerId: p!.id, victimGamertag: "v", occurredAt: new Date(old1.getTime() + 1000),
    });
    const after = fakeNitrado();
    await tick(after, NOW);

    expect(mine(after.calls)).toEqual([]); // no add, and above all no remove
    const rows = (await myBans()).filter((b) => b.gamertag === "LB Old");
    expect(rows).toHaveLength(1);           // no ban row for the old death: nothing to notify
    expect(rows[0]).toMatchObject({ status: "applied", liftedAt: null });
    expect(rows[0]!.lifeStartedAt).toEqual(cur0);

    await db.delete(bans).where(and(eq(bans.serverId, serverId), eq(bans.gamertag, "LB Old")));
    await db.delete(kills).where(eq(kills.serverId, serverId));
    await db.delete(lives).where(eq(lives.serverId, serverId));
  });
});

describe("enforcerTick — a ban expiring while the same player has another still running", () => {
  it("marks it expired without taking the player off the Nitrado list, then removes them when the last one ends", async () => {
    const [p] = await db.insert(players).values({ gamertag: "LB Twice", dayzId: "LBTW1" }).returning();
    playerIds.push(Number(p!.id));
    const first = new Date("2026-07-19T11:00:00Z");   // expires 07-20 11:00: due at NOW
    const second = new Date("2026-07-20T10:00:00Z");  // expires 07-21 10:00: 22 h left at NOW
    await db.insert(bans).values([
      { serverId, gamertag: "LB Twice", dayzId: "LBTW1", lifeStartedAt: new Date(first.getTime() - H), reason: "qualified_death", bannedAt: first, expiresAt: new Date(first.getTime() + 24 * H), status: "applied", dryRun: false, appliedAt: first },
      { serverId, gamertag: "LB Twice", dayzId: "LBTW1", lifeStartedAt: new Date(second.getTime() - H / 2), reason: "qualified_death", bannedAt: second, expiresAt: new Date(second.getTime() + 24 * H), status: "applied", dryRun: false, appliedAt: second },
    ]);

    const fake = fakeNitrado();
    await tick(fake, NOW);
    expect(mine(fake.calls)).toEqual([]);
    let rows = (await myBans()).filter((b) => b.gamertag === "LB Twice");
    expect(rows.map((b) => b.status)).toEqual(["expired", "applied"]);
    expect(rows[0]!.liftedAt).toEqual(NOW);

    const later = fakeNitrado();
    await tick(later, new Date("2026-07-21T10:00:00Z"));
    expect(mine(later.calls)).toEqual(["remove LBTW1,LB Twice"]);
    rows = (await myBans()).filter((b) => b.gamertag === "LB Twice");
    expect(rows.map((b) => b.status)).toEqual(["expired", "expired"]);

    await db.delete(bans).where(and(eq(bans.serverId, serverId), eq(bans.gamertag, "LB Twice")));
  });

  it("after a rename, removes only the old name and keeps the account id banned", async () => {
    const first = new Date("2026-07-19T11:00:00Z");
    const second = new Date("2026-07-20T10:00:00Z");
    await db.insert(bans).values([
      { serverId, gamertag: "LB Renamed", dayzId: "LBX1", lifeStartedAt: new Date(first.getTime() - H), reason: "qualified_death", bannedAt: first, expiresAt: new Date(first.getTime() + 24 * H), status: "applied", dryRun: false, appliedAt: first },
      { serverId, gamertag: "LB Newname", dayzId: "LBX1", lifeStartedAt: new Date(second.getTime() - H / 2), reason: "qualified_death", bannedAt: second, expiresAt: new Date(second.getTime() + 24 * H), status: "applied", dryRun: false, appliedAt: second },
    ]);
    const fake = fakeNitrado();
    await tick(fake, NOW);
    expect(mine(fake.calls)).toEqual(["remove LB Renamed"]);
    const rows = (await myBans()).filter((b) => b.dayzId === "LBX1");
    expect(rows.map((b) => b.status)).toEqual(["expired", "applied"]);
    await db.delete(bans).where(and(eq(bans.serverId, serverId), eq(bans.dayzId, "LBX1")));
  });

  it("two bans of one player that are both due are both removed", async () => {
    const first = new Date("2026-07-19T10:00:00Z");
    const second = new Date("2026-07-19T11:00:00Z");
    await db.insert(bans).values([
      { serverId, gamertag: "LB Both", dayzId: null, lifeStartedAt: new Date(first.getTime() - H), reason: "qualified_death", bannedAt: first, expiresAt: new Date(first.getTime() + 24 * H), status: "applied", dryRun: false, appliedAt: first },
      { serverId, gamertag: "LB Both", dayzId: null, lifeStartedAt: new Date(second.getTime() - H / 2), reason: "qualified_death", bannedAt: second, expiresAt: new Date(second.getTime() + 24 * H), status: "applied", dryRun: false, appliedAt: second },
    ]);
    const fake = fakeNitrado();
    await tick(fake, NOW);
    expect(mine(fake.calls)).toEqual(["remove LB Both", "remove LB Both"]);
    const rows = (await myBans()).filter((b) => b.gamertag === "LB Both");
    expect(rows.map((b) => b.status)).toEqual(["expired", "expired"]);
  });
});

describe("enforcerTick — a ban with no expiry", () => {
  it("keeps the player's names on the list when another ban of theirs ends", async () => {
    // ⚠️ invented player. No code writes a null expiry; an operator's hand-inserted permanent ban does.
    const first = new Date("2026-07-19T11:00:00Z");
    await db.insert(bans).values([
      { serverId, gamertag: "LB Perm", dayzId: "LBPM1", lifeStartedAt: new Date(first.getTime() - H), reason: "qualified_death", bannedAt: first, expiresAt: new Date(first.getTime() + 24 * H), status: "applied", dryRun: false, appliedAt: first },
      { serverId, gamertag: "LB Perm", dayzId: "LBPM1", lifeStartedAt: new Date(first.getTime() - 2 * H), reason: "operator", bannedAt: first, expiresAt: null, status: "applied", dryRun: false, appliedAt: first },
    ]);
    const fake = fakeNitrado();
    await tick(fake, NOW);
    expect(mine(fake.calls)).toEqual([]);
    const rows = (await myBans()).filter((b) => b.dayzId === "LBPM1");
    expect(rows.map((b) => b.status)).toEqual(["expired", "applied"]);
    await db.delete(bans).where(and(eq(bans.serverId, serverId), eq(bans.dayzId, "LBPM1")));
  });
});

describe("enforcerTick — a player renamed after his ban was recorded", () => {
  it("does not ban the same death again under the new name", async () => {
    const [p] = await db.insert(players).values({ gamertag: "LB OldTag", dayzId: "LBRN4" }).returning();
    playerIds.push(Number(p!.id));
    const s0 = new Date("2026-07-20T10:00:00Z"), s1 = new Date("2026-07-20T11:00:00Z");
    await db.insert(lives).values({ serverId, playerId: p!.id, lifeNumber: 1, startedAt: s0, endedAt: s1, deathCause: "pvp", playtimeSeconds: 3600 });
    const first = fakeNitrado();
    await tick(first, NOW);
    expect(mine(first.calls)).toEqual(["add LBRN4,LB OldTag"]);

    await db.update(players).set({ gamertag: "LB NewTag" }).where(eq(players.id, p!.id));
    const second = fakeNitrado();
    await tick(second, NOW);
    expect(mine(second.calls)).toEqual([]);
    expect((await myBans()).filter((b) => b.dayzId === "LBRN4")).toHaveLength(1);

    await db.delete(bans).where(and(eq(bans.serverId, serverId), eq(bans.dayzId, "LBRN4")));
    await db.delete(lives).where(eq(lives.serverId, serverId));
  });
});

// A row that is still `pending` when its time runs out: Nitrado kept failing, or the enforcer
// was switched from dry-run to enforcing with old rows on the books.
describe("enforcerTick — a pending ban whose time is already up", () => {
  it("is closed as expired without ever being sent to Nitrado", async () => {
    const died = new Date("2026-07-18T11:00:00Z"); // expired 07-19 11:00, a day before NOW
    await db.insert(bans).values([
      { serverId, gamertag: "LB Stale", dayzId: "LBST1", lifeStartedAt: new Date(died.getTime() - H), reason: "qualified_death", bannedAt: died, expiresAt: new Date(died.getTime() + 24 * H), status: "pending", dryRun: false },
      { serverId, gamertag: "LB Fresh", dayzId: "LBFR1", lifeStartedAt: new Date(NOW.getTime() - 2 * H), reason: "qualified_death", bannedAt: new Date(NOW.getTime() - H), expiresAt: new Date(NOW.getTime() + 23 * H), status: "pending", dryRun: false },
    ]);
    const fake = fakeNitrado();
    const r = await tick(fake, NOW);
    expect(mine(fake.calls)).toEqual(["add LBFR1,LB Fresh"]);
    const rows = await myBans();
    expect(rows.find((b) => b.gamertag === "LB Stale")).toMatchObject({ status: "expired", appliedAt: null, liftedAt: NOW });
    expect(rows.find((b) => b.gamertag === "LB Fresh")).toMatchObject({ status: "applied", liftedAt: null });
    expect(r.applied).toBeGreaterThanOrEqual(1);
  });

  it("dry-run leaves it pending, as it leaves every ban", async () => {
    const died = new Date("2026-07-18T11:00:00Z");
    await db.insert(bans).values({
      serverId, gamertag: "LB DryStale", dayzId: null, lifeStartedAt: new Date(died.getTime() - H), reason: "qualified_death", bannedAt: died, expiresAt: new Date(died.getTime() + 24 * H), status: "pending", dryRun: true,
    });
    const fake = fakeNitrado();
    await enforcerTick(db, { nitradoFor: fake.nitradoFor, dryRun: true, banDurationHours: 24, now: NOW, log });
    expect(fake.calls).toEqual([]);
    expect((await myBans()).find((b) => b.gamertag === "LB DryStale")).toMatchObject({ status: "pending", liftedAt: null });
  });
});
