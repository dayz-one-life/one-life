import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { servers, players } from "@onelife/db";
import { eq } from "drizzle-orm";
import { getCursor, setCursor } from "@onelife/event-log";
import { rebuildAll } from "../src/rebuild.js";
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
});
