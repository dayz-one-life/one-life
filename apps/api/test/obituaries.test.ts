import { describe, it, expect } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { buildApp } from "../src/app.js";

const { db } = getTestDb();
const app = buildApp(db);

describe("GET /obituaries", () => {
  it("returns an ObituariesPage with defaults", async () => {
    const res = await app.inject({ method: "GET", url: "/obituaries" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ page: 1, pageSize: 20 });
    expect(Array.isArray(body.rows)).toBe(true);
    expect(typeof body.total).toBe("number");
  });

  it("coerces invalid page to 1 (no 500)", async () => {
    const res = await app.inject({ method: "GET", url: "/obituaries?page=-3" });
    expect(res.statusCode).toBe(200);
    expect(res.json().page).toBe(1);
  });
});
