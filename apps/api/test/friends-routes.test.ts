import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { user, gamertagLinks } from "@onelife/db";
import { eq } from "drizzle-orm";
import { createAuth, type Mailer } from "@onelife/auth";
import { buildApp } from "../src/app.js";
import { getTestDb } from "@onelife/test-support";

const { db, sql } = getTestDb();
// Unique per run so repeated local runs don't collide on the email/gamertag unique indexes.
const svc = Math.floor(Math.random() * 1e8) + 7e8;
const emailA = `frA${svc}@example.com`;
const emailB = `frB${svc}@example.com`;
const tagA = `FriendAlpha${svc}`;
const tagB = `FriendBravo${svc}`;

let lastLink = "";
const captureMailer: Mailer = { async send(msg) { lastLink = msg.url; } };
const auth = createAuth(db, {
  secret: "s".repeat(32), baseURL: "http://localhost", trustedOrigins: ["http://localhost"],
  providers: {}, mailer: captureMailer,
});
const app = buildApp(db, { auth, corsOrigins: ["http://localhost"], vapidPublicKey: "TEST_PUBLIC_KEY" });

function cookieHeader(setCookie: string | string[] | undefined): string {
  const arr = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return arr.map((c) => c.split(";")[0]).join("; ");
}

/** Drive a real magic-link sign-in and return that session's cookie. */
async function signIn(email: string): Promise<string> {
  await app.inject({
    method: "POST", url: "/api/auth/sign-in/magic-link",
    headers: { "content-type": "application/json", host: "localhost", origin: "http://localhost" },
    payload: { email },
  });
  const verifyPath = lastLink.replace(/^https?:\/\/[^/]+/, "");
  const verify = await app.inject({ method: "GET", url: verifyPath, headers: { host: "localhost" } });
  return cookieHeader(verify.headers["set-cookie"] as string | string[] | undefined);
}

let cookieA = "";
let cookieB = "";

const get = (cookie: string, url: string) => app.inject({ method: "GET", url, headers: { cookie } });
const post = (cookie: string, url: string, payload?: unknown) =>
  app.inject({
    method: "POST", url,
    headers: { cookie, ...(payload ? { "content-type": "application/json" } : {}) },
    payload: payload as never,
  });
const del = (cookie: string, url: string) => app.inject({ method: "DELETE", url, headers: { cookie } });
const patch = (cookie: string, url: string, payload: unknown) =>
  app.inject({
    method: "PATCH", url,
    headers: { cookie, "content-type": "application/json" },
    payload: payload as never,
  });

beforeAll(async () => {
  await app.ready();
  cookieA = await signIn(emailA);
  cookieB = await signIn(emailB);
  const [ua] = await db.select({ id: user.id }).from(user).where(eq(user.email, emailA.toLowerCase()));
  const [ub] = await db.select({ id: user.id }).from(user).where(eq(user.email, emailB.toLowerCase()));
  await db.insert(gamertagLinks).values([
    { userId: ua!.id, gamertag: tagA, status: "verified", verifiedAt: new Date() },
    { userId: ub!.id, gamertag: tagB, status: "verified", verifiedAt: new Date() },
  ]);
});
afterAll(async () => { await app.close(); await sql.end(); });

