import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  user, gamertagLinks, servers, players, lives, sessions, positions,
  friendships, userPreferences,
} from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { eq } from "drizzle-orm";
import { getFriendPositions } from "../src/friend-positions.js";

const { db, sql } = getTestDb();
const NOW = new Date("2026-07-22T12:00:00Z");

let serverId = 0;

/** Viewer "va" and friend "vb" (va < vb, so va is side A). */
async function seed(o: {
  masterShare?: boolean; pairShare?: boolean; status?: string;
  online?: boolean; positionAt?: Date; friendVerified?: boolean;
} = {}) {
  await sql`truncate table user_preferences, friendships, positions, sessions, lives, players, servers, gamertag_links, "user" restart identity cascade`;
  await db.insert(user).values([
    { id: "va", name: "VA", email: "va@x.com" },
    { id: "vb", name: "VB", email: "vb@x.com" },
  ]);
  await db.insert(gamertagLinks).values([
    { userId: "va", gamertag: "ViewerAlpha", status: "verified", verifiedAt: NOW },
    { userId: "vb", gamertag: "FriendBravo", status: o.friendVerified === false ? "pending" : "verified",
      verifiedAt: o.friendVerified === false ? null : NOW },
  ]);
  const [srv] = await db.insert(servers)
    .values({ nitradoServiceId: 995001, name: "Sakhal", map: "sakhal", slug: "fp-sakhal" })
    .returning();
  serverId = srv!.id;

  for (const [gamertag, uid] of [["ViewerAlpha", "va"], ["FriendBravo", "vb"]] as const) {
    const [p] = await db.insert(players).values({ gamertag, lastSeenAt: NOW }).returning();
    const [life] = await db.insert(lives)
      .values({ serverId: srv!.id, playerId: p!.id, lifeNumber: 1, startedAt: new Date("2026-07-22T10:00:00Z") })
      .returning();
    const isFriend = uid === "vb";
    const open = isFriend ? (o.online ?? true) : true;
    await db.insert(sessions).values({
      serverId: srv!.id, playerId: p!.id, lifeId: life!.id,
      connectedAt: new Date("2026-07-22T11:00:00Z"),
      disconnectedAt: open ? null : new Date("2026-07-22T11:50:00Z"),
    });
    await db.insert(positions).values({
      serverId: srv!.id, playerId: p!.id, gamertag,
      x: isFriend ? 2000 : 1000, y: isFriend ? 2500 : 1500,
      recordedAt: isFriend ? (o.positionAt ?? new Date("2026-07-22T11:58:00Z")) : new Date("2026-07-22T11:58:00Z"),
    });
  }

  await db.insert(friendships).values({
    userA: "va", userB: "vb", status: o.status ?? "accepted", requestedBy: "va",
    bSharesLocation: o.pairShare ?? true,
  });
  await db.insert(userPreferences).values({ userId: "vb", shareLocation: o.masterShare ?? true });
}

const call = () => getFriendPositions(db, { viewerUserId: "va", serverId, now: NOW });

beforeEach(() => seed());
afterAll(async () => { await sql.end(); });

