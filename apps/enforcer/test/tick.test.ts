import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { servers, players, lives, bans } from "@onelife/db";
import { eq } from "drizzle-orm";
import { getTestDb } from "@onelife/test-support";
import { enforcerTick, type BanClient } from "../src/tick.js";

const { db, sql } = getTestDb();

function fakeNitrado() {
  const calls = { add: [] as string[], remove: [] as string[] };
  const client: BanClient = {
    async addBan(g) { calls.add.push(g); },
    async removeBan(g) { calls.remove.push(g); },
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
    // NoIdPlayer's ban shares the same detection window, so it's applied alongside Steveo12491.
    expect(fake.calls.add).toEqual(["Steveo12491", "NoIdPlayer"]);
    const [row] = await db.select().from(bans).where(eq(bans.gamertag, "Steveo12491"));
    expect(row!.status).toBe("applied");
  });

  it("expires the ban after 24h, removing it from Nitrado", async () => {
    const fake = fakeNitrado();
    const r = await enforcerTick(db, {
      nitradoFor: fake.nitradoFor, dryRun: false, banDurationHours: 24,
      now: new Date("2026-07-12T12:30:00Z"), log,
    });
    // NoIdPlayer's ban shares the same expiry window, so it expires alongside Steveo12491.
    expect(fake.calls.remove).toEqual(["Steveo12491", "NoIdPlayer"]);
    expect(r.expired).toBe(2);
    const [row] = await db.select().from(bans).where(eq(bans.gamertag, "Steveo12491"));
    expect(row!.status).toBe("expired");
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
    expect(fake.calls.remove).toContain("Steveo12491");
    expect(r.lifted).toBe(1);
    const [b] = await db.select().from(bans).where(eq(bans.lifeStartedAt, L));
    expect(b!.status).toBe("lifted");
  });
});
