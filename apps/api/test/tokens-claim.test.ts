import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { servers, user, gamertagLinks, players, referrals } from "@onelife/db";
import { eq } from "drizzle-orm";
import { createAuth, type Mailer } from "@onelife/auth";
import { buildApp } from "../src/app.js";
import { getTestDb } from "@onelife/test-support";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 6e8;
const email = `claim${svc}@example.com`;
const GT = `ClaimUser${svc}`; // the signed-in REFEREE — deliberately never verified
const REF_GT = `ClaimRef${svc}`; // the verified REFERRER
const REF_SLUG = REF_GT.toLowerCase();

let lastLink = "";
const captureMailer: Mailer = {
  async send(msg) {
    lastLink = msg.url;
  },
};
const auth = createAuth(db, {
  secret: "s".repeat(32),
  baseURL: "http://localhost",
  trustedOrigins: ["http://localhost"],
  providers: {},
  mailer: captureMailer,
});
const app = buildApp(db, { auth, corsOrigins: ["http://localhost"] });

function cookieHeader(setCookie: string | string[] | undefined): string {
  const arr = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return arr.map((c) => c.split(";")[0]).join("; ");
}
let cookie = "";
let userId = "";
let serverId: number;
const referrerId = `claim-ref-${svc}`;

async function signIn(): Promise<void> {
  await app.inject({
    method: "POST",
    url: "/api/auth/sign-in/magic-link",
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
  userId = u!.id;
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "claim-test" }).returning();
  serverId = s!.id;

  // ⚠️ The referee has NO verified link — that is the whole point of claimReferrer. It still
  // needs a `players` row so its own slug resolves, for the self-referral case.
  await db.insert(players).values([{ gamertag: GT }, { gamertag: REF_GT }]);

  await sql`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
            VALUES (${referrerId}, 'ClaimRef', ${`claimref${svc}@example.com`}, true, now(), now())`;
  await db.insert(gamertagLinks).values({ userId: referrerId, gamertag: REF_GT, status: "verified" });
});

afterAll(async () => {
  await db.delete(referrals).where(eq(referrals.userId, userId));
  await db.delete(gamertagLinks).where(eq(gamertagLinks.userId, referrerId));
  await db.delete(players).where(eq(players.gamertag, GT));
  await db.delete(players).where(eq(players.gamertag, REF_GT));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql`DELETE FROM "session" WHERE user_id = ${userId}`;
  await sql`DELETE FROM "account" WHERE user_id = ${userId}`;
  await sql`DELETE FROM "user" WHERE id IN (${userId}, ${referrerId})`;
  await sql.end();
});

const authed = () => ({ host: "localhost", cookie, "content-type": "application/json", origin: "http://localhost" });
const claim = (referrerSlug: string) =>
  app.inject({ method: "POST", url: "/me/referrer/claim", headers: authed(), payload: { referrerSlug } });

describe("POST /me/referrer/claim", () => {
  it("401s when signed out", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/me/referrer/claim",
      headers: { host: "localhost", "content-type": "application/json", origin: "http://localhost" },
      payload: { referrerSlug: REF_SLUG },
    });
    expect(res.statusCode).toBe(401);
  });

  it("is a silent success for an unknown slug — the visitor did nothing wrong", async () => {
    const res = await claim("nobody-at-all-999");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, claimed: false });
  });

  it("is a silent success for self-referral", async () => {
    const res = await claim(GT.toLowerCase());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, claimed: false });
  });

  it("claims from a slug for a referee who has verified nothing", async () => {
    const res = await claim(REF_SLUG);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, claimed: true });
    const [row] = await db.select().from(referrals).where(eq(referrals.userId, userId));
    expect(row!.referrerUserId).toBe(referrerId);
  });

  it("is a silent success on a repeat claim", async () => {
    const res = await claim(REF_SLUG);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, claimed: false });
  });
});
