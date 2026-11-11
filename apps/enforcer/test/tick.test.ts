import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { servers, players, lives, bans, kills } from "@onelife/db";
import { eq } from "drizzle-orm";
import { getTestDb } from "@onelife/test-support";
import { enforcerTick, type BanClient } from "../src/tick.js";

const { db, sql } = getTestDb();

function fakeNitrado() {
  const calls = { add: [] as string[][], remove: [] as string[][] };
  const client: BanClient = {
    async addBans(names) { calls.add.push(names); },
    async removeBans(names) { calls.remove.push(names); },
  };
  return { calls, nitradoFor: (_sid: number) => client };
}
const log = { info: () => {}, error: () => {} };

let serverId: number;
const STARTED = new Date("2026-07-11T10:00:00Z");
const ENDED = new Date("2026-07-11T12:00:00Z");

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: 555001, name: "enf" }).returning();
  serverId = s!.id;
  const [p] = await db.insert(players)
    .values({ gamertag: "Steveo12491", dayzId: "ABC123" }).returning();
  await db.insert(lives).values({
    serverId, playerId: p!.id, lifeNumber: 1, startedAt: STARTED, endedAt: ENDED,
    deathCause: "infected", playtimeSeconds: 400, // qualified: >= 300s
  });
  const [p2] = await db.insert(players).values({ gamertag: "ShortLived" }).returning();
  await db.insert(lives).values({
    serverId, playerId: p2!.id, lifeNumber: 1, startedAt: STARTED, endedAt: ENDED,
    deathCause: "infected", playtimeSeconds: 100, // unqualified: < 300s, no kill, non-pvp
  });
  // A player the ADM never gave an id for — its ban must still be created, and must
  // enforce name-only rather than writing a blank entry to the ban list.
  const [p3] = await db.insert(players).values({ gamertag: "NoIdPlayer" }).returning();
  await db.insert(lives).values({
    serverId, playerId: p3!.id, lifeNumber: 1, startedAt: STARTED, endedAt: ENDED,
    deathCause: "infected", playtimeSeconds: 400, // qualified
  });
});
afterAll(async () => { await sql.end(); });