describe("getFriendPositions", () => {
  it("returns the viewer's own dot and a sharing friend's", async () => {
    const out = await call();
    expect(out.map((p) => p.gamertag).sort()).toEqual(["FriendBravo", "ViewerAlpha"]);
    expect(out.find((p) => p.gamertag === "ViewerAlpha")!.self).toBe(true);
    expect(out.find((p) => p.gamertag === "FriendBravo")!.self).toBe(false);
    expect(out.find((p) => p.gamertag === "FriendBravo")!.x).toBe(2000);
  });

  it("omits a friend whose master switch is off", async () => {
    await seed({ masterShare: false });
    expect((await call()).map((p) => p.gamertag)).toEqual(["ViewerAlpha"]);
  });

  it("omits a friend who has hidden from the viewer specifically", async () => {
    await seed({ pairShare: false });
    expect((await call()).map((p) => p.gamertag)).toEqual(["ViewerAlpha"]);
  });

  it("omits a non-accepted pair", async () => {
    await seed({ status: "pending" });
    expect((await call()).map((p) => p.gamertag)).toEqual(["ViewerAlpha"]);
  });

  it("omits an offline friend", async () => {
    await seed({ online: false });
    expect((await call()).map((p) => p.gamertag)).toEqual(["ViewerAlpha"]);
  });

  it("omits a friend whose last position is older than the staleness cap", async () => {
    await seed({ positionAt: new Date("2026-07-22T11:40:00Z") }); // 20 min old
    expect((await call()).map((p) => p.gamertag)).toEqual(["ViewerAlpha"]);
  });

  // ⚠️ F1's deferred prerequisite. A released verified link leaves the friendship row and its
  // sharing flags intact; without the inner join on a VERIFIED link, coordinates keep flowing.
  it("omits a friend whose verified gamertag link was released, despite live flags", async () => {
    await seed({ friendVerified: false });
    expect((await call()).map((p) => p.gamertag)).toEqual(["ViewerAlpha"]);
  });

  it("returns the viewer's own dot regardless of their own sharing flags", async () => {
    await db.insert(userPreferences).values({ userId: "va", shareLocation: false })
      .onConflictDoUpdate({ target: userPreferences.userId, set: { shareLocation: false } });
    await db.update(friendships).set({ aSharesLocation: false }).where(eq(friendships.userA, "va"));
    expect((await call()).map((p) => p.gamertag)).toContain("ViewerAlpha");
  });

  // ⚠️ A verified link with no folded `players` row used to fail an INNER join and return [],
  // costing the viewer every FRIEND's dot as collateral for their own missing one. Only the
  // viewer's own dot may be absent.
  it("still shows friends when the viewer has a verified link but no players row", async () => {
    await db.delete(positions).where(eq(positions.gamertag, "ViewerAlpha"));
    await db.delete(sessions).where(eq(sessions.playerId,
      (await db.select({ id: players.id }).from(players).where(eq(players.gamertag, "ViewerAlpha")))[0]!.id));
    await db.delete(lives).where(eq(lives.playerId,
      (await db.select({ id: players.id }).from(players).where(eq(players.gamertag, "ViewerAlpha")))[0]!.id));
    await db.delete(players).where(eq(players.gamertag, "ViewerAlpha"));

    const out = await call();
    expect(out.map((p) => p.gamertag)).toEqual(["FriendBravo"]);
  });

  // ⚠️ Migration 0024 made `players_gamertag_uniq` an index on lower(gamertag), and migration
  // 0025 DROPPED it entirely — `players.gamertag` is a current label, not an identity, and two
  // identities may legitimately hold the same one. So the state this test constructs is
  // producible by the database again, and the per-friend collapse is load-bearing rather than
  // merely defensive: without it one friend renders as TWO markers, same callsign, two places.
  // The failure mode is a map that lies, which is worse than an exception.
  it("collapses case-variant players rows to one dot for one friend", async () => {
    const [dupe] = await db.insert(players)
      .values({ gamertag: "friendbravo", lastSeenAt: new Date("2026-07-22T11:00:00Z") }) // seen earlier
      .returning();
    const [dupeLife] = await db.insert(lives)
      .values({ serverId, playerId: dupe!.id, lifeNumber: 1, startedAt: new Date("2026-07-22T10:00:00Z") })
      .returning();
    await db.insert(sessions).values({
      serverId, playerId: dupe!.id, lifeId: dupeLife!.id,
      connectedAt: new Date("2026-07-22T11:00:00Z"), disconnectedAt: null,
    });
    await db.insert(positions).values({
      serverId, playerId: dupe!.id, gamertag: "friendbravo",
      x: 9999, y: 9999, recordedAt: new Date("2026-07-22T11:59:00Z"),
    });

    const out = await call();
    expect(out.map((p) => p.gamertag).sort()).toEqual(["FriendBravo", "ViewerAlpha"]);
    // the most-recently-seen row wins, deterministically — not the newer position
    expect(out.find((p) => p.gamertag === "FriendBravo")!.x).toBe(2000);
  });

  // ⚠️ `gamertag_links_verified_uniq` is on lower(gamertag) as of migration 0024 too, so two
  // users can no longer hold VERIFIED links that differ only in case and fold onto the same
  // `players` row. As above, this test now asserts the rejection.
  //
  // The `claim()` guard in `getFriendPositions` (viewer-first, so a marker can never be flagged
  // `self` while carrying a friend's callsign) is likewise RETAINED. It costs nothing, and the
  // thing it prevents — one dot that is simultaneously "you" and someone else — is exactly the
  // kind of defect that is invisible until someone is ambushed at it.
  it("rejects a second verified gamertag link differing only in case", async () => {
    await expect(
      db.update(gamertagLinks)
        .set({ gamertag: "vieweralpha" })
        .where(eq(gamertagLinks.userId, "vb")),
    ).rejects.toThrow(/gamertag_links_verified_uniq/);
  });

  // Every other test in this file seeds the viewer as side A ("va" < "vb"), so the ternary in
  // friend-positions.ts (`r.userA === r.friendUserId ? r.aShares : r.bShares`) only ever reads
  // the FRIEND's `bShares` column. This test seeds the FRIEND as side A instead ("fa" < "vw"),
  // so a viewer of "vw" reading a subject "fa" exercises the `aShares` branch — proving the
  // subject's own per-pair flag is honoured regardless of which side of the pair they land on.
  // The named threat: if this ternary were ever inverted, a subject who hid from THIS viewer
  // specifically would still leak, because the read model would consult the VIEWER's own flag
  // instead of the subject's.
  describe("with the subject as side A of the canonically-ordered pair", () => {
    async function seedReversed(o: { subjectPairShare?: boolean } = {}) {
      await sql`truncate table user_preferences, friendships, positions, sessions, lives, players, servers, gamertag_links, "user" restart identity cascade`;
      await db.insert(user).values([
        { id: "fa", name: "FA", email: "fa@x.com" },
        { id: "vw", name: "VW", email: "vw@x.com" },
      ]);
      await db.insert(gamertagLinks).values([
        { userId: "vw", gamertag: "ViewerW", status: "verified", verifiedAt: NOW },
        { userId: "fa", gamertag: "SubjectA", status: "verified", verifiedAt: NOW },
      ]);
      const [srv] = await db.insert(servers)
        .values({ nitradoServiceId: 995002, name: "Sakhal2", map: "sakhal", slug: "fp-sakhal-2" })
        .returning();

      for (const [gamertag, uid] of [["ViewerW", "vw"], ["SubjectA", "fa"]] as const) {
        const [p] = await db.insert(players).values({ gamertag, lastSeenAt: NOW }).returning();
        const [life] = await db.insert(lives)
          .values({ serverId: srv!.id, playerId: p!.id, lifeNumber: 1, startedAt: new Date("2026-07-22T10:00:00Z") })
          .returning();
        await db.insert(sessions).values({
          serverId: srv!.id, playerId: p!.id, lifeId: life!.id,
          connectedAt: new Date("2026-07-22T11:00:00Z"), disconnectedAt: null,
        });
        await db.insert(positions).values({
          serverId: srv!.id, playerId: p!.id, gamertag,
          x: uid === "fa" ? 2000 : 1000, y: uid === "fa" ? 2500 : 1500,
          recordedAt: new Date("2026-07-22T11:58:00Z"),
        });
      }

      // "fa" < "vw" — the SUBJECT is side A here, so their own per-pair flag lives in
      // `aSharesLocation`, not `bSharesLocation`.
      await db.insert(friendships).values({
        userA: "fa", userB: "vw", status: "accepted", requestedBy: "fa",
        aSharesLocation: o.subjectPairShare ?? true,
      });
      await db.insert(userPreferences).values({ userId: "fa", shareLocation: true });
      return srv!.id;
    }

    it("shows the subject when THEIR side-A flag allows it", async () => {
      const serverId = await seedReversed({ subjectPairShare: true });
      const out = await getFriendPositions(db, { viewerUserId: "vw", serverId, now: NOW });
      expect(out.map((p) => p.gamertag).sort()).toEqual(["SubjectA", "ViewerW"]);
    });

    it("omits the subject when THEIR side-A flag hides them from this viewer", async () => {
      const serverId = await seedReversed({ subjectPairShare: false });
      const out = await getFriendPositions(db, { viewerUserId: "vw", serverId, now: NOW });
      expect(out.map((p) => p.gamertag)).toEqual(["ViewerW"]);
    });
  });
});
