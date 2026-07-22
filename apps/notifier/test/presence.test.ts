import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  user, gamertagLinks, servers, players, lives, sessions, friendships, userPreferences, notifications,
} from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { presenceGenerator, presenceNaturalKey } from "../src/generators/presence.js";

const { db, sql } = getTestDb();
const NOW = new Date("2026-07-22T12:00:00Z");
const deps = (over: Partial<Parameters<typeof presenceGenerator>[0]> = {}) => ({
  db, now: NOW, since: new Date("2026-07-01T00:00:00Z"),
  lookbackHours: 48, siteUrl: "http://localhost", ...over,
});

/** Subject SA (verified, sharing) and observer SB (verified, notifying), accepted friends. */
async function seed(o: {
  connectedAt?: Date; masterShare?: boolean; pairShare?: boolean;
  pairNotify?: boolean; status?: string;
} = {}) {
  await sql`truncate table user_preferences, friendships, notifications, sessions, lives, players, servers, gamertag_links, "user" restart identity cascade`;
  await db.insert(user).values([
    { id: "sa", name: "SA", email: "sa@x.com" },
    { id: "sb", name: "SB", email: "sb@x.com" },
  ]);
  await db.insert(gamertagLinks).values([
    { userId: "sa", gamertag: "SubjectAlpha", status: "verified", verifiedAt: NOW },
    { userId: "sb", gamertag: "ObserverBravo", status: "verified", verifiedAt: NOW },
  ]);
  const [srv] = await db.insert(servers)
    .values({ nitradoServiceId: 990001, name: "Sakhal Server", map: "sakhal", slug: "sakhal" })
    .returning();
  const [p] = await db.insert(players).values({ gamertag: "SubjectAlpha", lastSeenAt: NOW }).returning();
  const [life] = await db.insert(lives)
    .values({ serverId: srv!.id, playerId: p!.id, lifeNumber: 1, startedAt: new Date("2026-07-22T10:00:00Z") })
    .returning();
  await db.insert(sessions).values({
    serverId: srv!.id, playerId: p!.id, lifeId: life!.id,
    connectedAt: o.connectedAt ?? new Date("2026-07-22T11:55:00Z"),
  });
  // sa < sb, so sa is side A: a_* are the subject's flags, b_* the observer's.
  await db.insert(friendships).values({
    userA: "sa", userB: "sb", status: o.status ?? "accepted", requestedBy: "sa",
    aSharesPresence: o.pairShare ?? true, bNotifyPresence: o.pairNotify ?? true,
  });
  await db.insert(userPreferences).values({ userId: "sa", sharePresence: o.masterShare ?? true });
}

beforeEach(() => seed());
// This file, unlike its sibling generator tests, truncates mid-suite (needed to reset state
// between its own cases). Notifier tests run sequentially in one process with no per-file
// isolation, so leaving "sa"/"sb" rows behind after the last case pollutes whichever sibling
// file happens to run next (e.g. generators-account.test.ts's unscoped verified-link window
// query picked them up). Restore the clean slate those siblings assume before closing.
afterAll(async () => {
  await sql`truncate table user_preferences, friendships, notifications, sessions, lives, players, servers, gamertag_links, "user" restart identity cascade`;
  await sql.end();
});

