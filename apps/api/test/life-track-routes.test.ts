import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { user, servers, players, lives, sessions, positions, gamertagLinks } from "@onelife/db";
import { eq } from "drizzle-orm";
import { createAuth, type Mailer } from "@onelife/auth";
import { buildApp } from "../src/app.js";
import { getTestDb } from "@onelife/test-support";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 61e7;
const email = `trk${svc}@example.com`;
const mine = `TrkMine-${svc}`;
const theirs = `TrkTheirs-${svc}`;

let lastLink = "";
const captureMailer: Mailer = { async send(msg) { lastLink = msg.url; } };
const auth = createAuth(db, {
  secret: "s".repeat(32), baseURL: "http://localhost", trustedOrigins: ["http://localhost"],
  providers: {}, mailer: captureMailer,
});
const app = buildApp(db, { auth, corsOrigins: ["http://localhost"] });

function cookieHeader(setCookie: string | string[] | undefined): string {
  const arr = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return arr.map((c) => c.split(";")[0]).join("; ");
}

let cookie = "";
let userId = "";
let slug = "";
const start = new Date("2026-07-14T00:00:00Z");
const mins = (m: number) => new Date(start.getTime() + m * 60_000);

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
  userId = u!.id;

  slug = `trk-${svc}`;
  const [s] = await db.insert(servers).values({
    nitradoServiceId: svc, name: "trk", map: "chernarusplus", slug, active: true,
  }).returning();

  for (const [tag, x] of [[mine, 1000], [theirs, 9999]] as const) {
    const [p] = await db.insert(players).values({ gamertag: tag, lastSeenAt: mins(200) }).returning();
    const [l] = await db.insert(lives).values({
      serverId: s!.id, playerId: p!.id, lifeNumber: 1, startedAt: start, endedAt: mins(120),
      playtimeSeconds: 7200,
    }).returning();
    await db.insert(sessions).values({
      serverId: s!.id, playerId: p!.id, lifeId: l!.id, connectedAt: start,
      disconnectedAt: mins(120), durationSeconds: 7200, closeReason: "death",
    });
    await db.insert(positions).values({
      serverId: s!.id, playerId: p!.id, gamertag: tag, x, y: x, recordedAt: mins(10),
    });
  }
});

afterAll(async () => { await sql.end(); });

const url = (n = 1) => `/me/lives/${slug}/${n}/track`;

describe("GET /me/lives/:mapSlug/:n/track — access control", () => {
  it("401s with no session", async () => {
    const r = await app.inject({ method: "GET", url: url() });
    expect(r.statusCode).toBe(401);
    expect(r.json().error).toBe("unauthorized");
  });

  it("403s for a signed-in user with NO gamertag link", async () => {
    const r = await app.inject({ method: "GET", url: url(), headers: { cookie } });
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toBe("not_verified");
  });

  it("403s for a PENDING link — a claim is not proof", async () => {
    await db.insert(gamertagLinks).values({ userId, gamertag: mine, status: "pending" });
    try {
      const r = await app.inject({ method: "GET", url: url(), headers: { cookie } });
      expect(r.statusCode).toBe(403);
      expect(r.json().error).toBe("not_verified");
    } finally {
      // Runs even if the assertions above fail, so a failure here doesn't cascade into a
      // confusing unique-constraint error on gamertag_links_user_active_uniq in the next test.
      await db.delete(gamertagLinks).where(eq(gamertagLinks.userId, userId));
    }
  });

  it("403s for a CANCELLED link — a withdrawn claim is not proof either", async () => {
    await db.insert(gamertagLinks).values({ userId, gamertag: mine, status: "cancelled" });
    try {
      const r = await app.inject({ method: "GET", url: url(), headers: { cookie } });
      expect(r.statusCode).toBe(403);
      expect(r.json().error).toBe("not_verified");
    } finally {
      await db.delete(gamertagLinks).where(eq(gamertagLinks.userId, userId));
    }
  });

  it("200s once the link is verified, and returns only the caller's own fixes", async () => {
    await db.insert(gamertagLinks).values({ userId, gamertag: mine, status: "verified" });
    const r = await app.inject({ method: "GET", url: url(), headers: { cookie } });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    const xs = body.segments.flatMap((s: { points: { x: number }[] }) => s.points.map((p) => p.x));
    expect(xs).toContain(1000);
    expect(xs).not.toContain(9999);
  });

  it("sets Cache-Control: no-store so no proxy or CDN can hand this to the next visitor", async () => {
    const r = await app.inject({ method: "GET", url: url(), headers: { cookie } });
    expect(r.headers["cache-control"]).toContain("no-store");
  });

  it("404s for a life number the caller's gamertag does not have", async () => {
    const r = await app.inject({ method: "GET", url: url(99), headers: { cookie } });
    expect(r.statusCode).toBe(404);
  });

  it("404s for an unknown server slug", async () => {
    const r = await app.inject({ method: "GET", url: `/me/lives/nope-${svc}/1/track`, headers: { cookie } });
    expect(r.statusCode).toBe(404);
  });

  it("404s (not 500) for a malformed life number", async () => {
    const r = await app.inject({ method: "GET", url: `/me/lives/${slug}/abc/track`, headers: { cookie } });
    expect(r.statusCode).toBe(404);
    expect(r.json().error).toBe("not_found");
  });

  it("the route's path parameters are exactly [mapSlug, n] — no path segment can name a player", () => {
    // Mechanism: Fastify's printed route tree (app.printRoutes({ commonPrefix: false })),
    // scanned for the /me/lives/... line and its `:param` segments. This is derived from
    // Fastify's actual route table, not from re-reading the route source.
    // printRoutes prints a nested tree with common path segments folded onto ancestor
    // lines, so the leaf line for this route reads "lives/:mapSlug/:n/track (GET, HEAD)",
    // not the full "/me/lives/..." path — match on the leaf segment instead.
    const tree = app.printRoutes({ commonPrefix: false });
    const matches = tree.split("\n").filter((l) => l.includes("/track (GET"));
    expect(matches).toHaveLength(1);
    const line = matches[0];
    const params = [...line!.matchAll(/:(\w+)/g)].map((m) => m[1]);
    expect(params).toEqual(["mapSlug", "n"]);
  });

  it("carries no other player's data regardless of which channel an identifier rides in", async () => {
    const baseline = await app.inject({ method: "GET", url: url(), headers: { cookie } });
    expect(baseline.statusCode).toBe(200);
    const baselineBody = baseline.json();

    const queryKeys = ["gamertag", "player", "tag", "for", "as", "subject", "userId"];
    for (const key of queryKeys) {
      const r = await app.inject({
        method: "GET", url: `${url()}?${key}=${encodeURIComponent(theirs)}`, headers: { cookie },
      });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toEqual(baselineBody);
    }

    const headerNames = ["x-gamertag", "x-user-id"];
    for (const h of headerNames) {
      const r = await app.inject({
        method: "GET", url: url(), headers: { cookie, [h]: theirs },
      });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toEqual(baselineBody);
    }
  });
});

describe("GET /me/lives/:mapSlug/:n/track — registration is auth-gated", () => {
  it("404s when the app is built with NO auth opts — a route registered without auth has no session check", async () => {
    // A second, independent app instance: never touches `cookie`/`app`/the DB cleanup above.
    const bareApp = buildApp(db);
    await bareApp.ready();
    try {
      const r = await bareApp.inject({ method: "GET", url: url() });
      expect(r.statusCode).toBe(404);
    } finally {
      await bareApp.close();
    }
  });
});
