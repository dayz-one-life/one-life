import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createAuth, consoleMailer, type AuthConfig } from "@onelife/auth";
import { buildApp } from "../src/app.js";
import { getTestDb } from "@onelife/test-support";

const { db, sql } = getTestDb();

const authConfig: AuthConfig = {
  secret: "s".repeat(32),
  baseURL: "http://localhost",
  trustedOrigins: ["http://localhost"],
  providers: { discord: { clientId: "id", clientSecret: "sec" } },
  magicLink: true,
  mailer: consoleMailer,
};
const auth = createAuth(db, authConfig);
const app = buildApp(db, { auth, authConfig, corsOrigins: ["http://localhost"] });

beforeAll(async () => { await app.ready(); });
afterAll(async () => { await app.close(); await sql.end(); });

describe("GET /api/auth/providers", () => {
  it("returns only the configured methods and wins over the /api/auth/* catch-all", async () => {
    const res = await app.inject({ method: "GET", url: "/api/auth/providers", headers: { host: "localhost" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ providers: ["discord"], magicLink: true });
  });
});
