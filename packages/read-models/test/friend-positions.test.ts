import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  user, gamertagLinks, servers, players, lives, sessions, positions, locationShares,
} from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { eq } from "drizzle-orm";
import { getFriendPositions } from "../src/friend-positions.js";

const { db, sql } = getTestDb();
const NOW = new Date("2026-07-22T12:00:00Z");
const CONNECTED = new Date("2026-07-22T11:00:00Z");

let serverId = 0;
let otherServerId = 0;

/**
 * Viewer "va" and subject "vb".
 *
 * ⚠️ Sub-project E: there is no friendship, no master switch and no per-pair flag here any more.
 * Visibility comes from a `location_shares` row whose stored session start still matches an OPEN
 * session of the subject's on THIS server.
 */
async function seed(o: {
  /** Omit the grant entirely. */
  granted?: boolean;
  /** Stored snapshot on the grant row; defaults to the subject's live session start. */
  grantedSessionStart?: Date;
  online?: boolean;
  positionAt?: Date;
  subjectVerified?: boolean;
} = {}) {
  await sql`truncate table location_shares, positions, sessions, lives, players, servers, gamertag_links, "user" restart identity cascade`;
  await db.insert(user).values([
    { id: "va", name: "VA", email: "va@x.com" },
    { id: "vb", name: "VB", email: "vb@x.com" },
  ]);
  await db.insert(gamertagLinks).values([
    { userId: "va", gamertag: "ViewerAlpha", status: "verified", verifiedAt: NOW },
    { userId: "vb", gamertag: "SubjectBravo", status: o.subjectVerified === false ? "pending" : "verified",
      verifiedAt: o.subjectVerified === false ? null : NOW },
  ]);
  const [srv] = await db.insert(servers)
    .values({ nitradoServiceId: 995001, name: "Sakhal", map: "sakhal", slug: "fp-sakhal" })
    .returning();
  const [other] = await db.insert(servers)
    .values({ nitradoServiceId: 995003, name: "Chern", map: "chernarusplus", slug: "fp-chern" })
    .returning();
  serverId = srv!.id;
  otherServerId = other!.id;

  for (const [gamertag, uid] of [["ViewerAlpha", "va"], ["SubjectBravo", "vb"]] as const) {
    const [p] = await db.insert(players).values({ gamertag, lastSeenAt: NOW }).returning();
    const [life] = await db.insert(lives)
      .values({ serverId: srv!.id, playerId: p!.id, lifeNumber: 1, startedAt: new Date("2026-07-22T10:00:00Z") })
      .returning();
    const isSubject = uid === "vb";
    const open = isSubject ? (o.online ?? true) : true;
    await db.insert(sessions).values({
      serverId: srv!.id, playerId: p!.id, lifeId: life!.id,
      connectedAt: CONNECTED,
      disconnectedAt: open ? null : new Date("2026-07-22T11:50:00Z"),
    });
    await db.insert(positions).values({
      serverId: srv!.id, playerId: p!.id, gamertag,
      x: isSubject ? 2000 : 1000, y: isSubject ? 2500 : 1500,
      recordedAt: isSubject ? (o.positionAt ?? new Date("2026-07-22T11:58:00Z")) : new Date("2026-07-22T11:58:00Z"),
    });
  }

  if (o.granted !== false) {
    await db.insert(locationShares).values({
      granterUserId: "vb", granteeUserId: "va", serverId: srv!.id,
      granterSessionConnectedAt: o.grantedSessionStart ?? CONNECTED,
    });
  }
}

const call = () => getFriendPositions(db, { viewerUserId: "va", serverId, now: NOW });

beforeEach(() => seed());
afterAll(async () => { await sql.end(); });