describe("presenceGenerator", () => {
  it("notifies the observer, naming the subject and the map", async () => {
    const drafts = await presenceGenerator(deps());
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.userId).toBe("sb");
    expect(drafts[0]!.kind).toBe("friend_online");
    expect(drafts[0]!.body).toBe("SubjectAlpha is on Sakhal.");
    expect(drafts[0]!.href).toBe("/players/subjectalpha");
  });

  // ⚠️ Regression guard. rebuild.ts truncates `sessions` WITH RESTART IDENTITY while
  // `notifications` is never truncated, so a sessions.id-keyed notification collides with a
  // stale key after a rebuild and the recipient is silently never told. Prove this fails
  // against a key built from the session id.
  it("keys on the rebuild-stable (observer, gamertag, connectedAt) tuple", async () => {
    const drafts = await presenceGenerator(deps());
    expect(drafts[0]!.naturalKey).toBe(
      presenceNaturalKey("sb", "SubjectAlpha", new Date("2026-07-22T11:55:00Z")),
    );
    expect(drafts[0]!.naturalKey).toBe("friend_online:sb:SubjectAlpha:2026-07-22T11:55:00.000Z");
  });

  it("suppresses a second notification inside the 4h cooldown and permits one after", async () => {
    await db.insert(notifications).values({
      userId: "sb", kind: "friend_online",
      naturalKey: presenceNaturalKey("sb", "SubjectAlpha", new Date("2026-07-22T09:00:00Z")),
      title: "Friend online", body: "earlier", href: "/",
      createdAt: new Date("2026-07-22T09:30:00Z"), // 2.5h ago — inside the window
    });
    expect(await presenceGenerator(deps())).toHaveLength(0);

    await db.update(notifications).set({ createdAt: new Date("2026-07-22T04:00:00Z") }); // 8h ago
    expect(await presenceGenerator(deps())).toHaveLength(1);
  });

  it("skips a connect older than FRIEND_ONLINE_MAX_AGE_MINUTES", async () => {
    await seed({ connectedAt: new Date("2026-07-22T11:00:00Z") }); // 60 min old
    expect(await presenceGenerator(deps())).toHaveLength(0);
  });

  it("floors the query at windowStart", async () => {
    await seed({ connectedAt: new Date("2026-07-22T11:55:00Z") });
    const drafts = await presenceGenerator(deps({ since: new Date("2026-07-22T11:58:00Z") }));
    expect(drafts).toHaveLength(0);
  });

  it("stays silent when the master switch is off", async () => {
    await seed({ masterShare: false });
    expect(await presenceGenerator(deps())).toHaveLength(0);
  });

  it("stays silent when the subject has hidden from this friend", async () => {
    await seed({ pairShare: false });
    expect(await presenceGenerator(deps())).toHaveLength(0);
  });

  it("stays silent when the observer has muted this friend", async () => {
    await seed({ pairNotify: false });
    expect(await presenceGenerator(deps())).toHaveLength(0);
  });

  it("stays silent for a non-accepted pair", async () => {
    await seed({ status: "pending" });
    expect(await presenceGenerator(deps())).toHaveLength(0);
  });

  it("picks the newest connectedAt when the subject reconnects inside the window", async () => {
    // A second, later session for the same subject/server. The intra-tick dedupe must emit
    // exactly one draft, and it must be keyed on the LATER connect — not left to query-plan
    // luck — since that is the connect the subject is actually online as of.
    const [srv] = await db.select().from(servers);
    const [p] = await db.select().from(players);
    const [life] = await db.select().from(lives);
    await db.insert(sessions).values({
      serverId: srv!.id, playerId: p!.id, lifeId: life!.id,
      connectedAt: new Date("2026-07-22T11:57:00Z"),
    });
    const drafts = await presenceGenerator(deps());
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.naturalKey).toBe(
      presenceNaturalKey("sb", "SubjectAlpha", new Date("2026-07-22T11:57:00Z")),
    );
  });

  it("notifies the correct party when the subject is side B of the canonical pair", async () => {
    await sql`truncate table user_preferences, friendships, notifications, sessions, lives, players, servers, gamertag_links, "user" restart identity cascade`;
    // "zz" sorts after "aa", so the subject (observed player) is userB here; a_* now belong
    // to the observer and b_* to the subject — an inversion in the join mapping would read
    // the wrong party's share/notify flags and either notify the wrong user or nobody.
    await db.insert(user).values([
      { id: "aa-observer", name: "Observer", email: "obs@x.com" },
      { id: "zz-subject", name: "Subject", email: "subj@x.com" },
    ]);
    await db.insert(gamertagLinks).values([
      { userId: "aa-observer", gamertag: "ObserverAA", status: "verified", verifiedAt: NOW },
      { userId: "zz-subject", gamertag: "SubjectZZ", status: "verified", verifiedAt: NOW },
    ]);
    const [srv] = await db.insert(servers)
      .values({ nitradoServiceId: 990002, name: "Sakhal Server", map: "sakhal", slug: "sakhal" })
      .returning();
    const [p] = await db.insert(players).values({ gamertag: "SubjectZZ", lastSeenAt: NOW }).returning();
    const [life] = await db.insert(lives)
      .values({ serverId: srv!.id, playerId: p!.id, lifeNumber: 1, startedAt: new Date("2026-07-22T10:00:00Z") })
      .returning();
    await db.insert(sessions).values({
      serverId: srv!.id, playerId: p!.id, lifeId: life!.id,
      connectedAt: new Date("2026-07-22T11:55:00Z"),
    });
    // userA < userB alphabetically, so "aa-observer" is side A (observer) and "zz-subject" is
    // side B (subject): b_* flags must be read as the subject's, a_* as the observer's.
    await db.insert(friendships).values({
      userA: "aa-observer", userB: "zz-subject", status: "accepted", requestedBy: "aa-observer",
      bSharesPresence: true, aNotifyPresence: true,
    });
    await db.insert(userPreferences).values({ userId: "zz-subject", sharePresence: true });

    const drafts = await presenceGenerator(deps());
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.userId).toBe("aa-observer");
    expect(drafts[0]!.body).toBe("SubjectZZ is on Sakhal.");
  });

  it("fans out one draft per friend when the subject has two friends", async () => {
    const [sc] = await db.insert(user).values({ id: "sc", name: "SC", email: "sc@x.com" }).returning();
    await db.insert(gamertagLinks).values({
      userId: sc!.id, gamertag: "ObserverCharlie", status: "verified", verifiedAt: NOW,
    });
    await db.insert(friendships).values({
      userA: "sa", userB: "sc", status: "accepted", requestedBy: "sa",
      aSharesPresence: true, bNotifyPresence: true,
    });
    const drafts = await presenceGenerator(deps());
    expect(drafts).toHaveLength(2);
    expect(drafts.map((d) => d.userId).sort()).toEqual(["sb", "sc"]);
    expect(drafts.every((d) => d.body === "SubjectAlpha is on Sakhal.")).toBe(true);
  });

  it("is unaffected by a LIKE wildcard in a user id", async () => {
    // The OBSERVER under test has a `_` in its own id. `_` is a LIKE single-char wildcard, so
    // an unescaped pattern built from "s_b" (i.e. `friend_online:s_b:SubjectAlpha:%`) would
    // also match a row keyed for the totally different observer "sXb" — wrongly satisfying
    // s_b's cooldown off another observer's notification and swallowing s_b's own.
    // "s_b" < "sa" lexicographically (ASCII `_` 0x5F < `a` 0x61), so the canonically-ordered
    // pair is (userA: "s_b", userB: "sa") — s_b is side A (observer), sa stays side B (subject).
    await db.insert(user).values({ id: "s_b", name: "SUB", email: "sub@x.com" });
    await db.insert(gamertagLinks).values({
      userId: "s_b", gamertag: "ObserverUnderscore", status: "verified", verifiedAt: NOW,
    });
    await db.insert(friendships).values({
      userA: "s_b", userB: "sa", status: "accepted", requestedBy: "sa",
      bSharesPresence: true, aNotifyPresence: true,
    });
    // A notification keyed for a DIFFERENT observer, "sXb", inside the cooldown window.
    await db.insert(user).values({ id: "sXb", name: "SXB", email: "sxb@x.com" });
    await db.insert(notifications).values({
      userId: "sXb", kind: "friend_online",
      naturalKey: "friend_online:sXb:SubjectAlpha:2026-07-22T09:00:00.000Z",
      title: "t", body: "b", href: "/", createdAt: new Date("2026-07-22T11:59:00Z"),
    });
    // "s_b" must still be notified — "sXb"'s unrelated row must not satisfy its cooldown.
    const drafts = await presenceGenerator(deps());
    expect(drafts).toHaveLength(2);
    expect(drafts.some((d) => d.userId === "s_b")).toBe(true);
  });
});
