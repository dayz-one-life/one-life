import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { user, gamertagLinks, servers, players, lives, sessions } from "@onelife/db";
import { eq, inArray } from "drizzle-orm";
import { createAuth, type Mailer } from "@onelife/auth";
import { buildApp } from "../src/app.js";
import { getTestDb } from "@onelife/test-support";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 46e7;
const email = `lastmap${svc}@example.com`;
const otherEmail = `lastmapother${svc}@example.com`;
const GAMERTAG = `LastMap${svc}`;
const OTHER_GAMERTAG = `LastMapOther${svc}`;

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
let otherCookie = "";
let serverId = 0;
let slug = "";

beforeAll(async () => {
  await app.ready();
  cookie = await signIn(email);
  otherCookie = await signIn(otherEmail);

  const [s] = await db.insert(servers)
    .values({ nitradoServiceId: svc, name: "LM-Sakhal", map: "sakhal", slug: `lm-sakhal-${svc}`, active: true })
    .returning();
  serverId = s!.id;
  slug = s!.slug!;

  const now = new Date();
  const [mine] = await db.insert(players)
    .values({ gamertag: GAMERTAG, dayzId: `dz-${GAMERTAG}`, firstSeenAt: now, lastSeenAt: now })
    .returning();
  const [theirs] = await db.insert(players)
    .values({ gamertag: OTHER_GAMERTAG, dayzId: `dz-${OTHER_GAMERTAG}`, firstSeenAt: now, lastSeenAt: now })
    .returning();

  const [l] = await db.insert(lives)
    .values({ serverId, playerId: mine!.id, lifeNumber: 1, startedAt: now, endedAt: null, playtimeSeconds: 100 })
    .returning();
  await db.insert(sessions)
    .values({ serverId, playerId: mine!.id, lifeId: l!.id, connectedAt: now });

  // The other user is verified and has a player row, but NO session — so if the route ever
  // resolved a subject from anything but its own session, this is the account it would leak into.
  const [ol] = await db.insert(lives)
    .values({ serverId, playerId: theirs!.id, lifeNumber: 1, startedAt: now, endedAt: null, playtimeSeconds: 100 })
    .returning();
  void ol;

  const [me] = await db.select().from(user).where(eq(user.email, email));
  const [them] = await db.select().from(user).where(eq(user.email, otherEmail));
  await db.insert(gamertagLinks).values({ userId: me!.id, gamertag: GAMERTAG, status: "verified" });
  await db.insert(gamertagLinks).values({ userId: them!.id, gamertag: OTHER_GAMERTAG, status: "verified" });
});

afterAll(async () => {
  await db.delete(sessions).where(eq(sessions.serverId, serverId));
  await db.delete(lives).where(eq(lives.serverId, serverId));
  await db.delete(gamertagLinks).where(inArray(gamertagLinks.gamertag, [GAMERTAG, OTHER_GAMERTAG]));
  await db.delete(players).where(inArray(players.gamertag, [GAMERTAG, OTHER_GAMERTAG]));
  await db.delete(servers).where(eq(servers.id, serverId));
  await db.delete(user).where(inArray(user.email, [email, otherEmail]));
  await app.close();
  await sql.end();
});

describe("GET /me/last-map", () => {
  it("returns the signed-in viewer's last played slug", async () => {
    const res = await app.inject({ method: "GET", url: "/me/last-map", headers: { cookie, host: "localhost" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ slug });
  });

  // ⚠️ A signed-out viewer is a 200 with a null slug, NOT a 401. This is a resolution hint, not a
  // protected resource — `/maps` and `/survivors` are both public and would have to treat a 401
  // as "no memory" anyway.
  it("returns 200 with a null slug when signed out", async () => {
    const res = await app.inject({ method: "GET", url: "/me/last-map", headers: { host: "localhost" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ slug: null });
  });

  it("returns a null slug for a verified user who has never connected", async () => {
    const res = await app.inject({ method: "GET", url: "/me/last-map", headers: { cookie: otherCookie, host: "localhost" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ slug: null });
  });

  // ⚠️ The route takes NO subject parameter, so naming another player is unexpressible rather
  // than merely rejected. These would be the obvious shapes if one were ever added.
  it("ignores any attempt to name a subject", async () => {
    for (const q of [`?gamertag=${GAMERTAG}`, `?userId=whoever`, `?slug=${slug}`]) {
      const res = await app.inject({
        method: "GET", url: `/me/last-map${q}`, headers: { cookie: otherCookie, host: "localhost" },
      });
      expect(res.statusCode).toBe(200);
      // otherCookie's own answer is null; a route that honoured the parameter would return `slug`.
      expect(res.json()).toEqual({ slug: null });
    }
  });

  it("is never cached by a shared proxy", async () => {
    const res = await app.inject({ method: "GET", url: "/me/last-map", headers: { cookie, host: "localhost" } });
    expect(res.headers["cache-control"]).toBe("no-store, private");
  });
});
