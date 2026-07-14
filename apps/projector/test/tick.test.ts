import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { servers, admFiles, players, lives, kills, sessions, events } from "@onelife/db";
import { and, eq, inArray, sql as sqlExpr } from "drizzle-orm";
import { appendEvent, getCursor, setCursor } from "@onelife/event-log";
import { projectorTick } from "../src/tick.js";
import { getTestDb } from "@onelife/test-support";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 7e8;
const consumer = `projector-${svc}`;
let serverId: number;
let admFileId: number;

let startCursor: number;

beforeAll(async () => {
  const before = await db.select({ m: sqlExpr<number>`coalesce(max(${events.id}), 0)` }).from(events);
  startCursor = Number(before[0]!.m);

  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "tick-test" }).returning();
  serverId = s!.id;
  const [f] = await db.insert(admFiles).values({ serverId, path: `/t/${svc}.ADM`, name: "t.ADM" }).returning();
  admFileId = f!.id;
  const at = (m: string) => new Date(`2026-07-06T${m}Z`);
  const seq: [number, string, object][] = [
    [0, "player.connected", { gamertag: "Victim", dayzId: "V=" }],
    [1, "player.connected", { gamertag: "Killer", dayzId: "K=" }],
    [2, "player.died", { victim: "Victim", dayzId: "V=", cause: "pvp", killer: "Killer", weapon: "M4A1", distance: 100 }],
  ];
  for (const [i, type, payload] of seq) {
    await appendEvent(db, { serverId, admFileId, lineIndex: i, subIndex: 0, type: type as any, occurredAt: at(`12:0${i}:00`), payload });
  }
  await setCursor(db, consumer, startCursor);
});
afterAll(async () => {
  await db.delete(kills).where(eq(kills.serverId, serverId));
  await db.delete(sessions).where(eq(sessions.serverId, serverId));
  await db.delete(lives).where(eq(lives.serverId, serverId));
  await db.delete(players).where(inArray(players.gamertag, ["Victim", "Killer"]));
  await sql.end();
});

describe("projectorTick", () => {
  it("applies events, advances the cursor, and is idempotent", async () => {
    // The cursor was scoped (in beforeAll) to start right before this test's own 3 seeded
    // events, and the full workspace test run is serialized (turbo --concurrency=1) so no
    // other suite is writing events concurrently. That makes it safe to assert exact counts.
    const r1 = await projectorTick(db, { batchSize: 100, consumerName: consumer });
    expect(r1.applied).toBe(3);
    const killRows = await db.select().from(kills).where(eq(kills.serverId, serverId));
    expect(killRows.length).toBe(1);

    const r2 = await projectorTick(db, { batchSize: 100, consumerName: consumer });   // caught up
    expect(r2.applied).toBe(0);
    const killRows2 = await db.select().from(kills).where(eq(kills.serverId, serverId));
    expect(killRows2.length).toBe(1);   // no duplicate kill
  });
});
