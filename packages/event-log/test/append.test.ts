import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { servers, admFiles, events } from "@onelife/db";
import { eq, and } from "drizzle-orm";
import { appendEvent } from "../src/index.js";
import { getTestDb } from "@onelife/test-support";

const { db, sql } = getTestDb();
let serverId: number;
let admFileId: number;

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: 999001, name: "test" }).returning();
  serverId = s!.id;
  const [f] = await db.insert(admFiles).values({ serverId, path: "/t/a.ADM", name: "a.ADM" }).returning();
  admFileId = f!.id;
});

afterAll(async () => { await sql.end(); });

describe("appendEvent idempotency", () => {
  it("does not double-insert on the same idempotency key", async () => {
    const input = {
      serverId, admFileId, lineIndex: 5, subIndex: 0,
      type: "player.connected" as const, occurredAt: new Date("2026-07-06T12:00:00Z"),
      payload: { gamertag: "A", dayzId: "A=" },
    };
    await appendEvent(db, input);
    await appendEvent(db, input); // duplicate re-pull

    const rows = await db.select().from(events).where(
      and(eq(events.admFileId, admFileId), eq(events.lineIndex, 5), eq(events.subIndex, 0)),
    );
    expect(rows.length).toBe(1);
  });
});