describe("enforcerTick", () => {
  it("dry-run: records the qualified ban as pending, does NOT call Nitrado, skips unqualified", async () => {
    const fake = fakeNitrado();
    const r = await enforcerTick(db, {
      nitradoFor: fake.nitradoFor, dryRun: true, banDurationHours: 24,
      now: new Date("2026-07-11T12:05:00Z"), log,
    });
    expect(r.detected).toBe(2);
    expect(fake.calls.add).toEqual([]); // the whole point: no ban applied in dry-run
    const rows = await db.select().from(bans);
    expect(rows).toHaveLength(2);
    const row = rows.find((r) => r.gamertag === "Steveo12491");
    expect(row).toMatchObject({ gamertag: "Steveo12491", status: "pending", dryRun: true, qualifiedBy: "playtime" });
    expect(row!.expiresAt!.toISOString()).toBe("2026-07-12T12:00:00.000Z");
  });

  it("freezes dayz_id onto the ban row at detection, and tolerates a null", async () => {
    const rows = await db.select({ gamertag: bans.gamertag, dayzId: bans.dayzId }).from(bans);
    expect(rows.find((r) => r.gamertag === "Steveo12491")!.dayzId).toBe("ABC123");
    // A player with no id still gets a ban — it just enforces by name alone.
    expect(rows.find((r) => r.gamertag === "NoIdPlayer")!.dayzId).toBeNull();
  });

  it("enforce mode: applies the pending ban to Nitrado", async () => {
    const fake = fakeNitrado();
    const r = await enforcerTick(db, {
      nitradoFor: fake.nitradoFor, dryRun: false, banDurationHours: 24,
      now: new Date("2026-07-11T12:10:00Z"), log,
    });
    expect(r.detected).toBe(0); // already recorded, not re-detected
    // One call per ban, each carrying the id first then the gamertag. NoIdPlayer has no id,
    // so it degrades to name-only rather than writing a blank line into the ban list.
    expect(fake.calls.add).toEqual([["ABC123", "Steveo12491"], ["NoIdPlayer"]]);
    const [row] = await db.select().from(bans).where(eq(bans.gamertag, "Steveo12491"));
    expect(row!.status).toBe("applied");
  });

  it("expires the ban after 24h, removing it from Nitrado", async () => {
    const fake = fakeNitrado();
    // ENDED (2026-07-11T12:00:00Z) + 24h = 2026-07-12T12:00:00Z. now is 30 minutes past that
    // boundary, so both bans applied by the previous test (Steveo12491, NoIdPlayer) are due.
    const r = await enforcerTick(db, {
      nitradoFor: fake.nitradoFor, dryRun: false, banDurationHours: 24,
      now: new Date("2026-07-12T12:30:00Z"), log,
    });
    expect(fake.calls.remove).toEqual([["ABC123", "Steveo12491"], ["NoIdPlayer"]]);
    expect(r.expired).toBe(2);
    const [row] = await db.select().from(bans).where(eq(bans.gamertag, "Steveo12491"));
    expect(row!.status).toBe("expired");
  });

  it("expire removes the id and the gamertag in a single call per ban", async () => {
    // Self-contained: seeds its own already-applied ban rather than relying on state left by
    // an earlier test, so this test's outcome can't be made vacuous by reordering elsewhere.
    const life3Started = new Date("2026-07-15T10:00:00Z");
    const life3Ended = new Date("2026-07-15T12:00:00Z");
    await db.insert(players).values({ gamertag: "ExpireGuy", dayzId: "EXP123" });
    await db.insert(bans).values({
      serverId, gamertag: "ExpireGuy", dayzId: "EXP123",
      lifeStartedAt: life3Started, reason: "qualified_death", bannedAt: life3Ended,
      expiresAt: new Date(life3Ended.getTime() + 24 * 3600_000), status: "applied", dryRun: false,
    });
    const fake = fakeNitrado();
    // Well past life3's expiry (2026-07-16T12:00:00Z); no other applied bans remain at this
    // point in the sequence (the previous test already expired Steveo12491/NoIdPlayer).
    const r = await enforcerTick(db, {
      nitradoFor: fake.nitradoFor, dryRun: false, banDurationHours: 24,
      now: new Date("2026-07-16T13:00:00Z"), log,
    });
    expect(fake.calls.remove).toEqual([["EXP123", "ExpireGuy"]]);
    expect(r.expired).toBe(1);
    const [row] = await db.select().from(bans).where(eq(bans.gamertag, "ExpireGuy"));
    expect(row!.status).toBe("expired");
  });

  it("lift removes the id and the gamertag in a single call", async () => {
    await db.insert(players).values({ gamertag: "Redeemer", dayzId: "XYZ789" });
    await db.insert(bans).values({
      serverId, gamertag: "Redeemer", dayzId: "XYZ789",
      lifeStartedAt: STARTED, reason: "qualified_death", bannedAt: ENDED,
      expiresAt: new Date("2026-07-30T00:00:00Z"), status: "lift_pending", dryRun: false,
    });
    const fake = fakeNitrado();
    await enforcerTick(db, {
      nitradoFor: fake.nitradoFor, dryRun: false, banDurationHours: 24,
      now: new Date("2026-07-13T13:00:00Z"), log,
    });
    expect(fake.calls.remove).toContainEqual(["XYZ789", "Redeemer"]);
  });
});

