import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  user, gamertagLinks, servers, players, lives, sessions, positions,
} from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { getOnlinePlayers, ONLINE_MAX_AGE_SECONDS } from "../src/online-players.js";
import type { FriendPosition } from "../src/friend-positions.js";

const { db, sql } = getTestDb();
const NOW = new Date("2026-07-22T12:00:00Z");
const CONNECTED_AT = new Date("2026-07-22T11:00:00Z"); // an hour ago: too old to be its own evidence
const STALE = new Date(NOW.getTime() - (ONLINE_MAX_AGE_SECONDS + 60) * 1000);

let serverId = 0;
let otherServerId = 0;

/**
 * Viewer "va" (ViewerMike) plus three others, all with an open session on the map's server:
 * - "vb" (Zulu):   the tuneable one — the options below drive this row.
 * - "AaStranger": alphabetically FIRST.
 * - "AbStranger": alphabetically SECOND — the one the ordering test makes share, so a collapse
 *                 of the sharing tier into `rest` reorders them.
 *
 * ⚠️ The stranger callsigns are prefixed rather than the obvious "Alpha"/"Bravo": every test
 * file in this package shares ONE database, and claimable.test.ts seeds a player literally
 * named "Alpha". Colliding produced a duplicate-key failure there plus an FK violation when
 * its afterAll deleted a row this file had hung lives off. Sorting first is what the ordering
 * test needs; the name only has to be unique across the package.
 *
 * Every player also gets a fresh `positions` row on the map's server, because that — not the
 * global `players.last_seen_at` — is what proves someone is on THIS server.
 */
async function seed(o: {
  zuluSeenAt?: Date;
  zuluDisconnectedAt?: Date | null;
  /** Put Zulu's fresh fix on the OTHER server instead of this one. */
  zuluSeenOnOtherServer?: boolean;
} = {}) {
  await sql`truncate table positions, sessions, lives, players, servers, gamertag_links, "user" restart identity cascade`;

  await db.insert(user).values([
    { id: "va", name: "VA", email: "va@x.com" },
    { id: "vb", name: "VB", email: "vb@x.com" },
  ]);
  await db.insert(gamertagLinks).values([
    { userId: "va", gamertag: "ViewerMike", status: "verified", verifiedAt: NOW },
    { userId: "vb", gamertag: "Zulu", status: "verified", verifiedAt: NOW },
  ]);

  const [srv] = await db.insert(servers)
    .values({ nitradoServiceId: 996001, name: "Sakhal", map: "sakhal", slug: "op-sakhal" })
    .returning();
  serverId = srv!.id;
  const [other] = await db.insert(servers)
    .values({ nitradoServiceId: 996002, name: "Chernarus", map: "chernarusplus", slug: "op-cher" })
    .returning();
  otherServerId = other!.id;

  const zuluSeenAt = o.zuluSeenAt ?? NOW;
  const rows: {
    gamertag: string;
    seenAt: Date;
    disconnectedAt: Date | null;
    positionServerId: number;
  }[] = [
    { gamertag: "ViewerMike", seenAt: NOW, disconnectedAt: null, positionServerId: serverId },
    {
      gamertag: "Zulu",
      seenAt: zuluSeenAt,
      disconnectedAt: o.zuluDisconnectedAt ?? null,
      positionServerId: o.zuluSeenOnOtherServer ? otherServerId : serverId,
    },
    { gamertag: "AaStranger", seenAt: NOW, disconnectedAt: null, positionServerId: serverId },
    { gamertag: "AbStranger", seenAt: NOW, disconnectedAt: null, positionServerId: serverId },
  ];

  for (const r of rows) {
    // `last_seen_at` is GLOBAL and is deliberately always fresh here: the staleness bound must
    // hold on per-server evidence alone, so a fixture that also staled this column would let a
    // global-column implementation pass.
    const [p] = await db.insert(players).values({ gamertag: r.gamertag, lastSeenAt: NOW }).returning();
    const [life] = await db.insert(lives)
      .values({ serverId, playerId: p!.id, lifeNumber: 1, startedAt: new Date("2026-07-22T10:00:00Z") })
      .returning();
    await db.insert(sessions).values({
      serverId, playerId: p!.id, lifeId: life!.id,
      connectedAt: CONNECTED_AT,
      disconnectedAt: r.disconnectedAt,
    });
    await db.insert(positions).values({
      serverId: r.positionServerId, playerId: p!.id, gamertag: r.gamertag,
      x: 1000, y: 2000, recordedAt: r.seenAt,
    });
  }
}

