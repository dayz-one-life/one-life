import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { servers, admFiles } from "@onelife/db";
import { appendEvent, getCursor, setCursor, readEventBatch } from "../src/index.js";
import { getTestDb } from "@onelife/test-support";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 5e8;
let serverId: number;
let admFileId: number;

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "cursor-test" }).returning();
  serverId = s!.id;
  const [f] = await db.insert(admFiles).values({ serverId, path: `/t/${svc}.ADM`, name: "c.ADM" }).returning();
  admFileId = f!.id;
  for (let i = 0; i < 3; i++) {
    await appendEvent(db, { serverId, admFileId, lineIndex: i, subIndex: 0,
      type: "player.connected", occurredAt: new Date("2026-07-06T12:00:00Z"), payload: { gamertag: "A", dayzId: "A=" } });
  }
});
afterAll(async () => { await sql.end(); });

describe("cursor helpers", () => {
  it("defaults to 0 for an unseen consumer", async () => {
    expect(await getCursor(db, `c-${svc}`)).toBe(0);
  });
  it("reads a batch after an id and persists the cursor", async () => {
    const batch = await readEventBatch(db, 0, 100000);
    const mine = batch.filter((e) => e.serverId === serverId);
    expect(mine.length).toBe(3);
    await setCursor(db, `c-${svc}`, mine[2]!.id);
    expect(await getCursor(db, `c-${svc}`)).toBe(mine[2]!.id);
  });
});
