import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { getTestDb } from "@onelife/test-support";

const { db, sql } = getTestDb();

const app = buildApp(db, undefined, { ios: "1.2.0", android: "1.1.0" });

beforeAll(async () => { await app.ready(); });
afterAll(async () => { await app.close(); await sql.end(); });

describe("GET /api/app-version", () => {
  it("publishes the configured floor for both platforms", async () => {
    const res = await app.inject({ method: "GET", url: "/api/app-version" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ios: { minimumVersion: "1.2.0" }, android: { minimumVersion: "1.1.0" } });
  });

  // No session, no bearer token. This is the mobile app's FIRST call, made before sign-in and
  // before it knows whether it is even allowed to run — gating it behind auth would mean an
  // expired token could not be distinguished from an app too old to refresh one.
  it("is public — no session required", async () => {
    const res = await app.inject({ method: "GET", url: "/api/app-version" });
    expect(res.statusCode).toBe(200);
  });

  // Registered unconditionally, NOT inside buildApp's `if (opts)` auth block. A deployment
  // without auth options still serves the public site, and an app pointed at it must still be
  // able to ask whether it may run.
  it("is served even when the app is built without auth options", async () => {
    const bare = buildApp(db);
    await bare.ready();
    const res = await bare.inject({ method: "GET", url: "/api/app-version" });
    expect(res.statusCode).toBe(200);
    // Falls back to the off value rather than 404ing or throwing.
    expect(res.json()).toEqual({ ios: { minimumVersion: "0.0.0" }, android: { minimumVersion: "0.0.0" } });
    await bare.close();
  });

  it("takes no parameters — an unknown platform cannot be asked for", async () => {
    const res = await app.inject({ method: "GET", url: "/api/app-version?platform=windows" });
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json()).sort()).toEqual(["android", "ios"]);
  });
});
