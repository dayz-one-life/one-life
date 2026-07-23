import { describe, it, expect, afterAll } from "vitest";
import { players, playerGamertags, kills, servers } from "@onelife/db";
import { inArray, eq, and } from "drizzle-orm";
import { getTestDb } from "@onelife/test-support";
import { resolveSlugMatch } from "../src/player-aggregate.js";

const { db, sql } = getTestDb();
const tag = `Ident${Math.floor(Math.random() * 1e8)}`;

afterAll(async () => {
  await db.delete(players).where(inArray(players.gamertag, [tag, `${tag}Renamed`]));
  await sql.end();
});

describe("player_gamertags", () => {
  it("records more than one name for one player", async () => {
    const [p] = await db.insert(players)
      .values({ gamertag: tag, dayzId: `H=${tag}`, firstSeenAt: new Date(), lastSeenAt: new Date() })
      .returning();
    await db.insert(playerGamertags).values([
      { playerId: p!.id, gamertag: tag, firstSeenAt: new Date("2026-07-01T00:00:00Z"), lastSeenAt: new Date("2026-07-02T00:00:00Z") },
      { playerId: p!.id, gamertag: `${tag}Renamed`, firstSeenAt: new Date("2026-07-03T00:00:00Z"), lastSeenAt: new Date("2026-07-04T00:00:00Z") },
    ]);
    const rows = await db.select().from(playerGamertags).where(eq(playerGamertags.playerId, p!.id));
    expect(rows).toHaveLength(2);
  });

  it("rejects the same name twice for ONE player, case-insensitively", async () => {
    const [p] = await db.select().from(players).where(eq(players.gamertag, tag));
    await expect(
      db.insert(playerGamertags).values({
        playerId: p!.id, gamertag: tag.toLowerCase(),
        firstSeenAt: new Date(), lastSeenAt: new Date(),
      }),
    ).rejects.toThrow(/player_gamertags_player_name_uniq/);
  });

  it("ALLOWS the same name under two different players (gamertag recycling)", async () => {
    // Not hypothetical: Xbox releases and reissues gamertags. A global unique here would
    // crash the ingest the first time it happened.
    const [other] = await db.insert(players)
      .values({ gamertag: `${tag}Other`, dayzId: `H2=${tag}`, firstSeenAt: new Date(), lastSeenAt: new Date() })
      .returning();
    await db.insert(playerGamertags).values({
      playerId: other!.id, gamertag: tag, firstSeenAt: new Date(), lastSeenAt: new Date(),
    });
    const rows = await db.select().from(playerGamertags).where(eq(playerGamertags.gamertag, tag));
    expect(rows.length).toBeGreaterThanOrEqual(2);
    await db.delete(players).where(eq(players.id, other!.id));
  });
});

describe("resolveSlugMatch", () => {
  it("resolves a CURRENT name directly, not via an alias", async () => {
    const [p] = await db.select().from(players).where(eq(players.gamertag, tag));
    const m = await resolveSlugMatch(db, tag.toLowerCase());
    expect(m).toEqual({ gamertag: p!.gamertag, viaAlias: false });
  });

  it("resolves an OLD name to the current one, flagged as an alias", async () => {
    const [p] = await db.select().from(players).where(eq(players.gamertag, tag));
    await db.insert(playerGamertags).values({
      playerId: p!.id, gamertag: `${tag}Former`,
      firstSeenAt: new Date("2026-06-01T00:00:00Z"), lastSeenAt: new Date("2026-06-02T00:00:00Z"),
    });
    const m = await resolveSlugMatch(db, `${tag}Former`.toLowerCase());
    expect(m).toEqual({ gamertag: p!.gamertag, viaAlias: true });
  });

  it("returns null for a name nobody has ever used", async () => {
    expect(await resolveSlugMatch(db, "nobodyhaseverbeencalledthis")).toBeNull();
  });

  it("resolves two players holding the same current gamertag to the most recently seen one", async () => {
    // Same casing would slug-normalize to the same target AND collapse to the same `gamertag`
    // string in the result, making the two rows indistinguishable by the assertion. Different
    // casing still normalizes to one slug but keeps the returned string distinguishable, so the
    // test can actually tell which of the two rows was picked — inserting the stale
    // (soon-to-be-wrong) row FIRST forces a bare `.limit(1)` (no ORDER BY) to fail here, since an
    // unordered query tends to hand back rows in something close to insertion/physical order.
    const staleTag = `${tag}Recycled`;
    const freshTag = `${tag}RECYCLED`;
    const [stale] = await db.insert(players)
      .values({
        gamertag: staleTag, dayzId: `H3=${tag}`,
        firstSeenAt: new Date("2026-01-01T00:00:00Z"), lastSeenAt: new Date("2026-01-02T00:00:00Z"),
      })
      .returning();
    const [fresh] = await db.insert(players)
      .values({
        gamertag: freshTag, dayzId: `H4=${tag}`,
        firstSeenAt: new Date("2026-07-01T00:00:00Z"), lastSeenAt: new Date("2026-07-02T00:00:00Z"),
      })
      .returning();
    try {
      const m = await resolveSlugMatch(db, staleTag.toLowerCase());
      expect(m).toEqual({ gamertag: freshTag, viaAlias: false });
    } finally {
      await db.delete(players).where(inArray(players.id, [stale!.id, fresh!.id]));
    }
  });
});

