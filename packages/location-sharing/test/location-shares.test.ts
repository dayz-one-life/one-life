import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { user, servers, players, lives, sessions, locationShares } from "@onelife/db";
import { eq } from "drizzle-orm";
import { getTestDb } from "@onelife/test-support";
import {
  currentSessionStart, grantLocation, revokeLocation, revokeAllLocation,
  clearLocationSharesFor, isShareEffective,
} from "../src/location.js";

const { db, sql } = getTestDb();

const T0 = new Date("2026-07-25T10:00:00Z");
const T1 = new Date("2026-07-25T14:00:00Z");

let chern = 0;
let sakh = 0;
let granterPlayerChern = 0;
let granterPlayerSakh = 0;

/** Opens a session (and the life it needs) and returns its connectedAt. */
async function openSession(serverId: number, playerId: number, connectedAt: Date): Promise<Date> {
  const [l] = await db.insert(lives)
    .values({ serverId, playerId, lifeNumber: 1, startedAt: connectedAt, endedAt: null, playtimeSeconds: 0 })
    .returning();
  await db.insert(sessions)
    .values({ serverId, playerId, lifeId: l!.id, connectedAt, disconnectedAt: null });
  return connectedAt;
}

beforeEach(async () => {
  await sql`truncate table location_shares, sessions, lives, positions, players, servers, "user" restart identity cascade`;
  await db.insert(user).values([
    { id: "granter", name: "G", email: "g@x.test" },
    { id: "grantee", name: "E", email: "e@x.test" },
    { id: "other", name: "O", email: "o@x.test" },
  ]);
  const [c] = await db.insert(servers)
    .values({ nitradoServiceId: 9001, name: "Chernarus", map: "chernarusplus", slug: "chern", active: true }).returning();
  const [s] = await db.insert(servers)
    .values({ nitradoServiceId: 9002, name: "Sakhal", map: "sakhal", slug: "sakh", active: true }).returning();
  chern = c!.id; sakh = s!.id;
  const [p] = await db.insert(players)
    .values({ gamertag: "Granter", dayzId: "dz-granter", firstSeenAt: T0, lastSeenAt: T0 }).returning();
  granterPlayerChern = p!.id;
  granterPlayerSakh = p!.id;
});

afterAll(async () => { await sql.end(); });

describe("isShareEffective", () => {
  it("matches only the session the grant was made in", () => {
    expect(isShareEffective({ storedSessionStart: T0, currentSessionStart: T0 })).toBe(true);
    expect(isShareEffective({ storedSessionStart: T0, currentSessionStart: T1 })).toBe(false);
  });

  // The disconnect case needs no branch of its own: no open session means no value to match.
  it("is false when the granter has no open session", () => {
    expect(isShareEffective({ storedSessionStart: T0, currentSessionStart: null })).toBe(false);
  });

  // ⚠️ Equality, not `>=`. A `granted_at >= connected_at` form would compare the API's wall clock
  // against an ADM timestamp with clock_offset_ms applied — seconds apart — so a grant made in
  // the first seconds of a session could silently never match. Both sides here are one value.
  it("does not accept a LATER session as a match", () => {
    const later = new Date(T0.getTime() + 1000);
    expect(isShareEffective({ storedSessionStart: T0, currentSessionStart: later })).toBe(false);
  });
});

describe("currentSessionStart", () => {
  it("finds the open session on that server", async () => {
    await openSession(chern, granterPlayerChern, T0);
    const got = await currentSessionStart(db, { userPlayerId: granterPlayerChern, serverId: chern });
    expect(got?.toISOString()).toBe(T0.toISOString());
  });

  // ⚠️ Scoped to ONE server. Resolving "their current session" globally would let a grant made
  // on Chernarus keep working while they play Sakhal.
  it("does not see a session on a DIFFERENT server", async () => {
    await openSession(chern, granterPlayerChern, T0);
    expect(await currentSessionStart(db, { userPlayerId: granterPlayerChern, serverId: sakh })).toBeNull();
  });

  it("ignores a closed session", async () => {
    const [l] = await db.insert(lives)
      .values({ serverId: chern, playerId: granterPlayerChern, lifeNumber: 1, startedAt: T0, endedAt: null, playtimeSeconds: 0 })
      .returning();
    await db.insert(sessions)
      .values({ serverId: chern, playerId: granterPlayerChern, lifeId: l!.id, connectedAt: T0, disconnectedAt: T1 });
    expect(await currentSessionStart(db, { userPlayerId: granterPlayerChern, serverId: chern })).toBeNull();
  });

  it("takes the newest when a crashed client left two open", async () => {
    await openSession(chern, granterPlayerChern, T0);
    await openSession(chern, granterPlayerChern, T1);
    const got = await currentSessionStart(db, { userPlayerId: granterPlayerChern, serverId: chern });
    expect(got?.toISOString()).toBe(T1.toISOString());
  });

  it("returns null when there is no session at all", async () => {
    expect(await currentSessionStart(db, { userPlayerId: granterPlayerChern, serverId: chern })).toBeNull();
  });
});

