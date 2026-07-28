import { describe, it, expect } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { buildApp } from "../src/app.js";

const { db } = getTestDb();
const app = buildApp(db);

describe("GET /stats", () => {
  it("is public and returns the two ledger numbers", async () => {
    const res = await app.inject({ method: "GET", url: "/stats" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.deaths).toBe("number");
    expect(typeof body.alive).toBe("number");
    // Nothing player-scoped in the payload — exactly two fields.
    expect(Object.keys(body).sort()).toEqual(["alive", "deaths"]);
  });
});
