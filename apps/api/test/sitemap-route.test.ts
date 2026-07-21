import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { articles, players } from "@onelife/db";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";

const { db } = getTestDb();
const app = buildApp(db);

describe("GET /sitemap", () => {
  beforeAll(async () => {
    const [p] = await db.insert(players).values({ gamertag: "SitemapSubject" }).returning();
    await db.insert(articles).values({
      kind: "obituary", status: "published", slug: "sitemap-subject-dies",
      gamertag: p!.gamertag, mapSlug: "pa-chernarus", map: "chernarusplus", lifeNumber: 1,
      headline: "Sitemap Subject Dies", lede: "L", deathAt: new Date("2026-07-10T12:00:00Z"),
      createdAt: new Date("2026-07-10T12:00:00Z"),
    });
  });
  afterAll(async () => {
    await db.delete(articles).where(eq(articles.gamertag, "SitemapSubject"));
    await db.delete(players).where(eq(players.gamertag, "SitemapSubject"));
  });

  it("returns players, lives and articles", async () => {
    const res = await app.inject({ method: "GET", url: "/sitemap" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.players)).toBe(true);
    expect(Array.isArray(body.lives)).toBe(true);
    expect(Array.isArray(body.articles)).toBe(true);
  });

  it("serves ISO timestamps for lastmod", async () => {
    const body = (await app.inject({ method: "GET", url: "/sitemap" })).json();
    expect(body.articles[0].lastmod).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("needs no authentication", async () => {
    const res = await app.inject({ method: "GET", url: "/sitemap" });
    expect(res.statusCode).not.toBe(401);
  });
});
