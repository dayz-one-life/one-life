import { describe, it, expect, afterAll } from "vitest";
import { players, playerGamertags } from "@onelife/db";
import { inArray, eq } from "drizzle-orm";
import { getTestDb } from "@onelife/test-support";

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
