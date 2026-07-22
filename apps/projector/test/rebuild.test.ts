import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { servers, players, lives, admFiles, playerGamertags } from "@onelife/db";
import { eq } from "drizzle-orm";
import { getCursor, setCursor, appendEvent } from "@onelife/event-log";
import { rebuildAll } from "../src/rebuild.js";
import { projectorTick } from "../src/tick.js";
import { getTestDb } from "@onelife/test-support";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 8e8;
let serverId: number;

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "rebuild-test" }).returning();
  serverId = s!.id;
  await db.insert(players).values({ gamertag: `Stale-${svc}`, firstSeenAt: new Date(), lastSeenAt: new Date() });
  await setCursor(db, "projector", 999999);
});
afterAll(async () => { await sql.end(); });

describe("rebuildAll", () => {
  it("truncates projections and resets the cursor to 0", async () => {
    await rebuildAll(db);
    const rows = await db.select().from(players).where(eq(players.gamertag, `Stale-${svc}`));
    expect(rows.length).toBe(0);
    expect(await getCursor(db, "projector")).toBe(0);
  });

  it("truncates player_gamertags — it is a projection, not durable data", async () => {
    const [p] = await db.insert(players)
      .values({ gamertag: `RB${Date.now()}`, dayzId: `RB=${Date.now()}`, firstSeenAt: new Date(), lastSeenAt: new Date() })
      .returning();
    await db.insert(playerGamertags).values({
      playerId: p!.id, gamertag: p!.gamertag, firstSeenAt: new Date(), lastSeenAt: new Date(),
    });
    await rebuildAll(db, `rb-test-${p!.id}`);
    // Note: this assertion proves rows are gone, but TRUNCATE ... CASCADE on players
    // reaches this table through its FK regardless of the explicit list entry.
    // The entry is kept deliberately in case FK cascade behavior ever changes.
    const rows = await db.select().from(playerGamertags);
    expect(rows).toHaveLength(0);
  });

  it("after a rebuild + re-fold, one gamertag on two servers yields one global player with a per-server life", async () => {
    const svc2 = Math.floor(Math.random() * 1e8) + 8e8;
    const consumer = `rebuild-multi-${svc2}`;
    const gamertag = `Multi-${svc2}`;

    const [serverA] = await db.insert(servers).values({ nitradoServiceId: svc2, name: "rebuild-multi-a" }).returning();
    const [serverB] = await db.insert(servers).values({ nitradoServiceId: svc2 + 1, name: "rebuild-multi-b" }).returning();
    const [fileA] = await db.insert(admFiles).values({ serverId: serverA!.id, path: `/t/${svc2}-a.ADM`, name: "a.ADM" }).returning();
    const [fileB] = await db.insert(admFiles).values({ serverId: serverB!.id, path: `/t/${svc2}-b.ADM`, name: "b.ADM" }).returning();

    await appendEvent(db, {
      serverId: serverA!.id, admFileId: fileA!.id, lineIndex: 0, subIndex: 0,
      type: "player.connected", occurredAt: new Date("2026-07-06T12:00:00Z"),
      // ONE account hash across both servers — identity is the DayZ account, which does not
      // change per server. (This fixture used to mint a distinct hash per server; that only
      // folded to one row because players_gamertag_uniq merged them by name, which is the
      // silent merge migration 0025 removes.)
      payload: { gamertag, dayzId: `${svc2}-ONE=` },
    });
    await appendEvent(db, {
      serverId: serverB!.id, admFileId: fileB!.id, lineIndex: 0, subIndex: 0,
      type: "player.connected", occurredAt: new Date("2026-07-06T12:01:00Z"),
      payload: { gamertag, dayzId: `${svc2}-ONE=` },
    });

    await setCursor(db, consumer, 0);
    let applied = 0;
    for (let i = 0; i < 5; i++) {
      const r = await projectorTick(db, { batchSize: 100, consumerName: consumer });
      applied += r.applied;
      if (r.applied === 0) break;
    }
    expect(applied).toBeGreaterThanOrEqual(2);

    // Rebuild wipes everything and resets the cursor; re-folding from 0 must reproduce
    // the same end state: one global player row, two per-server life rows.
    await rebuildAll(db, consumer);
    let applied2 = 0;
    for (let i = 0; i < 5; i++) {
      const r = await projectorTick(db, { batchSize: 100, consumerName: consumer });
      applied2 += r.applied;
      if (r.applied === 0) break;
    }
    expect(applied2).toBeGreaterThanOrEqual(2);

    const playerRows = await db.select().from(players).where(eq(players.gamertag, gamertag));
    expect(playerRows.length).toBe(1);

    const lifeRows = await db.select().from(lives).where(eq(lives.playerId, playerRows[0]!.id));
    expect(lifeRows.length).toBe(2);
    const serverIds = new Set(lifeRows.map((l) => l.serverId));
    expect(serverIds.size).toBe(2);
    for (const l of lifeRows) {
      expect(l.lifeNumber).toBe(1);
    }
  });
});