describe("getFriendPositions", () => {
  it("returns the viewer's own dot and a granting subject's", async () => {
    const out = await call();
    expect(out.map((p) => p.gamertag).sort()).toEqual(["SubjectBravo", "ViewerAlpha"]);
    expect(out.find((p) => p.gamertag === "ViewerAlpha")!.self).toBe(true);
    expect(out.find((p) => p.gamertag === "SubjectBravo")!.self).toBe(false);
    expect(out.find((p) => p.gamertag === "SubjectBravo")!.x).toBe(2000);
  });

  // ⚠️ THE DEFAULT. No grant, no dot — being online together, or friends, grants nothing.
  it("omits everyone who has not granted", async () => {
    await seed({ granted: false });
    expect((await call()).map((p) => p.gamertag)).toEqual(["ViewerAlpha"]);
  });

  // ⚠️ THE CENTRAL CLAIM OF SUB-PROJECT E, and the reason the snapshot is stored at all: a grant
  // made in an earlier session must not survive into the next one. Mutation-tested — deleting
  // the session equality from the join makes this test fail.
  it("omits a grant made in an EARLIER session of the same subject", async () => {
    await seed({ grantedSessionStart: new Date("2026-07-22T09:00:00Z") });
    expect((await call()).map((p) => p.gamertag)).toEqual(["ViewerAlpha"]);
  });

  it("omits a grant whose snapshot is LATER than the live session", async () => {
    // Equality, not `>=`: a stored value that does not name this exact session is not this
    // session's grant, whichever direction it differs in.
    await seed({ grantedSessionStart: new Date("2026-07-22T11:30:00Z") });
    expect((await call()).map((p) => p.gamertag)).toEqual(["ViewerAlpha"]);
  });

  it("omits an offline subject even with a matching snapshot", async () => {
    await seed({ online: false });
    expect((await call()).map((p) => p.gamertag)).toEqual(["ViewerAlpha"]);
  });

  it("omits a subject whose last position is older than the staleness cap", async () => {
    await seed({ positionAt: new Date("2026-07-22T11:40:00Z") }); // 20 min old
    expect((await call()).map((p) => p.gamertag)).toEqual(["ViewerAlpha"]);
  });

  // ⚠️ F1's deferred prerequisite, retained through E. A released verified link leaves the grant
  // row intact; without the inner join on a VERIFIED link, coordinates keep flowing.
  it("omits a subject whose verified gamertag link was released, despite a live grant", async () => {
    await seed({ subjectVerified: false });
    expect((await call()).map((p) => p.gamertag)).toEqual(["ViewerAlpha"]);
  });

  // ⚠️ A grant is scoped to one server. A share made on Chernarus must not follow the subject
  // to Sakhal — their session there is a different session.
  it("omits a grant made on a DIFFERENT server", async () => {
    await db.update(locationShares).set({ serverId: otherServerId });
    expect((await call()).map((p) => p.gamertag)).toEqual(["ViewerAlpha"]);
  });

  // ⚠️ Direction matters. A grant the VIEWER made to the subject does not let the viewer see
  // the subject — sharing is one-way, and reciprocity is never assumed.
  it("does not honour a grant in the opposite direction", async () => {
    await db.update(locationShares).set({ granterUserId: "va", granteeUserId: "vb" });
    expect((await call()).map((p) => p.gamertag)).toEqual(["ViewerAlpha"]);
  });

  it("does not leak a grant made to somebody else", async () => {
    await db.insert(user).values({ id: "vc", name: "VC", email: "vc@x.com" });
    await db.update(locationShares).set({ granteeUserId: "vc" });
    expect((await call()).map((p) => p.gamertag)).toEqual(["ViewerAlpha"]);
  });

  it("returns the viewer's own dot whether or not they have granted anything", async () => {
    await seed({ granted: false });
    expect((await call()).map((p) => p.gamertag)).toContain("ViewerAlpha");
  });

  // ⚠️ A verified link with no folded `players` row used to fail an INNER join and return [],
  // costing the viewer every subject's dot as collateral for their own missing one. Only the
  // viewer's own dot may be absent.
  it("still shows subjects when the viewer has a verified link but no players row", async () => {
    const viewerPlayerId = (await db.select({ id: players.id }).from(players)
      .where(eq(players.gamertag, "ViewerAlpha")))[0]!.id;
    await db.delete(positions).where(eq(positions.gamertag, "ViewerAlpha"));
    await db.delete(sessions).where(eq(sessions.playerId, viewerPlayerId));
    await db.delete(lives).where(eq(lives.playerId, viewerPlayerId));
    await db.delete(players).where(eq(players.gamertag, "ViewerAlpha"));

    const out = await call();
    expect(out.map((p) => p.gamertag)).toEqual(["SubjectBravo"]);
  });

  // ⚠️ Migration 0024 made `players_gamertag_uniq` an index on lower(gamertag), and migration
  // 0025 DROPPED it entirely — `players.gamertag` is a current label, not an identity, and two
  // identities may legitimately hold the same one. So the state this test constructs is
  // producible by the database again, and the per-granter collapse is load-bearing rather than
  // merely defensive: without it one subject renders as TWO markers, same callsign, two places.
  // The failure mode is a map that lies, which is worse than an exception.
  it("collapses case-variant players rows to one dot for one subject", async () => {
    const [dupe] = await db.insert(players)
      .values({ gamertag: "subjectbravo", lastSeenAt: new Date("2026-07-22T11:00:00Z") }) // seen earlier
      .returning();
    const [dupeLife] = await db.insert(lives)
      .values({ serverId, playerId: dupe!.id, lifeNumber: 1, startedAt: new Date("2026-07-22T10:00:00Z") })
      .returning();
    await db.insert(sessions).values({
      serverId, playerId: dupe!.id, lifeId: dupeLife!.id,
      connectedAt: CONNECTED, disconnectedAt: null,
    });
    await db.insert(positions).values({
      serverId, playerId: dupe!.id, gamertag: "subjectbravo",
      x: 9999, y: 9999, recordedAt: new Date("2026-07-22T11:59:00Z"),
    });

    const out = await call();
    expect(out.map((p) => p.gamertag).sort()).toEqual(["SubjectBravo", "ViewerAlpha"]);
    // the most-recently-seen row wins, deterministically — not the newer position
    expect(out.find((p) => p.gamertag === "SubjectBravo")!.x).toBe(2000);
  });

  // ⚠️ `gamertag_links_verified_uniq` is on lower(gamertag) as of migration 0024, so two users
  // can no longer hold VERIFIED links that differ only in case and fold onto the same `players`
  // row. This asserts the rejection.
  //
  // The `claim()` guard in `getFriendPositions` (viewer-first, so a marker can never be flagged
  // `self` while carrying another subject's callsign) is likewise RETAINED. It costs nothing,
  // and the thing it prevents — one dot that is simultaneously "you" and someone else — is
  // exactly the kind of defect that is invisible until someone is ambushed at it.
  it("rejects a second verified gamertag link differing only in case", async () => {
    await expect(
      db.update(gamertagLinks)
        .set({ gamertag: "vieweralpha" })
        .where(eq(gamertagLinks.userId, "vb")),
    ).rejects.toThrow(/gamertag_links_verified_uniq/);
  });
});
