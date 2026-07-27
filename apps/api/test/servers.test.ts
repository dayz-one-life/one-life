import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { servers } from "@onelife/db";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { getTestDb } from "@onelife/test-support";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 13e7;
let serverId: number;
const app = buildApp(db);

beforeAll(async () => {
  await app.ready();
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "api-test" }).returning();
  serverId = s!.id;
});
afterAll(async () => {
  await db.delete(servers).where(eq(servers.id, serverId));
  await app.close();
  await sql.end();
});

describe("GET /servers", () => {
  it("lists servers", async () => {
    const res = await app.inject({ method: "GET", url: "/servers" });
    expect(res.statusCode).toBe(200);
    expect(res.json().some((s: any) => s.id === serverId)).toBe(true);
  });
  // ⚠️ The map switcher renders this list AS GIVEN. Without an ORDER BY Postgres returns
  // whatever order suits it, which differs between fetches — the dropdown visibly reshuffled
  // on every map change. Alphabetical by display name, case-folded, id as the tie-break.
  it("returns servers alphabetically by name", async () => {
    // ⚠️ These names discriminate the CASE-FOLD, not just the sort: under C/musl collation an
    // un-folded ORDER BY name yields Alpha, CHARLIE, beta (uppercase sorts before lowercase),
    // so dropping lower() from the route fails this test rather than surviving it.
    const inserted = await db.insert(servers).values([
      { nitradoServiceId: svc + 1, name: "beta-order-test" },
      { nitradoServiceId: svc + 2, name: "Alpha-order-test" },
      { nitradoServiceId: svc + 3, name: "CHARLIE-order-test" },
    ]).returning();
    try {
      const res = await app.inject({ method: "GET", url: "/servers" });
      const ids = new Set(inserted.map((s) => s.id));
      const names = res.json()
        .filter((s: any) => ids.has(s.id))
        .map((s: any) => s.name);
      expect(names).toEqual(["Alpha-order-test", "beta-order-test", "CHARLIE-order-test"]);
    } finally {
      for (const s of inserted) await db.delete(servers).where(eq(servers.id, s.id));
    }
  });
  it("roster returns 200 array for a known server", async () => {
    const res = await app.inject({ method: "GET", url: `/servers/${serverId}/roster` });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });
  it("roster returns 400 for a non-numeric id", async () => {
    const res = await app.inject({ method: "GET", url: `/servers/abc/roster` });
    expect(res.statusCode).toBe(400);
  });
});
