import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { servers, admFiles, rawLines, events } from "@onelife/db";
import { eq } from "drizzle-orm";
import { appendEvent } from "@onelife/event-log";
import { backfillDeathStats } from "../src/backfill-death-stats.js";
import { getTestDb } from "@onelife/test-support";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 7e8;
let serverId: number;
let admFileId: number;
let rawLineId: number;
let deathEventId: number;

const DEATH_LINE =
  'Player "flaminx0r" (DEAD) (id=875FAED7 pos=<13446.2, 12250.6, 2.5>) died. Stats> Water: 620.083 Energy: 0 Bleed sources: 1';

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "backfill-death-stats-test" }).returning();
  serverId = s!.id;

  const [f] = await db.insert(admFiles).values({ serverId, path: "x.ADM", name: "x.ADM" }).returning();
  admFileId = f!.id;

  const occurredAt = new Date("2026-07-06T12:00:00Z");
  const [rl] = await db.insert(rawLines).values({
    serverId, admFileId, lineIndex: 79, text: DEATH_LINE, occurredAt,
  }).returning();
  rawLineId = rl!.id;

  await appendEvent(db, {
    serverId, admFileId, lineIndex: 79, subIndex: 0,
    type: "player.died", occurredAt,
    payload: { victim: "flaminx0r", cause: "died", killer: null, weapon: null, distance: null },
    rawLineId,
  });

  const ev = (await db.select().from(events).where(eq(events.rawLineId, rawLineId)))[0]!;
  deathEventId = ev.id;
});

afterAll(async () => {
  await db.delete(events).where(eq(events.serverId, serverId));
  await db.delete(rawLines).where(eq(rawLines.serverId, serverId));
  await db.delete(admFiles).where(eq(admFiles.serverId, serverId));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

describe("backfillDeathStats", () => {
  it("patches a historical died event's payload with stats re-derived from its raw line", async () => {
    const { patched } = await backfillDeathStats(db);
    expect(patched).toBe(1);
    const ev = (await db.select().from(events).where(eq(events.id, deathEventId)))[0]!;
    expect((ev.payload as any).energy).toBe(0);
    expect((ev.payload as any).water).toBeCloseTo(620.083);

    const second = await backfillDeathStats(db);
    expect(second.patched).toBe(0); // idempotent
  });
});