describe("grantLocation", () => {
  it("stores the granter's current session start and returns it", async () => {
    await openSession(chern, granterPlayerChern, T0);
    const got = await grantLocation(db, {
      granterUserId: "granter", granterPlayerId: granterPlayerChern,
      granteeUserId: "grantee", serverId: chern,
    });
    expect(got?.toISOString()).toBe(T0.toISOString());
    const [row] = await db.select().from(locationShares);
    expect(row!.granterSessionConnectedAt.toISOString()).toBe(T0.toISOString());
    expect(row!.serverId).toBe(chern);
  });

  // A grant is always made DURING a session — that is what anchors its expiry.
  it("refuses (returns null, writes nothing) when the granter is offline", async () => {
    const got = await grantLocation(db, {
      granterUserId: "granter", granterPlayerId: granterPlayerChern,
      granteeUserId: "grantee", serverId: chern,
    });
    expect(got).toBeNull();
    expect(await db.select().from(locationShares)).toHaveLength(0);
  });

  it("re-granting in the SAME session updates in place, not a second row", async () => {
    await openSession(chern, granterPlayerChern, T0);
    const a = { granterUserId: "granter", granterPlayerId: granterPlayerChern, granteeUserId: "grantee", serverId: chern };
    await grantLocation(db, a);
    await grantLocation(db, a);
    expect(await db.select().from(locationShares)).toHaveLength(1);
  });

  // ⚠️ THE CENTRAL CLAIM: a grant does not outlive the session it was made in. Mutation-tested —
  // dropping the session equality from the read predicate makes the read-model test fail.
  it("a grant made in an earlier session no longer matches the new one", async () => {
    await openSession(chern, granterPlayerChern, T0);
    await grantLocation(db, {
      granterUserId: "granter", granterPlayerId: granterPlayerChern,
      granteeUserId: "grantee", serverId: chern,
    });
    // Session ends, a new one begins.
    await db.update(sessions).set({ disconnectedAt: T1 }).where(eq(sessions.serverId, chern));
    await openSession(chern, granterPlayerChern, T1);

    const [row] = await db.select().from(locationShares);
    const now = await currentSessionStart(db, { userPlayerId: granterPlayerChern, serverId: chern });
    expect(isShareEffective({ storedSessionStart: row!.granterSessionConnectedAt, currentSessionStart: now })).toBe(false);
  });

  it("re-granting in the NEW session revives it", async () => {
    await openSession(chern, granterPlayerChern, T0);
    const a = { granterUserId: "granter", granterPlayerId: granterPlayerChern, granteeUserId: "grantee", serverId: chern };
    await grantLocation(db, a);
    await db.update(sessions).set({ disconnectedAt: T1 }).where(eq(sessions.serverId, chern));
    await openSession(chern, granterPlayerChern, T1);
    await grantLocation(db, a);

    const rows = await db.select().from(locationShares);
    expect(rows).toHaveLength(1);
    const now = await currentSessionStart(db, { userPlayerId: granterPlayerChern, serverId: chern });
    expect(isShareEffective({ storedSessionStart: rows[0]!.granterSessionConnectedAt, currentSessionStart: now })).toBe(true);
  });

  it("grants on two servers are independent", async () => {
    await openSession(chern, granterPlayerChern, T0);
    await openSession(sakh, granterPlayerSakh, T1);
    await grantLocation(db, { granterUserId: "granter", granterPlayerId: granterPlayerChern, granteeUserId: "grantee", serverId: chern });
    await grantLocation(db, { granterUserId: "granter", granterPlayerId: granterPlayerSakh, granteeUserId: "grantee", serverId: sakh });
    const rows = await db.select().from(locationShares);
    expect(rows.map((r) => r.serverId).sort()).toEqual([chern, sakh].sort());
  });
});

describe("revocation", () => {
  async function grantTo(grantee: string) {
    await grantLocation(db, {
      granterUserId: "granter", granterPlayerId: granterPlayerChern,
      granteeUserId: grantee, serverId: chern,
    });
  }

  it("revokeLocation removes exactly one grantee", async () => {
    await openSession(chern, granterPlayerChern, T0);
    await grantTo("grantee");
    await grantTo("other");
    await revokeLocation(db, { granterUserId: "granter", granteeUserId: "grantee", serverId: chern });
    const rows = await db.select().from(locationShares);
    expect(rows.map((r) => r.granteeUserId)).toEqual(["other"]);
  });

  it("revokeAllLocation clears this server only", async () => {
    await openSession(chern, granterPlayerChern, T0);
    await openSession(sakh, granterPlayerSakh, T1);
    await grantTo("grantee");
    await grantLocation(db, { granterUserId: "granter", granterPlayerId: granterPlayerSakh, granteeUserId: "grantee", serverId: sakh });
    await revokeAllLocation(db, { granterUserId: "granter", serverId: chern });
    const rows = await db.select().from(locationShares);
    expect(rows.map((r) => r.serverId)).toEqual([sakh]);
  });

  // ⚠️ A re-verified gamertag link is a NEW claim on that identity and must not inherit outbound
  // sharing — the same reason F2 had verifyLink reset its master switch.
  it("clearLocationSharesFor removes every grant the user made, on every server", async () => {
    await openSession(chern, granterPlayerChern, T0);
    await openSession(sakh, granterPlayerSakh, T1);
    await grantTo("grantee");
    await grantLocation(db, { granterUserId: "granter", granterPlayerId: granterPlayerSakh, granteeUserId: "other", serverId: sakh });
    await clearLocationSharesFor(db, "granter");
    expect(await db.select().from(locationShares)).toHaveLength(0);
  });

  // One-directional: it clears what this user shares, never what others share WITH them.
  it("clearLocationSharesFor leaves grants made TO the user alone", async () => {
    await openSession(chern, granterPlayerChern, T0);
    await grantTo("grantee");
    await clearLocationSharesFor(db, "grantee");
    expect(await db.select().from(locationShares)).toHaveLength(1);
  });
});
