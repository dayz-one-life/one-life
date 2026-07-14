import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createAuth, type Mailer } from "@onelife/auth";
import { buildApp } from "../src/app.js";
import { getTestDb } from "@onelife/test-support";

const { db, sql } = getTestDb();

let lastLink = "";
const captureMailer: Mailer = { async send(msg) { lastLink = msg.url; } };

const auth = createAuth(db, {
  secret: "s".repeat(32),
  baseURL: "http://localhost",
  trustedOrigins: ["http://localhost"],
  providers: {},
  mailer: captureMailer,
});
const app = buildApp(db, { auth, corsOrigins: ["http://localhost"] });
const email = `u${Math.floor(Math.random() * 1e8)}@example.com`;

beforeAll(async () => { await app.ready(); });
afterAll(async () => {
  await sql`DELETE FROM "session" WHERE user_id IN (SELECT id FROM "user" WHERE email = ${email})`;
  await sql`DELETE FROM "account" WHERE user_id IN (SELECT id FROM "user" WHERE email = ${email})`;
  await sql`DELETE FROM "verification" WHERE identifier LIKE ${"%" + email + "%"}`;
  await sql`DELETE FROM "user" WHERE email = ${email}`;
  await app.close();
  await sql.end();
});

function cookieHeader(setCookie: string | string[] | undefined): string {
  const arr = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return arr.map((c) => c.split(";")[0]).join("; ");
}

describe("auth: magic link -> session -> /me", () => {
  it("401 when unauthenticated", async () => {
    const res = await app.inject({ method: "GET", url: "/me", headers: { host: "localhost" } });
    expect(res.statusCode).toBe(401);
  });

  it("mount is served (not a Fastify 404)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/auth/ok", headers: { host: "localhost" } });
    expect(res.statusCode).not.toBe(404);
  });

  it("sends a magic link, verifies it, and resolves /me via cookie and bearer", async () => {
    const signIn = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/magic-link",
      headers: { "content-type": "application/json", host: "localhost", origin: "http://localhost" },
      payload: { email },
    });
    expect(signIn.statusCode).toBe(200);
    expect(lastLink).toContain("/api/auth/magic-link/verify");

    const verifyPath = lastLink.replace(/^https?:\/\/[^/]+/, "");
    const verify = await app.inject({ method: "GET", url: verifyPath, headers: { host: "localhost" } });
    // verify redirects (302) to callbackURL with the session cookie set.
    const cookie = cookieHeader(verify.headers["set-cookie"] as string | string[] | undefined);
    expect(cookie).toBeTruthy();

    const meCookie = await app.inject({ method: "GET", url: "/me", headers: { cookie, host: "localhost" } });
    expect(meCookie.statusCode).toBe(200);
    expect(meCookie.json().user.email).toBe(email);
    expect(Array.isArray(meCookie.json().accounts)).toBe(true);

    const token = verify.headers["set-auth-token"] as string | undefined;
    expect(token).toBeTruthy();
    const meBearer = await app.inject({
      method: "GET",
      url: "/me",
      headers: { authorization: `Bearer ${token}`, host: "localhost" },
    });
    expect(meBearer.statusCode).toBe(200);
    expect(meBearer.json().user.email).toBe(email);
  });
});
