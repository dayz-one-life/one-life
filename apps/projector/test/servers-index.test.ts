import { describe, it, expect, afterAll } from "vitest";
import { servers } from "@onelife/db";
import { eq } from "drizzle-orm";
import { getTestDb } from "@onelife/test-support";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 13e8;
afterAll(async () => { await db.delete(servers).where(eq(servers.nitradoServiceId, svc)); await sql.end(); });

describe("servers service-id uniqueness", () => {
  it("allows a retired row and an active row on one service, refuses two active", async () => {
    await db.insert(servers).values({ nitradoServiceId: svc, name: "old", active: false, retiredAt: new Date("2026-10-15T00:00:00Z") });
    await db.insert(servers).values({ nitradoServiceId: svc, name: "new", ingestFrom: new Date("2026-10-15T00:00:00Z") });
    await expect(db.insert(servers).values({ nitradoServiceId: svc, name: "dup" })).rejects.toThrow();
    const rows = await db.select().from(servers).where(eq(servers.nitradoServiceId, svc));
    expect(rows).toHaveLength(2);
  });
});
