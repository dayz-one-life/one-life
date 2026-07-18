import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, articles } from "@onelife/db";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";

const { db, sql } = getTestDb();
const app = buildApp(db);
const svc = Math.floor(Math.random() * 1e8) + 52e7;
let serverId: number;
const slug = `birth-api-${svc}`;

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "bn", map: "chernarusplus", slug: `bn-${svc}`, active: true }).returning();
  serverId = s!.id;
  await db.insert(articles).values({
    kind: "birth_notice", status: "published", slug, serverId, gamertag: `bn-${svc}`,
    map: "chernarusplus", mapSlug: `bn-${svc}`, lifeNumber: 3, lifeStartedAt: new Date("2026-07-15T00:00:00Z"),
    deathAt: null, headline: "Fresh Fool", lede: "L", body: "B", pullQuoteText: "again?", pullQuoteAttribution: "a weary coast",
    tags: ["Fresh Spawns", "Chernarus", "Repeat Offender"],
    facts: { minutesToQualify: 9, priors: { livesLived: 4, longestLifeSeconds: 12000, totalKills: 7, usualDeathCause: "pvp", lastDeathCause: "starvation", bestLifeMap: "sakhal" }, isKnownQuantity: true },
    generatedAt: new Date("2026-07-15T00:05:00Z"),
  });
});
afterAll(async () => {
  await db.delete(articles).where(eq(articles.serverId, serverId));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

describe("GET /birth-notices", () => {
  it("returns a published birth-notice feed with defaults", async () => {
    const res = await app.inject({ method: "GET", url: "/birth-notices" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ page: 1, pageSize: 20 });
    const row = body.rows.find((r: { slug: string }) => r.slug === slug);
    expect(row).toBeDefined();
    expect(row.minutesToQualify).toBe(9);
    expect(row.priorLives).toBe(4);
  });
  it("coerces invalid page to 1", async () => {
    const res = await app.inject({ method: "GET", url: "/birth-notices?page=-3" });
    expect(res.statusCode).toBe(200);
    expect(res.json().page).toBe(1);
  });
});

describe("GET /birth-notices/:slug", () => {
  it("returns the full article with hydrated priors + null endedAt (alive)", async () => {
    const res = await app.inject({ method: "GET", url: `/birth-notices/${slug}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.headline).toBe("Fresh Fool");
    expect(body.pullQuote).toEqual({ text: "again?", attribution: "a weary coast" });
    expect(body.priors.livesLived).toBe(4);
    expect(body.priors.bestLifeMap).toBe("sakhal");
    expect(body.endedAt).toBeNull();
  });
  it("unknown slug → 404", async () => {
    const res = await app.inject({ method: "GET", url: "/birth-notices/no-such-slug" });
    expect(res.statusCode).toBe(404);
  });
});
