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