describe("enforcerTick — lift_pending (token redemption)", () => {
  it("dry-run: marks lifted without calling Nitrado", async () => {
    const L = new Date("2026-07-20T10:00:00Z");
    await db.insert(bans).values({ serverId, gamertag: "Steveo12491", lifeStartedAt: L, reason: "qualified_death", bannedAt: L, status: "lift_pending", dryRun: true });
    const fake = fakeNitrado();
    const r = await enforcerTick(db, { nitradoFor: fake.nitradoFor, dryRun: true, banDurationHours: 24, now: new Date("2026-07-20T11:00:00Z"), log });
    expect(fake.calls.remove).toEqual([]);
    expect(r.lifted).toBe(1);
    const [b] = await db.select().from(bans).where(eq(bans.lifeStartedAt, L));
    expect(b!.status).toBe("lifted");
  });

  it("enforce: removes the redeemed ban from Nitrado and marks lifted", async () => {
    const L = new Date("2026-07-21T10:00:00Z");
    await db.insert(bans).values({ serverId, gamertag: "Steveo12491", lifeStartedAt: L, reason: "qualified_death", bannedAt: L, status: "lift_pending", dryRun: false });
    const fake = fakeNitrado();
    const r = await enforcerTick(db, { nitradoFor: fake.nitradoFor, dryRun: false, banDurationHours: 24, now: new Date("2026-07-21T11:00:00Z"), log });
    // This row was inserted directly (no dayzId set), so it degrades to name-only.
    expect(fake.calls.remove).toContainEqual(["Steveo12491"]);
    expect(r.lifted).toBe(1);
    const [b] = await db.select().from(bans).where(eq(bans.lifeStartedAt, L));
    expect(b!.status).toBe("lifted");
  });
});

