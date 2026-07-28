import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { players, articles } from "@onelife/db";
import { eq, inArray } from "drizzle-orm";
import { buildApp } from "../src/app.js";

const { db } = getTestDb();
const app = buildApp(db);

const svc = Math.floor(Math.random() * 1e8) + 71e7;
let articleId: number;

describe("GET /sitemap", () => {
  beforeAll(async () => {
    await db.insert(players).values({ gamertag: "SitemapSubject" });
    const [row] = await db
      .insert(articles)
      .values({ kind: "obituary", status: "published", slug: `sitemap-route-${svc}` })
      .returning();
    articleId = row!.id;
  });
  afterAll(async () => {
    await db.delete(players).where(eq(players.gamertag, "SitemapSubject"));
    await db.delete(articles).where(inArray(articles.id, [articleId]));
  });

  it("returns players and lives", async () => {
    const res = await app.inject({ method: "GET", url: "/sitemap" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.players)).toBe(true);
    expect(Array.isArray(body.lives)).toBe(true);
  });

  it("returns a seeded published obituary in articles", async () => {
    const res = await app.inject({ method: "GET", url: "/sitemap" });
    const body = res.json();
    expect(Array.isArray(body.articles)).toBe(true);
    const entry = body.articles.find((a: { slug: string }) => a.slug === `sitemap-route-${svc}`);
    expect(entry).toBeDefined();
    expect(entry.kind).toBe("obituary");
    expect(entry.lastmod).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("serves ISO timestamps for lastmod", async () => {
    const body = (await app.inject({ method: "GET", url: "/sitemap" })).json();
    for (const p of body.players) expect(p.lastmod).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("needs no authentication", async () => {
    const res = await app.inject({ method: "GET", url: "/sitemap" });
    expect(res.statusCode).not.toBe(401);
  });
});
