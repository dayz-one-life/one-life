import { describe, it, expect } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { buildApp } from "../src/app.js";

const { db } = getTestDb();
const app = buildApp(db);

describe("GET /fresh-spawns", () => {
  it("returns a FreshSpawnsPage with defaults", async () => {
    const res = await app.inject({ method: "GET", url: "/fresh-spawns" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ page: 1, pageSize: 20 });
    expect(Array.isArray(body.rows)).toBe(true);
  });

  it("coerces invalid page to 1 (no 500)", async () => {
    const res = await app.inject({ method: "GET", url: "/fresh-spawns?page=oops" });
    expect(res.statusCode).toBe(200);
    expect(res.json().page).toBe(1);
  });
});
