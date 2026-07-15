import { describe, it, expect, beforeAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers } from "@onelife/db";
import { buildApp } from "../src/app.js";

const { db } = getTestDb();
const app = buildApp(db);

describe("GET /survivors", () => {
  beforeAll(async () => {
    await db.insert(servers).values([
      { nitradoServiceId: 401, name: "Chernarus", map: "chernarusplus", slug: "survivors-chernarus", active: true },
      { nitradoServiceId: 402, name: "Sakhal", map: "sakhal", slug: "survivors-sakhal", active: true },
    ]);
  });

  it("GET /survivors returns a SurvivorsPage with defaults", async () => {
    const res = await app.inject({ method: "GET", url: "/survivors" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ page: 1, pageSize: 25, sort: "kills" });
    expect(Array.isArray(body.rows)).toBe(true);
  });

  it("validates sort + page, coercing invalid to defaults (no 500)", async () => {
    const res = await app.inject({ method: "GET", url: "/survivors?sort=bogus&page=-4" });
    expect(res.statusCode).toBe(200);
    expect(res.json().sort).toBe("kills");
    expect(res.json().page).toBe(1);
  });

  it("GET /survivors/:slug filters to that map", async () => {
    const res = await app.inject({ method: "GET", url: "/survivors/survivors-sakhal?sort=longest" });
    expect(res.statusCode).toBe(200);
    expect(res.json().sort).toBe("longest");
  });

  it("GET /survivors/:slug 404s an unknown map", async () => {
    const res = await app.inject({ method: "GET", url: "/survivors/atlantis" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "not_found" });
  });
});
