import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { user, gamertagLinks } from "@onelife/db";
import { createAuth, type Mailer } from "@onelife/auth";
import { buildApp } from "../src/app.js";
import { getTestDb } from "@onelife/test-support";

const { db, sql } = getTestDb();

// Signing in for real: the magic-link flow, with a mailer that captures the link instead of
// sending it. This mirrors apps/api/test/gamertag-links.test.ts — copy that pattern, do not
// invent a way to forge a session.
const svc = Math.floor(Math.random() * 1e8) + 5e8;
const email = `ad${svc}@example.com`;
let lastLink = "";
const captureMailer: Mailer = { async send(msg) { lastLink = msg.url; } };
const auth = createAuth(db, {
  secret: "s".repeat(32), baseURL: "http://localhost", trustedOrigins: ["http://localhost"],
  providers: {}, mailer: captureMailer,
});
const app = buildApp(db, { auth, corsOrigins: ["http://localhost"] });

let cookie = "";

function cookieHeader(setCookie: string | string[] | undefined): string {
  const arr = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return arr.map((c) => c.split(";")[0]).join("; ");
}

async function signIn(): Promise<void> {
  await app.inject({
    method: "POST", url: "/api/auth/sign-in/magic-link",
    headers: { "content-type": "application/json", host: "localhost", origin: "http://localhost" },
    payload: { email },
  });
  const verifyPath = lastLink.replace(/^https?:\/\/[^/]+/, "");
  const verify = await app.inject({ method: "GET", url: verifyPath, headers: { host: "localhost" } });
  cookie = cookieHeader(verify.headers["set-cookie"] as string | string[] | undefined);
}

beforeAll(async () => {
  await app.ready();
  await signIn();
  const [u] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
  await db.insert(gamertagLinks).values({ userId: u!.id, gamertag: `AD${svc}`, status: "verified" });
});

afterAll(async () => {
  // The happy-path test deletes the user, so this is belt-and-braces for a failed run.
  await sql`DELETE FROM "session" WHERE user_id IN (SELECT id FROM "user" WHERE email = ${email})`;
  await sql`DELETE FROM "account" WHERE user_id IN (SELECT id FROM "user" WHERE email = ${email})`;
  await sql`DELETE FROM "verification" WHERE identifier LIKE ${"%" + email + "%"}`;
  await sql`DELETE FROM "user" WHERE email = ${email}`;
  await app.close();
  await sql.end();
});

const send = (payload: Record<string, unknown>, hdrs: Record<string, string> = {}) =>
  app.inject({
    method: "DELETE", url: "/me",
    headers: { "content-type": "application/json", host: "localhost", ...hdrs },
    payload,
  });

describe("DELETE /me", () => {
  it("401s without a session", async () => {
    const res = await send({ confirm: "DELETE" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "unauthorized" });
  });

  // ⚠️ The session is checked BEFORE the body, so an unauthenticated caller cannot tell a valid
  // session from an invalid one by whether they get a 400 or a 401.
  it("401s without a session even when the confirmation is wrong", async () => {
    const res = await send({ confirm: "nope" });
    expect(res.statusCode).toBe(401);
  });

  it("400s for a signed-in caller whose confirmation is missing or wrong-cased", async () => {
    expect((await send({}, { cookie })).statusCode).toBe(400);
    expect((await send({ confirm: "delete" }, { cookie })).statusCode).toBe(400);
    expect((await send({ confirm: true }, { cookie })).statusCode).toBe(400);
  });

  // Ordered last: it destroys the session every other test depends on.
  it("deletes the account, reports the summary, and invalidates the session", async () => {
    const res = await send({ confirm: "DELETE" }, { cookie });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, tokensForfeited: 0, gamertagLinksRemoved: 1 });

    expect(await db.select().from(user).where(eq(user.email, email))).toHaveLength(0);

    // The same cookie must now be worthless — the session row went with the user.
    const after = await app.inject({ method: "GET", url: "/me", headers: { host: "localhost", cookie } });
    expect(after.statusCode).toBe(401);
  });
});
