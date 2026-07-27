import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, kills, user, gamertagLinks, avatars } from "@onelife/db";
import { eq, inArray } from "drizzle-orm";
import { getAliveSurvivors } from "../src/survivors.js";

const { db, sql } = getTestDb();

const now = new Date("2026-07-14T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

const svcChern = Math.floor(Math.random() * 1e8) + 40e7;
const svcSakh = Math.floor(Math.random() * 1e8) + 41e7;

let chern: { id: number; slug: string };
let sakh: { id: number; slug: string };

// Insert helpers matching the shape of the task brief's illustrative `insertLife`/`insertKill`,
// adapted onto the real Drizzle schema + test harness. `players` are global (gamertag-unique),
// so we upsert-by-lookup rather than blind-insert.
const insertedGamertags = new Set<string>();
const insertedUserIds = new Set<string>();

/**
 * Seeds a `user` + `gamertag_links` row, plus (unless `hash` is omitted) an `avatars` row.
 * `imageNull: true` shapes a tombstone (image NULL) while still allowing a non-null `hash`, so a
 * test can prove the `image IS NOT NULL` join clause is load-bearing independent of the hash
 * value real code would ever actually pair with a tombstone.
 */
async function insertAvatarLink(opts: {
  gamertag: string;
  userId: string;
  status: "pending" | "verified";
  hash: string | null;
  imageNull?: boolean;
}) {
  await db.insert(user).values({ id: opts.userId, name: opts.userId, email: `${opts.userId}@example.com` });
  insertedUserIds.add(opts.userId);
  await db.insert(gamertagLinks).values({
    userId: opts.userId,
    gamertag: opts.gamertag,
    status: opts.status,
    verifiedAt: opts.status === "verified" ? now : null,
  });
  await db.insert(avatars).values({
    userId: opts.userId,
    image: opts.imageNull ? null : Buffer.from("fake-avatar-bytes"),
    hash: opts.hash,
    source: opts.imageNull ? null : "upload",
    updatedAt: now,
  });
}

async function insertLife(opts: {
  serverId: number;
  gamertag: string;
  endedAt: Date | null;
  playtimeSeconds: number;
  startedAt: Date;
  deathCause?: string | null;
}) {
  let [p] = await db.select().from(players).where(eq(players.gamertag, opts.gamertag));
  if (!p) {
    [p] = await db.insert(players).values({ gamertag: opts.gamertag, firstSeenAt: opts.startedAt, lastSeenAt: now }).returning();
  }
  insertedGamertags.add(opts.gamertag);
  await db.insert(lives).values({
    serverId: opts.serverId,
    playerId: p!.id,
    lifeNumber: 1,
    startedAt: opts.startedAt,
    endedAt: opts.endedAt,
    playtimeSeconds: opts.playtimeSeconds,
    deathCause: opts.deathCause ?? null,
  });
}

async function insertKill(opts: {
  serverId: number;
  killerGamertag: string;
  victimGamertag: string;
  distance: number;
  occurredAt: Date;
}) {
  // The fold stamps killer_player_id from the killer's players row; mirror that here so
  // the FK-keyed read model can attribute the kill.
  const [kp] = await db.select({ id: players.id }).from(players).where(eq(players.gamertag, opts.killerGamertag));
  await db.insert(kills).values({
    serverId: opts.serverId,
    killerGamertag: opts.killerGamertag,
    killerPlayerId: kp?.id ?? null,
    victimGamertag: opts.victimGamertag,
    distance: opts.distance,
    occurredAt: opts.occurredAt,
  });
}

beforeAll(async () => {
  const [c] = await db.insert(servers).values({ nitradoServiceId: svcChern, name: "Survivors-Chernarus", map: "chernarusplus", slug: `survivors-chernarus-${svcChern}`, active: true }).returning();
  const [s] = await db.insert(servers).values({ nitradoServiceId: svcSakh, name: "Survivors-Sakhal", map: "sakhal", slug: `survivors-sakhal-${svcSakh}`, active: true }).returning();
  chern = { id: c!.id, slug: c!.slug! };
  sakh = { id: s!.id, slug: s!.slug! };
});

afterEach(async () => {
  await db.delete(kills).where(inArray(kills.serverId, [chern.id, sakh.id]));
  await db.delete(lives).where(inArray(lives.serverId, [chern.id, sakh.id]));
  if (insertedGamertags.size > 0) {
    await db.delete(players).where(inArray(players.gamertag, [...insertedGamertags]));
    insertedGamertags.clear();
  }
  if (insertedUserIds.size > 0) {
    await db.delete(avatars).where(inArray(avatars.userId, [...insertedUserIds]));
    await db.delete(gamertagLinks).where(inArray(gamertagLinks.userId, [...insertedUserIds]));
    await db.delete(user).where(inArray(user.id, [...insertedUserIds]));
    insertedUserIds.clear();
  }
});

afterAll(async () => {
  await db.delete(servers).where(inArray(servers.id, [chern.id, sakh.id]));
  await sql.end();
});

describe("getAliveSurvivors", () => {
  it("returns only players with an open QUALIFIED life", async () => {
    await insertLife({ serverId: chern.id, gamertag: "Alive", endedAt: null, playtimeSeconds: 600, startedAt: hoursAgo(2) });
    await insertLife({ serverId: chern.id, gamertag: "Dead", endedAt: hoursAgo(1), playtimeSeconds: 900, startedAt: hoursAgo(3) });
    await insertLife({ serverId: chern.id, gamertag: "Fresh", endedAt: null, playtimeSeconds: 60, startedAt: minutesAgo(1) });

    const res = await getAliveSurvivors(db, { page: 1 }, now);
    expect(res.rows.map((r) => r.gamertag)).toEqual(["Alive"]);
    expect(res.total).toBe(1);
    expect(res.pageSize).toBe(25);
  });

  it("qualifies an open sub-300s life that has a kill in-window", async () => {
    await insertLife({ serverId: chern.id, gamertag: "Sniper", endedAt: null, playtimeSeconds: 120, startedAt: minutesAgo(5) });
    await insertKill({ serverId: chern.id, killerGamertag: "Sniper", victimGamertag: "X", distance: 210, occurredAt: minutesAgo(2) });
    const res = await getAliveSurvivors(db, { page: 1 }, now);
    expect(res.rows.map((r) => r.gamertag)).toContain("Sniper");
  });

  it("counts kills THIS LIFE and longest kill this life", async () => {
    await insertLife({ serverId: chern.id, gamertag: "Killer", endedAt: null, playtimeSeconds: 1800, startedAt: hoursAgo(1) });
    // in-life kills
    await insertKill({ serverId: chern.id, killerGamertag: "Killer", victimGamertag: "A", distance: 100, occurredAt: minutesAgo(30) });
    await insertKill({ serverId: chern.id, killerGamertag: "Killer", victimGamertag: "B", distance: 350, occurredAt: minutesAgo(10) });
    // BEFORE this life started — must be excluded
    await insertKill({ serverId: chern.id, killerGamertag: "Killer", victimGamertag: "C", distance: 999, occurredAt: hoursAgo(5) });
    const res = await getAliveSurvivors(db, { page: 1 }, now);
    const row = res.rows.find((r) => r.gamertag === "Killer")!;
    expect(row.killsThisLife).toBe(2);
    expect(row.longestKillMeters).toBe(350);
  });

  it("returns null longestKill when the life has no ranged kills", async () => {
    await insertLife({ serverId: chern.id, gamertag: "Pacifist", endedAt: null, playtimeSeconds: 700, startedAt: hoursAgo(1) });
    const res = await getAliveSurvivors(db, { page: 1 }, now);
    expect(res.rows.find((r) => r.gamertag === "Pacifist")!.longestKillMeters).toBeNull();
  });

  it("emits two rows for a player alive on both maps; slug filter narrows", async () => {
    await insertLife({ serverId: chern.id, gamertag: "Both", endedAt: null, playtimeSeconds: 700, startedAt: hoursAgo(1) });
    await insertLife({ serverId: sakh.id, gamertag: "Both", endedAt: null, playtimeSeconds: 700, startedAt: hoursAgo(1) });
    const all = await getAliveSurvivors(db, { page: 1 }, now);
    expect(all.rows.filter((r) => r.gamertag === "Both").map((r) => r.slug).sort()).toEqual([chern.slug, sakh.slug].sort());
    const onlySakh = await getAliveSurvivors(db, { slug: sakh.slug, page: 1 }, now);
    expect(onlySakh.rows.every((r) => r.slug === sakh.slug)).toBe(true);
    expect(onlySakh.rows.some((r) => r.gamertag === "Both")).toBe(true);
  });

  // ⚠️ ONE order, not configurable: time alive desc. Sub-project D deleted the sort layer.
  it("ranks by time alive, descending", async () => {
    await insertLife({ serverId: chern.id, gamertag: "Longer", endedAt: null, playtimeSeconds: 3600, startedAt: hoursAgo(2) });
    await insertLife({ serverId: chern.id, gamertag: "Shorter", endedAt: null, playtimeSeconds: 600, startedAt: hoursAgo(1) });
    const res = await getAliveSurvivors(db, { page: 1 }, now);
    expect(res.rows.map((r) => r.gamertag)).toEqual(["Longer", "Shorter"]);
  });

  it("a player with more kills does NOT outrank a longer-lived one", async () => {
    // The discriminating case for "time alive is primary": Killer has 3 kills and Elder has 0,
    // but Elder has been alive longer. Under the deleted kills sort, Killer led.
    await insertLife({ serverId: chern.id, gamertag: "Elder_rank", endedAt: null, playtimeSeconds: 7200, startedAt: hoursAgo(3) });
    await insertLife({ serverId: chern.id, gamertag: "Killer_rank", endedAt: null, playtimeSeconds: 900, startedAt: hoursAgo(1) });
    for (const v of ["v1", "v2", "v3"]) {
      await insertKill({ serverId: chern.id, killerGamertag: "Killer_rank", victimGamertag: v, distance: 800, occurredAt: minutesAgo(30) });
    }
    const res = await getAliveSurvivors(db, { page: 1 }, now);
    expect(res.rows.map((r) => r.gamertag)).toEqual(["Elder_rank", "Killer_rank"]);
  });

  it("paginates with a stable total", async () => {
    for (let i = 0; i < 30; i++) {
      await insertLife({ serverId: chern.id, gamertag: `P${String(i).padStart(2, "0")}`, endedAt: null, playtimeSeconds: 600 + i, startedAt: hoursAgo(2) });
    }
    const p1 = await getAliveSurvivors(db, { page: 1 }, now);
    const p2 = await getAliveSurvivors(db, { page: 2 }, now);
    expect(p1.total).toBe(30);
    expect(p1.rows).toHaveLength(25);
    expect(p2.rows).toHaveLength(5);
    // no overlap
    const s1 = new Set(p1.rows.map((r) => r.gamertag));
    expect(p2.rows.every((r) => !s1.has(r.gamertag))).toBe(true);
  });

  // The tie-break chain is time -> kills -> longest kill -> gamertag. Each test below pins one
  // link by making the EARLIER keys equal and choosing gamertags whose alphabetical order
  // contradicts the expected result, so a comparator that fell straight through to gamertag fails.
  it("breaks a time tie by kills, ahead of gamertag", async () => {
    await insertLife({ serverId: chern.id, gamertag: "Zulu_time", endedAt: null, playtimeSeconds: 3600, startedAt: hoursAgo(2) });
    await insertKill({ serverId: chern.id, killerGamertag: "Zulu_time", victimGamertag: "v1", distance: 100, occurredAt: minutesAgo(30) });
    await insertKill({ serverId: chern.id, killerGamertag: "Zulu_time", victimGamertag: "v2", distance: 100, occurredAt: minutesAgo(20) });
    await insertLife({ serverId: chern.id, gamertag: "Alpha_time", endedAt: null, playtimeSeconds: 3600, startedAt: hoursAgo(2) });
    await insertKill({ serverId: chern.id, killerGamertag: "Alpha_time", victimGamertag: "v3", distance: 100, occurredAt: minutesAgo(30) });

    const res = await getAliveSurvivors(db, { page: 1 }, now);
    expect(res.rows.map((r) => r.gamertag)).toEqual(["Zulu_time", "Alpha_time"]);
  });

  it("breaks a time+kills tie by longest kill, ahead of gamertag", async () => {
    await insertLife({ serverId: chern.id, gamertag: "Zulu_long", endedAt: null, playtimeSeconds: 3600, startedAt: hoursAgo(2) });
    await insertKill({ serverId: chern.id, killerGamertag: "Zulu_long", victimGamertag: "v1", distance: 900, occurredAt: minutesAgo(30) });
    await insertLife({ serverId: chern.id, gamertag: "Alpha_long", endedAt: null, playtimeSeconds: 3600, startedAt: hoursAgo(2) });
    await insertKill({ serverId: chern.id, killerGamertag: "Alpha_long", victimGamertag: "v2", distance: 100, occurredAt: minutesAgo(30) });

    const res = await getAliveSurvivors(db, { page: 1 }, now);
    expect(res.rows.map((r) => r.gamertag)).toEqual(["Zulu_long", "Alpha_long"]);
  });

  it("falls through to gamertag only when every metric is equal", async () => {
    await insertLife({ serverId: chern.id, gamertag: "Zulu_tie", endedAt: null, playtimeSeconds: 3600, startedAt: hoursAgo(2) });
    await insertLife({ serverId: chern.id, gamertag: "Alpha_tie", endedAt: null, playtimeSeconds: 3600, startedAt: hoursAgo(2) });
    const res = await getAliveSurvivors(db, { page: 1 }, now);
    expect(res.rows.map((r) => r.gamertag)).toEqual(["Alpha_tie", "Zulu_tie"]);
  });

  it("two survivors with no ranged kills do not produce a NaN comparison", async () => {
    // Both longest-kill metrics are -Infinity; subtracting them is NaN, which makes Array#sort
    // behave arbitrarily. The comparator's skip-if-equal guard is what prevents it.
    await insertLife({ serverId: chern.id, gamertag: "Aaa_nan", endedAt: null, playtimeSeconds: 3600, startedAt: hoursAgo(2) });
    await insertLife({ serverId: chern.id, gamertag: "Bbb_nan", endedAt: null, playtimeSeconds: 3600, startedAt: hoursAgo(2) });
    const res = await getAliveSurvivors(db, { page: 1 }, now);
    expect(res.rows.map((r) => r.gamertag)).toEqual(["Aaa_nan", "Bbb_nan"]);
  });

  it("clamps page to >= 1 and returns empty rows with the real total for an out-of-range page", async () => {
    await insertLife({ serverId: chern.id, gamertag: "Solo", endedAt: null, playtimeSeconds: 700, startedAt: hoursAgo(1) });
    const clamped = await getAliveSurvivors(db, { page: 0 }, now);
    expect(clamped.page).toBe(1);
    expect(clamped.rows.map((r) => r.gamertag)).toEqual(["Solo"]);

    const tooHigh = await getAliveSurvivors(db, { page: 99 }, now);
    expect(tooHigh.rows).toEqual([]);
    expect(tooHigh.total).toBe(1);
  });

  describe("avatarHash", () => {
    it("attaches avatarHash for a verified player with a live avatar", async () => {
      await insertLife({ serverId: chern.id, gamertag: "AvatarHero", endedAt: null, playtimeSeconds: 700, startedAt: hoursAgo(1) });
      await insertAvatarLink({ gamertag: "AvatarHero", userId: "u-avatar-hero", status: "verified", hash: "abc123" });
      const res = await getAliveSurvivors(db, { page: 1 }, now);
      expect(res.rows.find((r) => r.gamertag === "AvatarHero")!.avatarHash).toBe("abc123");
    });

    it("returns null avatarHash for a player with no gamertag link at all", async () => {
      await insertLife({ serverId: chern.id, gamertag: "NoLink", endedAt: null, playtimeSeconds: 700, startedAt: hoursAgo(1) });
      const res = await getAliveSurvivors(db, { page: 1 }, now);
      expect(res.rows.find((r) => r.gamertag === "NoLink")!.avatarHash).toBeNull();
    });

    // The hash is deliberately non-null on this tombstone-shaped (image NULL) row: it proves the
    // `image IS NOT NULL` join clause, not merely that a real tombstone's null hash comes back
    // null (which would pass even if that clause were dropped).
    it("returns null avatarHash when the avatar is tombstoned", async () => {
      await insertLife({ serverId: chern.id, gamertag: "Tombstoned", endedAt: null, playtimeSeconds: 700, startedAt: hoursAgo(1) });
      await insertAvatarLink({ gamertag: "Tombstoned", userId: "u-tombstoned", status: "verified", hash: "ghosthash", imageNull: true });
      const res = await getAliveSurvivors(db, { page: 1 }, now);
      expect(res.rows.find((r) => r.gamertag === "Tombstoned")!.avatarHash).toBeNull();
    });

    it("returns null avatarHash for a pending (unverified) gamertag link", async () => {
      await insertLife({ serverId: chern.id, gamertag: "Pending", endedAt: null, playtimeSeconds: 700, startedAt: hoursAgo(1) });
      await insertAvatarLink({ gamertag: "Pending", userId: "u-pending", status: "pending", hash: "pendinghash" });
      const res = await getAliveSurvivors(db, { page: 1 }, now);
      expect(res.rows.find((r) => r.gamertag === "Pending")!.avatarHash).toBeNull();
    });
  });
});
