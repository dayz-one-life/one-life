import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { servers, players, gamertagLinks, verificationChallenges, user } from "@onelife/db";
import { eq, inArray, sql as sqlExpr } from "drizzle-orm";
import { createAuth, type Mailer } from "@onelife/auth";
import { buildApp } from "../src/app.js";
import { getTestDb } from "@onelife/test-support";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 4e8;
const email = `gl${svc}@example.com`;

let lastLink = "";
const captureMailer: Mailer = { async send(msg) { lastLink = msg.url; } };
const auth = createAuth(db, {
  secret: "s".repeat(32), baseURL: "http://localhost", trustedOrigins: ["http://localhost"],
  providers: {}, mailer: captureMailer,
});
const app = buildApp(db, { auth, corsOrigins: ["http://localhost"] });
let serverId: number;
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
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "gl-test" }).returning();
  serverId = s!.id;
  await db.insert(players).values({ gamertag: "Alice", dayzId: "A=" });
  await db.insert(players).values({ gamertag: "Sasha", dayzId: `S=${svc}` });
  await db.insert(user).values({ id: "someone-else", name: "x", email: `se${svc}@x.com` });
  await signIn();
});

afterAll(async () => {
  await db.delete(verificationChallenges).where(
    sqlExpr`${verificationChallenges.gamertagLinkId} IN (SELECT id FROM gamertag_links WHERE gamertag IN ('Alice', 'Verified', 'Foreign', 'Bob', 'Sasha'))`);
  await db.delete(gamertagLinks).where(inArray(gamertagLinks.gamertag, ["Alice", "Verified", "Foreign", "Bob", "Sasha"]));
  await db.delete(gamertagLinks).where(eq(gamertagLinks.userId, "someone-else"));
  await db.delete(players).where(inArray(players.gamertag, ["Alice", "Verified", "Bob", "Sasha"]));
  await sql`DELETE FROM "session" WHERE user_id IN (SELECT id FROM "user" WHERE email = ${email})`;
  await sql`DELETE FROM "account" WHERE user_id IN (SELECT id FROM "user" WHERE email = ${email})`;
  await sql`DELETE FROM "verification" WHERE identifier LIKE ${"%" + email + "%"}`;
  await sql`DELETE FROM "user" WHERE email = ${email}`;
  await db.delete(user).where(eq(user.id, "someone-else"));
  await db.delete(servers).where(eq(servers.id, serverId));
  await app.close();
  await sql.end();
});

function claim(payload: Record<string, unknown>, hdrs: Record<string, string> = {}) {
  return app.inject({ method: "POST", url: "/me/gamertag-links",
    headers: { "content-type": "application/json", host: "localhost", cookie, ...hdrs }, payload });
}

describe("POST /me/gamertag-links", () => {
  it("401 without a session", async () => {
    const res = await app.inject({ method: "POST", url: "/me/gamertag-links",
      headers: { "content-type": "application/json", host: "localhost" }, payload: { gamertag: "Alice" } });
    expect(res.statusCode).toBe(401);
  });

  it("422 for a gamertag never seen on the server", async () => {
    const res = await claim({ gamertag: "Ghost" });
    expect(res.statusCode).toBe(422);
  });

  it("creates a pending link + a 3-emote challenge, with no serverId in the body", async () => {
    const res = await claim({ gamertag: "Alice" });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe("pending");
    expect(body.challenge.sequence).toHaveLength(3);
    expect(body.challenge.progressIndex).toBe(0);
    expect(body).not.toHaveProperty("serverId");
  });

  it("is idempotent: re-POST returns the same challenge sequence (no re-roll)", async () => {
    const a = (await claim({ gamertag: "Alice" })).json();
    const b = (await claim({ gamertag: "Alice" })).json();
    expect(b.linkId).toBe(a.linkId);
    expect(b.challenge.sequence).toEqual(a.challenge.sequence);
  });

  it("409 when the gamertag is already verified by a different user", async () => {
    // Force-verify a competing link (owned by someone-else) directly, then a fresh claim
    // by the signed-in caller must be rejected globally, regardless of server.
    const [link] = await db.insert(gamertagLinks)
      .values({ userId: "someone-else", gamertag: "Verified", status: "verified", verifiedAt: new Date() })
      .returning();
    await db.insert(players).values({ gamertag: "Verified", dayzId: "V=" });
    const res = await claim({ gamertag: "Verified" });
    expect(res.statusCode).toBe(409);
    await db.delete(gamertagLinks).where(eq(gamertagLinks.id, link!.id));
  });
});

