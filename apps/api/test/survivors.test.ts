import { describe, it, expect, beforeAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers } from "@onelife/db";
import { buildApp } from "../src/app.js";

const { db } = getTestDb();
const app = buildApp(db);

describe("GET /survivors/:slug", () => {
  beforeAll(async () => {
    await db.insert(servers).values([
      { nitradoServiceId: 401, name: "Chernarus", map: "chernarusplus", slug: "survivors-chernarus", active: true },
      { nitradoServiceId: 402, name: "Sakhal", map: "sakhal", slug: "survivors-sakhal", active: true },
    ]);
  });

  it("returns a SurvivorsPage with defaults", async () => {
    const res = await app.inject({ method: "GET", url: "/survivors/survivors-sakhal" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ page: 1, pageSize: 25 });
    expect(Array.isArray(body.rows)).toBe(true);
  });

  it("coerces an invalid page to 1 rather than 500ing", async () => {
    const res = await app.inject({ method: "GET", url: "/survivors/survivors-sakhal?page=-4" });
    expect(res.statusCode).toBe(200);
    expect(res.json().page).toBe(1);
  });

  it("404s an unknown map", async () => {
    const res = await app.inject({ method: "GET", url: "/survivors/atlantis" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "not_found" });
  });

  // ⚠️ There is no combined board (sub-project D): a life is per-server, so ranking across
  // servers puts lives in one race that were never in it. The route is gone, not merely unused.
  it("has no combined board — GET /survivors 404s", async () => {
    const res = await app.inject({ method: "GET", url: "/survivors" });
    expect(res.statusCode).toBe(404);
  });

  // ⚠️ `sort` is DROPPED, not accepted-and-ignored. The payload carries no `sort` field, so a
  // caller still sending one cannot mistake a silently-ignored parameter for a working one.
  it("carries no sort field, whatever the caller sends", async () => {
    const res = await app.inject({ method: "GET", url: "/survivors/survivors-sakhal?sort=longest" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).not.toHaveProperty("sort");
  });
});
