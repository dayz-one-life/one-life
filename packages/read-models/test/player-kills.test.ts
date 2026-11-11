import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, kills } from "@onelife/db";
import { eq, inArray } from "drizzle-orm";
import { getLifeKills } from "../src/player-kills.js";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 46e7;
let serverId: number;
let sniperId: number;
// Two players can hold one gamertag at once (a recycled name whose previous holder has not
// reconnected). Each has one kill inside the same window.
let dupOldId: number;
let dupNewId: number;
const start = new Date("2026-07-14T10:00:00Z");
const end = new Date("2026-07-14T14:00:00Z");

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "rm-kills" }).returning();
  serverId = s!.id;
  const [sniper] = await db.insert(players).values({ gamertag: "Sniper", firstSeenAt: start, lastSeenAt: end }).returning();
  const sid = sniper!.id;
  sniperId = Number(sid);
  const [dupOld] = await db.insert(players).values({ gamertag: "PK Dup", firstSeenAt: start, lastSeenAt: start }).returning();
  const [dupNew] = await db.insert(players).values({ gamertag: "PK Dup", firstSeenAt: start, lastSeenAt: end }).returning();
  dupOldId = Number(dupOld!.id);
  dupNewId = Number(dupNew!.id);
  await db.insert(kills).values([
    { serverId, killerGamertag: "Sniper", killerPlayerId: sid, victimGamertag: "early", weapon: "Mosin", distance: 50, occurredAt: new Date("2026-07-14T09:00:00Z") }, // before window
    { serverId, killerGamertag: "Sniper", killerPlayerId: sid, victimGamertag: "a", weapon: "SVD", distance: 312, occurredAt: new Date("2026-07-14T11:00:00Z") },
    { serverId, killerGamertag: "Sniper", killerPlayerId: sid, victimGamertag: "b", weapon: "M4A1", distance: 45, occurredAt: new Date("2026-07-14T13:00:00Z") },
    { serverId, killerGamertag: "PK Dup", killerPlayerId: dupOldId, victimGamertag: "old-holder", weapon: "BK-18", distance: 5, occurredAt: new Date("2026-07-14T11:30:00Z") },
    { serverId, killerGamertag: "PK Dup", killerPlayerId: dupNewId, victimGamertag: "new-holder", weapon: "BK-18", distance: 6, occurredAt: new Date("2026-07-14T12:30:00Z") },
    { serverId, killerGamertag: "Other", victimGamertag: "c", weapon: "KA-M", distance: 10, occurredAt: new Date("2026-07-14T12:00:00Z") }, // other killer
  ]);
});
afterAll(async () => {
  await db.delete(kills).where(eq(kills.serverId, serverId));
  await db.delete(players).where(inArray(players.id, [sniperId, dupOldId, dupNewId]));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

describe("getLifeKills", () => {
  it("returns this-life kills in the window, newest first", async () => {
    const rows = await getLifeKills(db, serverId, sniperId, start, end);
    expect(rows.map((r) => r.victimGamertag)).toEqual(["b", "a"]);
    expect(rows[0]).toMatchObject({ weapon: "M4A1", distanceMeters: 45 });
  });
  it("every row carries its basis", async () => {
    const rows = await getLifeKills(db, serverId, sniperId, start, end);
    expect(rows.map((r) => r.basis)).toEqual(["kill_line", "kill_line"]);
  });
  it("treats a null endedAt as open-ended", async () => {
    const rows = await getLifeKills(db, serverId, sniperId, start, null);
    expect(rows.length).toBe(2);
  });
  it("takes the player, not a name: two players who share a gamertag each get their own kills", async () => {
    expect((await getLifeKills(db, serverId, dupOldId, start, end)).map((r) => r.victimGamertag)).toEqual(["old-holder"]);
    expect((await getLifeKills(db, serverId, dupNewId, start, end)).map((r) => r.victimGamertag)).toEqual(["new-holder"]);
  });
});
