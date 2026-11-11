import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { user, servers, players, lives, kills, gamertagLinks } from "@onelife/db";
import { eq, inArray } from "drizzle-orm";
import { getTestDb } from "@onelife/test-support";
import { lifeQualifiedGenerator } from "../src/generators/lives.js";

// The two-second posthumous-kill grace (read-models kill-window.ts) as the notifier sees it.
// Invented data. Both players died at 10:03:00 and were back at 10:03:01 on a new life with no
// playtime yet, so a kill is the only thing that can qualify it.
//
//   GraceBack  kill logged 10:03:02: inside the dead life's two seconds  -> life 2 says nothing
//   GraceOwn   kill logged 10:03:30: the new life's own                  -> life 2 "counts now"
//
// This file removes its own rows: generators-lives.test.ts counts every draft in the database.
const { db, sql } = getTestDb();
const NOW = new Date("2026-07-19T12:00:00Z");
const T = (hms: string) => new Date(`2026-07-19T${hms}Z`);
const deps = { db, now: NOW, since: new Date("2026-06-01T00:00:00Z"), lookbackHours: 48, siteUrl: "https://s" };
let serverId: number;
const playerIds: number[] = [];

beforeAll(async () => {
  await db.insert(user).values([
    { id: "kg1", name: "KG1", email: "kg1@x.com" },
    { id: "kg2", name: "KG2", email: "kg2@x.com" },
  ]);
  const [s] = await db.insert(servers).values({ nitradoServiceId: 992077, name: "gracesrv", slug: "gracesrv" }).returning();
  serverId = s!.id;
  for (const [gamertag, userId, killAt] of [["GraceBack", "kg1", "10:03:02"], ["GraceOwn", "kg2", "10:03:30"]] as const) {
    const [p] = await db.insert(players).values({ gamertag, lastSeenAt: NOW }).returning();
    playerIds.push(Number(p!.id));
    await db.insert(gamertagLinks).values({ userId, gamertag, status: "verified", verifiedAt: new Date("2026-06-02T00:00:00Z") });
    await db.insert(lives).values([
      { serverId, playerId: p!.id, lifeNumber: 1, startedAt: T("10:00:00"), endedAt: T("10:03:00"), deathCause: "explosion", playtimeSeconds: 180 },
      { serverId, playerId: p!.id, lifeNumber: 2, startedAt: T("10:03:01"), playtimeSeconds: 0 },
    ]);
    await db.insert(kills).values({ serverId, killerGamertag: gamertag, killerPlayerId: p!.id, victimGamertag: "v", occurredAt: T(killAt) });
  }
});
afterAll(async () => {
  await db.delete(kills).where(eq(kills.serverId, serverId));
  await db.delete(lives).where(eq(lives.serverId, serverId));
  await db.delete(gamertagLinks).where(inArray(gamertagLinks.userId, ["kg1", "kg2"]));
  await db.delete(players).where(inArray(players.id, playerIds));
  await db.delete(servers).where(eq(servers.id, serverId));
  await db.delete(user).where(inArray(user.id, ["kg1", "kg2"]));
  await sql.end();
});

describe("lifeQualifiedGenerator — a kill logged just after the player's previous death", () => {
  it("does not announce the new life as qualified on the strength of the dead life's kill", async () => {
    const drafts = await lifeQualifiedGenerator(deps);
    expect(drafts.filter((d) => d.userId === "kg1")).toEqual([]);
  });
  it("announces a new life that scored a kill of its own", async () => {
    const drafts = await lifeQualifiedGenerator(deps);
    const own = drafts.filter((d) => d.userId === "kg2");
    expect(own).toHaveLength(1);
    expect(own[0]!.body).toBe("gracesrv: life 2 is qualified. Dying costs you 24 hours.");
  });
});
