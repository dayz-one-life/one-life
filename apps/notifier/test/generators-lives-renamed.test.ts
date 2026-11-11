import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { user, servers, players, lives, kills, gamertagLinks } from "@onelife/db";
import { eq, inArray } from "drizzle-orm";
import { getTestDb } from "@onelife/test-support";
import { lifeQualifiedGenerator } from "../src/generators/lives.js";

// A kill is matched to its killer by player id, as the notifier sees it. Invented data. Each
// player has one open life with no playtime, so a kill is the only thing that can qualify it.
//
//   RN Newname  (was "RN Oldname")  kill logged under the old name, his id   -> "counts now"
//   RN Oldname  (took the name)     no kill of his own                        -> says nothing
//   RN Ghost                        a row with NO id, his name in other case  -> "counts now"
//
// This file removes its own rows: generators-lives.test.ts counts every draft in the database.
const { db, sql } = getTestDb();
const NOW = new Date("2026-07-19T12:00:00Z");
const T = (hms: string) => new Date(`2026-07-19T${hms}Z`);
const deps = { db, now: NOW, since: new Date("2026-06-01T00:00:00Z"), lookbackHours: 48, siteUrl: "https://s" };
const USERS = ["rn1", "rn2", "rn3"];
let serverId: number;
const playerIds: number[] = [];

beforeAll(async () => {
  await db.insert(user).values(USERS.map((id) => ({ id, name: id, email: `${id}@x.com` })));
  const [s] = await db.insert(servers).values({ nitradoServiceId: 992311, name: "renamesrv", slug: "renamesrv" }).returning();
  serverId = s!.id;
  const ids: Record<string, number> = {};
  for (const [gamertag, userId] of [["RN Newname", "rn1"], ["RN Oldname", "rn2"], ["RN Ghost", "rn3"]] as const) {
    const [p] = await db.insert(players).values({ gamertag, lastSeenAt: NOW }).returning();
    ids[gamertag] = Number(p!.id);
    playerIds.push(Number(p!.id));
    await db.insert(gamertagLinks).values({ userId, gamertag, status: "verified", verifiedAt: new Date("2026-06-02T00:00:00Z") });
    await db.insert(lives).values({ serverId, playerId: p!.id, lifeNumber: 1, startedAt: T("10:00:00"), playtimeSeconds: 0 });
  }
  await db.insert(kills).values([
    { serverId, killerGamertag: "RN Oldname", killerPlayerId: ids["RN Newname"]!, victimGamertag: "v", occurredAt: T("10:02:00") },
    { serverId, killerGamertag: "rn ghost", killerPlayerId: null, victimGamertag: "w", occurredAt: T("10:02:30") },
  ]);
});
afterAll(async () => {
  await db.delete(kills).where(eq(kills.serverId, serverId));
  await db.delete(lives).where(eq(lives.serverId, serverId));
  await db.delete(gamertagLinks).where(inArray(gamertagLinks.userId, USERS));
  await db.delete(players).where(inArray(players.id, playerIds));
  await db.delete(servers).where(eq(servers.id, serverId));
  await db.delete(user).where(inArray(user.id, USERS));
  await sql.end();
});

describe("lifeQualifiedGenerator — kills matched by player id", () => {
  it("a renamed killer's kill still qualifies his life in the notifier", async () => {
    const drafts = (await lifeQualifiedGenerator(deps)).filter((d) => d.userId === "rn1");
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.body).toBe("renamesrv: life 1 is qualified. Dying costs you 24 hours.");
  });
  it("the player who now holds the old name is told nothing for a kill he did not score", async () => {
    expect((await lifeQualifiedGenerator(deps)).filter((d) => d.userId === "rn2")).toEqual([]);
  });
  it("a kill row with no player id still counts by name, ignoring case", async () => {
    expect((await lifeQualifiedGenerator(deps)).filter((d) => d.userId === "rn3")).toHaveLength(1);
  });
});