describe("stats follow the identity across a rename", () => {
  it("counts a kill recorded under a FORMER gamertag", async () => {
    const [p] = await db.select().from(players).where(eq(players.gamertag, tag));
    const [srv] = await db.insert(servers)
      .values({ nitradoServiceId: 990000 + (p!.id % 1000), name: "ident", map: "sakhal", slug: `ident-${p!.id}` })
      .returning();
    await db.insert(kills).values({
      serverId: srv!.id,
      killerGamertag: `${tag}Former`,      // the name at the time
      killerPlayerId: p!.id,               // the identity, resolved by the fold
      victimGamertag: "SomeoneElse",
      occurredAt: new Date("2026-06-01T12:00:00Z"),
    });

    const rows = await db.select().from(kills)
      .where(and(eq(kills.serverId, srv!.id), eq(kills.killerPlayerId, p!.id)));
    expect(rows).toHaveLength(1);

    // The name-keyed predicate this task removes would have missed it.
    const byName = await db.select().from(kills)
      .where(and(eq(kills.serverId, srv!.id), eq(kills.killerGamertag, p!.gamertag)));
    expect(byName).toHaveLength(0);

    await db.delete(kills).where(eq(kills.serverId, srv!.id));
    await db.delete(servers).where(eq(servers.id, srv!.id));
  });

  it("does NOT count a kill whose killer_player_id is null", async () => {
    // killer_player_id is nullable — the fold leaves it null when the killer had no players
    // row at the time. eq() never matches NULL, which is the behaviour we want; a predicate
    // that treated NULL as a wildcard would credit one player with everyone's orphan kills.
    const [p] = await db.select().from(players).where(eq(players.gamertag, tag));
    const [srv] = await db.insert(servers)
      .values({ nitradoServiceId: 991000 + (p!.id % 1000), name: "ident2", map: "sakhal", slug: `ident2-${p!.id}` })
      .returning();
    await db.insert(kills).values({
      serverId: srv!.id, killerGamertag: "GhostKiller", killerPlayerId: null,
      victimGamertag: "SomeoneElse", occurredAt: new Date("2026-06-02T12:00:00Z"),
    });
    const rows = await db.select().from(kills)
      .where(and(eq(kills.serverId, srv!.id), eq(kills.killerPlayerId, p!.id)));
    expect(rows).toHaveLength(0);

    await db.delete(kills).where(eq(kills.serverId, srv!.id));
    await db.delete(servers).where(eq(servers.id, srv!.id));
  });
});

describe("players_dayz_id_uniq", () => {
  const dtag = `Dz${Math.floor(Math.random() * 1e8)}`;

  afterAll(async () => {
    await db.delete(players).where(inArray(players.gamertag, [`${dtag}A`, `${dtag}B`, `${dtag}N1`, `${dtag}N2`]));
  });

  it("rejects a second players row with the same dayz_id", async () => {
    await db.insert(players).values({ gamertag: `${dtag}A`, dayzId: `HASH-${dtag}`, firstSeenAt: new Date(), lastSeenAt: new Date() });
    await expect(
      db.insert(players).values({ gamertag: `${dtag}B`, dayzId: `HASH-${dtag}`, firstSeenAt: new Date(), lastSeenAt: new Date() }),
    ).rejects.toThrow(/players_dayz_id_uniq/);
  });

  it("still allows two rows with a NULL dayz_id (nulls-distinct)", async () => {
    await db.insert(players).values({ gamertag: `${dtag}N1`, dayzId: null, firstSeenAt: new Date(), lastSeenAt: new Date() });
    await db.insert(players).values({ gamertag: `${dtag}N2`, dayzId: null, firstSeenAt: new Date(), lastSeenAt: new Date() });
    const rows = await db.select().from(players).where(inArray(players.gamertag, [`${dtag}N1`, `${dtag}N2`]));
    expect(rows).toHaveLength(2);
  });
});