const call = (positionDtos: FriendPosition[] = []) =>
  getOnlinePlayers(db, { viewerUserId: "va", serverId, now: NOW, positions: positionDtos });

beforeEach(() => seed());
afterAll(async () => { await sql.end(); });

describe("getOnlinePlayers", () => {
  it("lists a player with an open session seen just now", async () => {
    const out = await call();
    const other = out.find((p) => p.gamertag === "AaStranger");
    expect(other).toBeDefined();
    expect(other!.self).toBe(false);
    expect(other!.sharing).toBe(false);
  });

  it("EXCLUDES an open session whose player has not been seen for 15 minutes", async () => {
    await seed({ zuluSeenAt: STALE });
    const out = await call();
    expect(out.map((p) => p.gamertag)).not.toContain("Zulu");
  });

  // The staleness bound must be PER SERVER. `players.last_seen_at` is one global column, so a
  // player who crashed here (session left open) and then hopped to another server keeps a fresh
  // GLOBAL heartbeat while playing there — and would be listed as online here until the next
  // even-hour reboot. Proven red against the `players.last_seen_at` implementation.
  it("EXCLUDES a player whose only fresh activity is on ANOTHER server", async () => {
    await seed({ zuluSeenOnOtherServer: true });
    const out = await call();
    expect(out.map((p) => p.gamertag)).not.toContain("Zulu");
    // The players actually here are unaffected.
    expect(out.map((p) => p.gamertag)).toContain("AaStranger");
  });

  // The other half of the bound: someone who joined seconds ago has no position dump yet, and
  // must not be dropped for it.
  it("includes a player who just connected and has no position on this server yet", async () => {
    await seed({ zuluSeenOnOtherServer: true });
    await sql`update sessions set connected_at = ${NOW.toISOString()}
              where player_id = (select id from players where gamertag = 'Zulu')`;
    const out = await call();
    expect(out.map((p) => p.gamertag)).toContain("Zulu");
  });

  it("excludes a closed session even when the fix is recent", async () => {
    await seed({ zuluDisconnectedAt: new Date("2026-07-22T11:59:00Z"), zuluSeenAt: NOW });
    const out = await call();
    expect(out.map((p) => p.gamertag)).not.toContain("Zulu");
  });

  // ⚠️ EVERY callsign here fights the alphabet. The sharing stranger is the alphabetically LATER
  // one on purpose: `p.self ? 0 : 1` alone or a collapse of the `sharing` tier into `rest` would
  // reorder AbStranger ahead of AaStranger, which the localeCompare tie-break would otherwise
  // paper over if the sharing stranger sorted first by name.
  it("orders self, then sharing, then the rest", async () => {
    const out = await call([
      { gamertag: "AbStranger", x: 2, y: 2, recordedAt: NOW, self: false },
    ]);
    expect(out.map((p) => p.gamertag)).toEqual([
      "ViewerMike",  // self
      "AbStranger",  // sharing        — later by name, so a collapse into `rest` reorders
      "AaStranger",  // neither
      "Zulu",        // neither
    ]);
  });

  it("marks `sharing` from the positions passed in, not from a fresh consent lookup", async () => {
    const out = await call([
      { gamertag: "AbStranger", x: 1, y: 1, recordedAt: NOW, self: false },
    ]);
    expect(out.find((p) => p.gamertag === "AbStranger")!.sharing).toBe(true);
    expect(out.find((p) => p.gamertag === "Zulu")!.sharing).toBe(false);
    expect(out.find((p) => p.gamertag === "AaStranger")!.sharing).toBe(false);
    expect(out.find((p) => p.gamertag === "ViewerMike")!.sharing).toBe(false);
  });

  it("marks the viewer's own row `self`", async () => {
    const out = await call();
    const mine = out.find((p) => p.gamertag === "ViewerMike");
    expect(mine).toBeDefined();
    expect(mine!.self).toBe(true);
    for (const p of out) {
      if (p.gamertag !== "ViewerMike") expect(p.self).toBe(false);
    }
  });
});