describe("enforcerTick — two bans of one player share the server's name entry", () => {
  // ⚠️ Invented players. The ban list holds names, not bans: removing the names for one ban lifts
  // every ban of that player.
  let sid2: number;
  const H = 3600_000;
  const T1 = new Date("2026-09-01T12:00:00Z");
  async function ban(gamertag: string, dayzId: string | null, startedAt: Date, expiresAt: Date, status = "applied", dryRun = false) {
    await db.insert(bans).values({
      serverId: sid2, gamertag, dayzId, lifeStartedAt: startedAt, reason: "qualified_death", bannedAt: new Date(expiresAt.getTime() - 24 * H),
      expiresAt, status, dryRun,
    });
  }
  const tick = (now: Date) => {
    const fake = fakeNitrado();
    return enforcerTick(db, { nitradoFor: fake.nitradoFor, dryRun: false, banDurationHours: 24, now, log }).then((r) => ({ r, fake }));
  };
  beforeAll(async () => {
    const [s] = await db.insert(servers).values({ nitradoServiceId: 555002, name: "enf-siblings" }).returning();
    sid2 = s!.id;
  });

  it("an expiring ban does not call removeBans while the same player has a later applied ban", async () => {
    await ban("Sibling One", "S1S1", new Date("2026-08-30T00:00:00Z"), T1);
    await ban("Sibling One", "S1S1", new Date("2026-08-31T00:00:00Z"), new Date(T1.getTime() + 10 * H));
    const { r, fake } = await tick(new Date(T1.getTime() + H));
    expect(r.expired).toBe(1);
    expect(fake.calls.remove).not.toContainEqual(["S1S1", "Sibling One"]);
    const rows = await db.select().from(bans).where(eq(bans.gamertag, "Sibling One")).orderBy(bans.id);
    expect(rows.map((b) => b.status)).toEqual(["expired", "applied"]);
  });

  it("the later ban's expiry does call it", async () => {
    const { r, fake } = await tick(new Date(T1.getTime() + 11 * H));
    expect(r.expired).toBe(1);
    expect(fake.calls.remove).toContainEqual(["S1S1", "Sibling One"]);
  });

  it("a lifted ban does not call removeBans while a sibling is applied", async () => {
    await ban("Sibling Two", "S2S2", new Date("2026-08-30T00:00:00Z"), new Date(T1.getTime() + 5 * H), "lift_pending");
    await ban("Sibling Two", "S2S2", new Date("2026-08-31T00:00:00Z"), new Date(T1.getTime() + 20 * H));
    const { r, fake } = await tick(new Date(T1.getTime() + 2 * H));
    expect(r.lifted).toBe(1);
    expect(fake.calls.remove).not.toContainEqual(["S2S2", "Sibling Two"]);
    const rows = await db.select().from(bans).where(eq(bans.gamertag, "Sibling Two")).orderBy(bans.id);
    expect(rows.map((b) => b.status)).toEqual(["lifted", "applied"]);
  });

  it("a sibling under a different gamertag but the same dayz id counts", async () => {
    await ban("Old Name Three", "S3S3", new Date("2026-08-30T00:00:00Z"), new Date(T1.getTime() + 3 * H));
    await ban("New Name Three", "S3S3", new Date("2026-08-31T00:00:00Z"), new Date(T1.getTime() + 30 * H));
    const { fake } = await tick(new Date(T1.getTime() + 4 * H));
    expect(fake.calls.remove).not.toContainEqual(["S3S3", "Old Name Three"]);
    const [old] = await db.select().from(bans).where(eq(bans.gamertag, "Old Name Three"));
    expect(old!.status).toBe("expired");
  });

  it("a dry-run sibling does not count", async () => {
    await ban("Sibling Four", "S4S4", new Date("2026-08-30T00:00:00Z"), new Date(T1.getTime() + 3 * H));
    await ban("Sibling Four", "S4S4", new Date("2026-08-31T00:00:00Z"), new Date(T1.getTime() + 40 * H), "pending", true);
    const { fake } = await tick(new Date(T1.getTime() + 4 * H));
    expect(fake.calls.remove).toContainEqual(["S4S4", "Sibling Four"]);
  });

  it("planBans skips a life whose ban would already have ended", async () => {
    const [p] = await db.insert(players).values({ gamertag: "Late Five", dayzId: "L5L5" }).returning();
    await db.insert(lives).values({
      serverId: sid2, playerId: p!.id, lifeNumber: 1, startedAt: new Date("2026-08-01T10:00:00Z"),
      endedAt: new Date("2026-08-01T12:00:00Z"), deathCause: "infected", playtimeSeconds: 4000,
    });
    await tick(new Date(T1.getTime() + 50 * H));
    expect(await db.select().from(bans).where(eq(bans.gamertag, "Late Five"))).toHaveLength(0);
  });

  it("a trap_placement row qualifies an ended 60-second life exactly as a kill_line row does", async () => {
    const start = new Date(T1.getTime() + 60 * H);
    const end = new Date(start.getTime() + 60_000);
    for (const [name, basis] of [["Line Six", "kill_line"], ["Trap Seven", "trap_placement"]] as const) {
      const [p] = await db.insert(players).values({ gamertag: name, dayzId: name === "Line Six" ? "K6K6" : "K7K7" }).returning();
      await db.insert(lives).values({ serverId: sid2, playerId: p!.id, lifeNumber: 1, startedAt: start, endedAt: end, deathCause: "infected", playtimeSeconds: 60 });
      await db.insert(kills).values({
        serverId: sid2, killerGamertag: name, killerPlayerId: p!.id, victimGamertag: "Someone Else", victimLifeId: 900000 + p!.id,
        weapon: basis === "kill_line" ? "M4-A1" : "Tripwire", occurredAt: new Date(start.getTime() + 30_000),
        basis, creditSource: basis === "kill_line" ? null : "classifier",
      });
    }
    await tick(new Date(end.getTime() + 60_000));
    const rows = await db.select().from(bans).where(eq(bans.serverId, sid2));
    const of = (g: string) => rows.find((b) => b.gamertag === g);
    expect(of("Line Six")).toMatchObject({ qualifiedBy: "kill" });
    expect(of("Trap Seven")).toMatchObject({ qualifiedBy: "kill" });
  });
});