describe("friend routes", () => {
  it("401s every route when signed out", async () => {
    expect((await app.inject({ method: "GET", url: "/me/friends" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: `/me/friends/status?gamertag=${tagB}` })).statusCode).toBe(401);
    expect((await app.inject({ method: "DELETE", url: "/me/friends/1" })).statusCode).toBe(401);
  });

  it("400s not_verified for a gamertag nobody has verified", async () => {
    const res = await post(cookieA, "/me/friends/requests", { toGamertag: "NoSuchPlayerAnywhere" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("not_verified");
  });

  // Ordered: this creates the request the remaining cases operate on.
  it("creates a request addressed by gamertag, case-insensitively", async () => {
    const res = await post(cookieA, "/me/friends/requests", { toGamertag: tagB.toLowerCase() });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("pending");
  });

  it("serves the viewer's relationship status from both sides", async () => {
    expect((await get(cookieA, `/me/friends/status?gamertag=${tagB}`)).json().status).toBe("outgoing");
    expect((await get(cookieB, `/me/friends/status?gamertag=${tagA}`)).json().status).toBe("incoming");
  });

  it("403s when the sender tries to accept their own request", async () => {
    const id = (await get(cookieB, "/me/friends")).json().incoming[0].id;
    expect((await post(cookieA, `/me/friends/${id}/accept`)).statusCode).toBe(403);
  });

  it("404s a mutation on a friendship that does not exist", async () => {
    expect((await del(cookieA, "/me/friends/99999999")).statusCode).toBe(404);
  });

  it("lets the recipient accept, after which both sides see a friend", async () => {
    const id = (await get(cookieB, "/me/friends")).json().incoming[0].id;
    expect((await post(cookieB, `/me/friends/${id}/accept`)).statusCode).toBe(200);
    expect((await get(cookieA, "/me/friends")).json().friends).toHaveLength(1);
    expect((await get(cookieB, "/me/friends")).json().friends).toHaveLength(1);
  });

  it("429s with the expiry when the cooldown is active", async () => {
    // Tear the pair down, then re-request and decline to arm the cooldown.
    const id = (await get(cookieA, "/me/friends")).json().friends[0].id;
    expect((await del(cookieA, `/me/friends/${id}`)).statusCode).toBe(200);
    await post(cookieA, "/me/friends/requests", { toGamertag: tagB });
    const pendingId = (await get(cookieB, "/me/friends")).json().incoming[0].id;
    expect((await post(cookieB, `/me/friends/${pendingId}/decline`)).statusCode).toBe(200);

    const res = await post(cookieA, "/me/friends/requests", { toGamertag: tagB });
    expect(res.statusCode).toBe(429);
    expect(res.json().error).toBe("cooldown_active");
    expect(typeof res.json().until).toBe("string");
  });

  it("429s rate_limited once the sender's 20/24h cap is spent", async () => {
    // A dedicated fresh sender, so this test's count of notifications-actually-sent isn't
    // entangled with the ones the earlier cases in this file already sent for cookieA/B.
    const senderEmail = `frLimitSender${svc}@example.com`;
    const senderTag = `FriendLimitSender${svc}`;
    const cookieSender = await signIn(senderEmail);
    const [senderUser] = await db.select({ id: user.id }).from(user).where(eq(user.email, senderEmail.toLowerCase()));
    await db.insert(gamertagLinks).values({ userId: senderUser!.id, gamertag: senderTag, status: "verified", verifiedAt: new Date() });

    for (let i = 0; i < 20; i++) {
      const email = `frLimit${svc}_${i}@example.com`;
      const tag = `FriendLimit${svc}_${i}`;
      await signIn(email);
      const [u] = await db.select({ id: user.id }).from(user).where(eq(user.email, email.toLowerCase()));
      await db.insert(gamertagLinks).values({ userId: u!.id, gamertag: tag, status: "verified", verifiedAt: new Date() });
      const res = await post(cookieSender, "/me/friends/requests", { toGamertag: tag });
      expect(res.statusCode).toBe(200);
    }

    const res = await post(cookieSender, "/me/friends/requests", { toGamertag: tagB });
    expect(res.statusCode).toBe(429);
    expect(res.json().error).toBe("rate_limited");
  });

  it("401s the presence routes when signed out", async () => {
    expect((await app.inject({ method: "PATCH", url: "/me/friends/1/presence" })).statusCode).toBe(401);
    expect((await app.inject({ method: "PATCH", url: "/me/preferences" })).statusCode).toBe(401);
  });

  it("patches each side's presence flags independently", async () => {
    // The A/B pair from the earlier cases was declined in the cooldown_active case above and
    // is still inside its 7-day re-request cooldown, so it can't be reused here. Use a fresh
    // pair instead, matching the "dedicated fresh sender" pattern the rate-limit case above
    // already uses.
    const emailC = `frC${svc}@example.com`;
    const emailD = `frD${svc}@example.com`;
    const tagC = `FriendCharlie${svc}`;
    const tagD = `FriendDelta${svc}`;
    const cookieC = await signIn(emailC);
    const cookieD = await signIn(emailD);
    const [uc] = await db.select({ id: user.id }).from(user).where(eq(user.email, emailC.toLowerCase()));
    const [ud] = await db.select({ id: user.id }).from(user).where(eq(user.email, emailD.toLowerCase()));
    await db.insert(gamertagLinks).values([
      { userId: uc!.id, gamertag: tagC, status: "verified", verifiedAt: new Date() },
      { userId: ud!.id, gamertag: tagD, status: "verified", verifiedAt: new Date() },
    ]);

    await post(cookieC, "/me/friends/requests", { toGamertag: tagD });
    const id = (await get(cookieD, "/me/friends")).json().incoming[0].id;
    await post(cookieD, `/me/friends/${id}/accept`);

    expect((await patch(cookieC, `/me/friends/${id}/presence`, { share: false })).statusCode).toBe(200);
    expect((await patch(cookieD, `/me/friends/${id}/presence`, { notify: false })).statusCode).toBe(200);

    const c = (await get(cookieC, "/me/friends")).json().friends[0];
    const d = (await get(cookieD, "/me/friends")).json().friends[0];
    expect(c.sharesPresence).toBe(false);
    expect(c.notifyPresence).toBe(true);
    expect(d.sharesPresence).toBe(true);
    expect(d.notifyPresence).toBe(false);
  });

  it("404s a presence patch on a friendship that does not exist", async () => {
    expect((await patch(cookieA, "/me/friends/99999999/presence", { share: true })).statusCode).toBe(404);
  });

  // The nonexistent-id case above proves nothing about the party predicate itself — a
  // friendship id that never existed would 404 even if `or(userA, userB)` were deleted
  // entirely from setPresenceFlags. Patch a REAL friendship (the C/D pair idiom, per the
  // case above) that cookieA is genuinely not a party to.
  it("404s a presence patch on a real friendship the caller is not party to", async () => {
    const emailE = `frE${svc}@example.com`;
    const emailF = `frF${svc}@example.com`;
    const tagE = `FriendEcho${svc}`;
    const tagF = `FriendFoxtrot${svc}`;
    const cookieE = await signIn(emailE);
    const cookieF = await signIn(emailF);
    const [ue] = await db.select({ id: user.id }).from(user).where(eq(user.email, emailE.toLowerCase()));
    const [uf] = await db.select({ id: user.id }).from(user).where(eq(user.email, emailF.toLowerCase()));
    await db.insert(gamertagLinks).values([
      { userId: ue!.id, gamertag: tagE, status: "verified", verifiedAt: new Date() },
      { userId: uf!.id, gamertag: tagF, status: "verified", verifiedAt: new Date() },
    ]);

    await post(cookieE, "/me/friends/requests", { toGamertag: tagF });
    const id = (await get(cookieF, "/me/friends")).json().incoming[0].id;
    await post(cookieF, `/me/friends/${id}/accept`);

    // cookieA is neither E nor F — a real, accepted friendship, but the wrong party.
    expect((await patch(cookieA, `/me/friends/${id}/presence`, { share: true })).statusCode).toBe(404);
  });

  it("serves and updates the master switch, defaulting off", async () => {
    expect((await get(cookieA, "/me/preferences")).json().sharePresence).toBe(false);
    expect((await patch(cookieA, "/me/preferences", { sharePresence: true })).json().sharePresence).toBe(true);
    expect((await get(cookieA, "/me/preferences")).json().sharePresence).toBe(true);
    expect((await get(cookieA, "/me/friends")).json().sharePresence).toBe(true);
  });

  it("patches shareLocation on a friendship the caller is a party to, reflected in the feed", async () => {
    const emailG = `frG${svc}@example.com`;
    const emailH = `frH${svc}@example.com`;
    const tagG = `FriendGolf${svc}`;
    const tagH = `FriendHotel${svc}`;
    const cookieG = await signIn(emailG);
    const cookieH = await signIn(emailH);
    const [ug] = await db.select({ id: user.id }).from(user).where(eq(user.email, emailG.toLowerCase()));
    const [uh] = await db.select({ id: user.id }).from(user).where(eq(user.email, emailH.toLowerCase()));
    await db.insert(gamertagLinks).values([
      { userId: ug!.id, gamertag: tagG, status: "verified", verifiedAt: new Date() },
      { userId: uh!.id, gamertag: tagH, status: "verified", verifiedAt: new Date() },
    ]);

    await post(cookieG, "/me/friends/requests", { toGamertag: tagH });
    const id = (await get(cookieH, "/me/friends")).json().incoming[0].id;
    await post(cookieH, `/me/friends/${id}/accept`);

    expect((await patch(cookieG, `/me/friends/${id}/presence`, { shareLocation: false })).statusCode).toBe(200);

    const g = (await get(cookieG, "/me/friends")).json().friends[0];
    expect(g.sharesLocation).toBe(false);
  });

  it("404s a shareLocation patch on a friendship the caller is not party to", async () => {
    const emailI = `frI${svc}@example.com`;
    const emailJ = `frJ${svc}@example.com`;
    const tagI = `FriendIndia${svc}`;
    const tagJ = `FriendJuliet${svc}`;
    const cookieI = await signIn(emailI);
    const cookieJ = await signIn(emailJ);
    const [ui] = await db.select({ id: user.id }).from(user).where(eq(user.email, emailI.toLowerCase()));
    const [uj] = await db.select({ id: user.id }).from(user).where(eq(user.email, emailJ.toLowerCase()));
    await db.insert(gamertagLinks).values([
      { userId: ui!.id, gamertag: tagI, status: "verified", verifiedAt: new Date() },
      { userId: uj!.id, gamertag: tagJ, status: "verified", verifiedAt: new Date() },
    ]);

    await post(cookieI, "/me/friends/requests", { toGamertag: tagJ });
    const id = (await get(cookieJ, "/me/friends")).json().incoming[0].id;
    await post(cookieJ, `/me/friends/${id}/accept`);

    expect((await patch(cookieA, `/me/friends/${id}/presence`, { shareLocation: true })).statusCode).toBe(404);
  });

  it("round-trips PATCH /me/preferences { shareLocation: true }", async () => {
    expect((await patch(cookieA, "/me/preferences", { shareLocation: true })).json().shareLocation).toBe(true);
    expect((await get(cookieA, "/me/preferences")).json().shareLocation).toBe(true);
  });
});
