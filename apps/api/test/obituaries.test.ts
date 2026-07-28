import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, articles } from "@onelife/db";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";

const { db, sql } = getTestDb();
const app = buildApp(db);
const svc = Math.floor(Math.random() * 1e8) + 52e7;
let serverId: number;
const slug = `obit-api-${svc}`;

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "oa", map: "chernarusplus", slug: `oa-${svc}`, active: true }).returning();
  serverId = s!.id;
  await db.insert(articles).values({
    kind: "obituary", status: "published", slug, serverId, gamertag: `oa-${svc}`,
    map: "chernarusplus", mapSlug: `oa-${svc}`, lifeNumber: 1, lifeStartedAt: new Date("2026-07-10T00:00:00Z"),
    deathAt: new Date("2026-07-10T02:00:00Z"), timeAliveSeconds: 7200, kills: 2, longestKillMeters: 90,
    cause: "pvp", headline: "H", lede: "L", body: "B", pullQuoteText: "q", pullQuoteAttribution: "a rival",
    tags: ["Obituaries"], facts: { sessions: 1, killerGamertag: "K", weapon: "M4" }, generatedAt: new Date("2026-07-10T03:00:00Z"),
  });
});
afterAll(async () => {
  await db.delete(articles).where(eq(articles.serverId, serverId));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

describe("GET /obituaries", () => {
  it("returns a published-obituary feed with defaults", async () => {
    const res = await app.inject({ method: "GET", url: "/obituaries" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ page: 1, pageSize: 20 });
    expect(body.rows.some((r: { slug: string }) => r.slug === slug)).toBe(true);
  });
  it("coerces invalid page to 1", async () => {
    const res = await app.inject({ method: "GET", url: "/obituaries?page=-3" });
    expect(res.statusCode).toBe(200);
    expect(res.json().page).toBe(1);
  });
});

describe("GET /obituaries/:slug", () => {
  it("returns the full article", async () => {
    const res = await app.inject({ method: "GET", url: `/obituaries/${slug}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.headline).toBe("H");
    expect(body.pullQuote).toEqual({ text: "q", attribution: "a rival" });
    expect(body.sessions).toBe(1);
  });
  it("unknown slug → 404", async () => {
    const res = await app.inject({ method: "GET", url: "/obituaries/no-such-slug" });
    expect(res.statusCode).toBe(404);
  });
});