describe("GET/DELETE /me/gamertag-links", () => {
  it("lists the caller's links with challenge labels for pending, and no serverId", async () => {
    await claim({ gamertag: "Alice" });
    const res = await app.inject({ method: "GET", url: "/me/gamertag-links", headers: { host: "localhost", cookie } });
    expect(res.statusCode).toBe(200);
    const list = res.json();
    const alice = list.find((l: any) => l.gamertag === "Alice");
    expect(alice.status).toBe("pending");
    expect(alice.challenge.sequence).toHaveLength(3);
    expect(alice).not.toHaveProperty("serverId");
  });

  it("fetches a single link and 404s for a foreign id", async () => {
    const created = (await claim({ gamertag: "Alice" })).json();
    const ok = await app.inject({ method: "GET", url: `/me/gamertag-links/${created.linkId}`, headers: { host: "localhost", cookie } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().id).toBe(created.linkId);
    expect(ok.json()).not.toHaveProperty("serverId");
    const missing = await app.inject({ method: "GET", url: "/me/gamertag-links/99999999", headers: { host: "localhost", cookie } });
    expect(missing.statusCode).toBe(404);
  });

  it("cancels a pending claim", async () => {
    const created = (await claim({ gamertag: "Alice" })).json();
    const del = await app.inject({ method: "DELETE", url: `/me/gamertag-links/${created.linkId}`, headers: { host: "localhost", cookie } });
    expect(del.statusCode).toBe(200);
    expect(del.json().status).toBe("cancelled");
    const after = await app.inject({ method: "GET", url: `/me/gamertag-links/${created.linkId}`, headers: { host: "localhost", cookie } });
    expect(after.json().status).toBe("cancelled");
  });

  it("404s (not leaks) GET and DELETE for a link owned by a different user", async () => {
    const [foreign] = await db.insert(gamertagLinks)
      .values({ userId: "someone-else", gamertag: "Foreign", status: "pending" })
      .returning();
    const foreignId = foreign!.id;

    const get = await app.inject({ method: "GET", url: `/me/gamertag-links/${foreignId}`, headers: { host: "localhost", cookie } });
    expect(get.statusCode).toBe(404);

    const del = await app.inject({ method: "DELETE", url: `/me/gamertag-links/${foreignId}`, headers: { host: "localhost", cookie } });
    expect(del.statusCode).toBe(404);

    const [stillThere] = await db.select().from(gamertagLinks).where(eq(gamertagLinks.id, foreignId));
    expect(stillThere).toBeDefined();
    expect(stillThere!.status).toBe("pending");

    await db.delete(gamertagLinks).where(eq(gamertagLinks.id, foreignId));
  });

  it("409s on DELETE of a link that is no longer pending", async () => {
    const created = (await claim({ gamertag: "Alice" })).json();
    const first = await app.inject({ method: "DELETE", url: `/me/gamertag-links/${created.linkId}`, headers: { host: "localhost", cookie } });
    expect(first.statusCode).toBe(200);
    expect(first.json().status).toBe("cancelled");

    const second = await app.inject({ method: "DELETE", url: `/me/gamertag-links/${created.linkId}`, headers: { host: "localhost", cookie } });
    expect(second.statusCode).toBe(409);
  });
});

describe("one active gamertag link per user", () => {
  beforeAll(async () => {
    await db.insert(players).values({ gamertag: "Bob", dayzId: "B=" });
  });

  it("409 active_link_exists when claiming a second gamertag while one is pending", async () => {
    await claim({ gamertag: "Alice" });            // caller now holds a pending Alice link
    const res = await claim({ gamertag: "Bob" });
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error).toBe("active_link_exists");
    expect(body.current.gamertag).toBe("Alice");
    expect(body.current.status).toBe("pending");
  });

  it("allows a different gamertag after the pending one is cancelled", async () => {
    const alice = (await claim({ gamertag: "Alice" })).json();
    const del = await app.inject({ method: "DELETE", url: `/me/gamertag-links/${alice.linkId}`, headers: { host: "localhost", cookie } });
    expect(del.statusCode).toBe(200);
    const res = await claim({ gamertag: "Bob" });
    expect(res.statusCode).toBe(201);
    expect(res.json().gamertag).toBe("Bob");
    // free the slot again so later assertions start clean
    await app.inject({ method: "DELETE", url: `/me/gamertag-links/${res.json().linkId}`, headers: { host: "localhost", cookie } });
  });

  it("409 active_link_exists when the caller already has a verified gamertag", async () => {
    const alice = (await claim({ gamertag: "Alice" })).json();
    await db.update(gamertagLinks).set({ status: "verified", verifiedAt: new Date() }).where(eq(gamertagLinks.id, alice.linkId));
    const res = await claim({ gamertag: "Bob" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("active_link_exists");
    expect(res.json().current.status).toBe("verified");
    // revert so the shared Alice link doesn't leak a verified state into cleanup
    await db.update(gamertagLinks).set({ status: "cancelled", verifiedAt: null }).where(eq(gamertagLinks.id, alice.linkId));
  });

  it("DB backstop: a second active link for one user violates the unique index", async () => {
    await db.delete(gamertagLinks).where(eq(gamertagLinks.userId, "someone-else"));
    await db.insert(gamertagLinks).values({ userId: "someone-else", gamertag: "IdxA", status: "pending" });
    await expect(
      db.insert(gamertagLinks).values({ userId: "someone-else", gamertag: "IdxB", status: "pending" }),
    ).rejects.toThrow();
    await db.delete(gamertagLinks).where(eq(gamertagLinks.userId, "someone-else"));
  });

  it("409s (never 500s) when two concurrent claims for different gamertags race", async () => {
    const [aRes, bRes] = await Promise.all([claim({ gamertag: "Alice" }), claim({ gamertag: "Bob" })]);
    const codes = [aRes.statusCode, bRes.statusCode].sort((x, y) => x - y);
    expect(codes).toEqual([201, 409]);

    const winner = aRes.statusCode === 201 ? aRes : bRes;
    const loser = aRes.statusCode === 201 ? bRes : aRes;
    expect(loser.json().error).toBe("active_link_exists");

    await db.delete(verificationChallenges).where(eq(verificationChallenges.gamertagLinkId, winner.json().linkId));
    await db.delete(gamertagLinks).where(eq(gamertagLinks.id, winner.json().linkId));
  });
});

describe("POST /me/gamertag-links — case-insensitivity", () => {
  beforeEach(async () => {
    // gamertag_links_user_active_uniq permits one active link per user; clear ours.
    await db.delete(verificationChallenges).where(
      sqlExpr`${verificationChallenges.gamertagLinkId} IN (SELECT id FROM gamertag_links WHERE gamertag ILIKE 'sasha')`);
    await db.delete(gamertagLinks).where(sqlExpr`gamertag ILIKE 'sasha'`);
  });

  it("stores the canonical players casing, not what the user typed", async () => {
    const res = await claim({ gamertag: "sasha" });
    expect(res.statusCode).toBe(201);
    const rows = await db.select({ g: gamertagLinks.gamertag }).from(gamertagLinks)
      .where(sqlExpr`gamertag ILIKE 'sasha'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.g).toBe("Sasha");
  });

  it("409 already_verified when another user holds the gamertag in different casing", async () => {
    await db.insert(gamertagLinks)
      .values({ userId: "someone-else", gamertag: "Sasha", status: "verified" });
    const res = await claim({ gamertag: "sasha" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("already_verified");
  });

  it("still 422 for a gamertag never seen, whatever the casing", async () => {
    const res = await claim({ gamertag: "nobodyhaseverbeencalledthis" });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe("gamertag_not_seen");
  });

  it("repairs a mis-cased PENDING row on reuse", async () => {
    // A pre-0024 row stored with the user's typed casing. The case-folded lookup finds it and
    // reuses it; it must come back out canonical, or redeem.ts's strict === against
    // bans.gamertag never matches and the player cannot spend a token to unban themselves.
    const first = (await claim({ gamertag: "Sasha" })).json();
    await db.update(gamertagLinks).set({ gamertag: "sasha" }).where(eq(gamertagLinks.id, first.linkId));
    const res = await claim({ gamertag: "sasha" });
    expect(res.statusCode).toBe(201);
    const rows = await db.select({ g: gamertagLinks.gamertag, s: gamertagLinks.status })
      .from(gamertagLinks).where(eq(gamertagLinks.id, first.linkId));
    expect(rows[0]!.g).toBe("Sasha");
    expect(rows[0]!.s).toBe("pending");
  });

  it("repairs a mis-cased CANCELLED row on reactivation", async () => {
    const first = (await claim({ gamertag: "Sasha" })).json();
    await db.update(gamertagLinks).set({ gamertag: "sasha", status: "cancelled" })
      .where(eq(gamertagLinks.id, first.linkId));
    const res = await claim({ gamertag: "SASHA" });
    expect(res.statusCode).toBe(201);
    const rows = await db.select({ g: gamertagLinks.gamertag, s: gamertagLinks.status })
      .from(gamertagLinks).where(eq(gamertagLinks.id, first.linkId));
    expect(rows[0]!.g).toBe("Sasha");
    expect(rows[0]!.s).toBe("pending");
  });

  it("re-claiming your own pending link in different casing is idempotent", async () => {
    const first = await claim({ gamertag: "Sasha" });
    expect(first.statusCode).toBe(201);
    const second = await claim({ gamertag: "SASHA" });
    expect(second.statusCode).toBe(201);
    expect(second.json().linkId).toBe(first.json().linkId);
  });
});
