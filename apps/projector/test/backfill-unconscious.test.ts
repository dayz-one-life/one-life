import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { servers, admFiles, rawLines, events } from "@onelife/db";
import { eq, and } from "drizzle-orm";
import { appendEvent } from "@onelife/event-log";
import { backfillUnconscious } from "../src/backfill-unconscious.js";
import { getTestDb } from "@onelife/test-support";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 8e8;
let serverId: number;
let admFileId: number;

const UNC_LINE = 'Player "U" (id=1 pos=<1.0, 2.0, 3.0>) is unconscious';
const REGAINED_LINE = 'Player "U" (id=1 pos=<1.0, 2.0, 3.0>) regained consciousness';
const OCCURRED = new Date("2026-07-10T12:00:00Z");

/** Seed a raw line exactly as history holds it: player.position already at subIndex 0. */
async function seed(lineIndex: number, text: string) {
  const [rl] = await db.insert(rawLines).values({ serverId, admFileId, lineIndex, text, occurredAt: OCCURRED }).returning();
  await appendEvent(db, { serverId, admFileId, lineIndex, subIndex: 0, type: "player.position",
    occurredAt: OCCURRED, payload: { gamertag: "U", x: 1, y: 2 }, rawLineId: rl!.id });
  return rl!.id;
}

let uncRawLineId: number;
let regainedRawLineId: number;

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "backfill-unconscious-test" }).returning();
  serverId = s!.id;
  const [f] = await db.insert(admFiles).values({ serverId, path: "u.ADM", name: "u.ADM" }).returning();
  admFileId = f!.id;
  uncRawLineId = await seed(10, UNC_LINE);
  regainedRawLineId = await seed(11, REGAINED_LINE);
});

afterAll(async () => {
  await db.delete(events).where(eq(events.serverId, serverId));
  await db.delete(rawLines).where(eq(rawLines.serverId, serverId));
  await db.delete(admFiles).where(eq(admFiles.serverId, serverId));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

describe("backfillUnconscious", () => {
  it("appends one event at subIndex 1, skips regained-consciousness, and is idempotent", async () => {
    const first = await backfillUnconscious(db);
    expect(first.appended).toBe(1);

    const rows = await db.select().from(events).where(eq(events.rawLineId, uncRawLineId));
    const unc = rows.filter((r) => r.type === "player.unconscious");
    expect(unc).toHaveLength(1);
    // ⚠️ subIndex 1, never 0 — position already owns 0 on every historical line. A 0 here
    // collides with events_idempotency_uniq and silently appends nothing.
    expect(unc[0]!.subIndex).toBe(1);

    // `regained consciousness` is not evidence of going down; the parser must ignore it.
    const regained = await db.select().from(events)
      .where(and(eq(events.rawLineId, regainedRawLineId), eq(events.type, "player.unconscious")));
    expect(regained).toHaveLength(0);

    // Re-running must be a no-op — appendEvent's onConflictDoNothing on the four-column key.
    const second = await backfillUnconscious(db);
    expect(second.appended).toBe(1);   // parsed again...
    const after = await db.select().from(events).where(eq(events.rawLineId, uncRawLineId));
    expect(after.filter((r) => r.type === "player.unconscious")).toHaveLength(1); // ...but inserted once
  });
});
