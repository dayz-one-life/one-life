import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { user, gamertagLinks, servers } from "@onelife/db";
import { eq } from "drizzle-orm";
import { createAuth, type Mailer } from "@onelife/auth";
import { buildApp } from "../src/app.js";
import { getTestDb } from "@onelife/test-support";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 8e8;
const email = `map${svc}@example.com`;
const pendingEmail = `mappending${svc}@example.com`;

let lastLink = "";
const captureMailer: Mailer = { async send(msg) { lastLink = msg.url; } };
const auth = createAuth(db, {
  secret: "s".repeat(32), baseURL: "http://localhost", trustedOrigins: ["http://localhost"],
  providers: {}, mailer: captureMailer,
});
const app = buildApp(db, { auth, corsOrigins: ["http://localhost"], vapidPublicKey: "TEST" });

function cookieHeader(setCookie: string | string[] | undefined): string {
  const arr = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return arr.map((c) => c.split(";")[0]).join("; ");
}
async function signIn(addr: string): Promise<string> {
  await app.inject({
    method: "POST", url: "/api/auth/sign-in/magic-link",
    headers: { "content-type": "application/json", host: "localhost", origin: "http://localhost" },
    payload: { email: addr },
  });
  const verify = await app.inject({
    method: "GET", url: lastLink.replace(/^https?:\/\/[^/]+/, ""), headers: { host: "localhost" },
  });
  return cookieHeader(verify.headers["set-cookie"] as string | string[] | undefined);
}

let cookie = "";
let pendingCookie = "";

beforeAll(async () => {
  await app.ready();
  cookie = await signIn(email);
  pendingCookie = await signIn(pendingEmail);
  await db.insert(servers)
    .values({ nitradoServiceId: svc, name: "Sakhal", map: "sakhal", slug: `sakhal-${svc}` });
});
afterAll(async () => { await app.close(); await sql.end(); });

const get = (url: string, c?: string) =>
  app.inject({ method: "GET", url, headers: c ? { cookie: c } : {} });

describe("friend map routes", () => {
  it("401s when signed out", async () => {
    expect((await get(`/me/maps/sakhal-${svc}`)).statusCode).toBe(401);
    expect((await get("/me/maps")).statusCode).toBe(401);
  });

  it("403s not_verified for a signed-in user with no verified gamertag", async () => {
    const res = await get(`/me/maps/sakhal-${svc}`, cookie);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("not_verified");
  });

  // A pending link is a claim typed into a box, not proof — only emote verification unlocks
  // coordinates. Anyone can type any gamertag; a pending link must be exactly as insufficient
  // as no link at all.
  it("403s not_verified for a signed-in user with only a PENDING gamertag link", async () => {
    const [u] = await db.select({ id: user.id }).from(user)
      .where(eq(user.email, pendingEmail.toLowerCase()));
    await db.insert(gamertagLinks)
      .values({ userId: u!.id, gamertag: `Pending${svc}`, status: "pending" });

    const res = await get(`/me/maps/sakhal-${svc}`, pendingCookie);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("not_verified");
  });

  it("serves the map once verified, with no-store", async () => {
    const [u] = await db.select({ id: user.id }).from(user).where(eq(user.email, email.toLowerCase()));
    await db.insert(gamertagLinks)
      .values({ userId: u!.id, gamertag: `Mapper${svc}`, status: "verified", verifiedAt: new Date() });

    const res = await get(`/me/maps/sakhal-${svc}`, cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json().mapCodename).toBe("sakhal");
    expect(Array.isArray(res.json().positions)).toBe(true);
    expect(res.headers["cache-control"]).toContain("no-store");
    expect(res.headers["cache-control"]).toContain("private");
  });

  it("404s an unknown server slug", async () => {
    expect((await get("/me/maps/no-such-server", cookie)).statusCode).toBe(404);
  });

  it("lists servers with friend counts", async () => {
    const res = await get("/me/maps", cookie);
    expect(res.statusCode).toBe(200);
    const entry = res.json().servers.find((s: { slug: string }) => s.slug === `sakhal-${svc}`);
    expect(entry).toBeTruthy();
    expect(entry.friendCount).toBe(0);
  });
});
