import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, articles } from "@onelife/db";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";

const { db, sql } = getTestDb();
const app = buildApp(db);
const svc = Math.floor(Math.random() * 1e8) + 54e7;
let serverId: number;
const slug = `news-api-${svc}`;
const retractedSlug = `news-api-retracted-${svc}`;
const tag = `napi-${svc}`;
const born = new Date("2026-07-10T00:00:00Z");

beforeAll(async () => {
  const [s] = await db.insert(servers).values({
    nitradoServiceId: svc, name: "na", map: "chernarusplus", slug: `na-${svc}`, active: true,
  }).returning();
  serverId = s!.id;
  const row = (over: Partial<typeof articles.$inferInsert>) => ({
    kind: "news", serverId, gamertag: tag, map: "chernarusplus", mapSlug: `na-${svc}`,
    lifeNumber: 1, lifeStartedAt: born, headline: "H", lede: "L", body: "B",
    promptVersion: "news-v1", model: "test", attempts: 1, ...over,
  }) as typeof articles.$inferInsert;

  await db.insert(articles).values([
    row({
      status: "published", slug, naturalKey: `standing_dead:${serverId}:${tag}:${born.toISOString()}`,
      pullQuoteText: "q", pullQuoteAttribution: "a quartermaster", tags: ["News"],
      bodyBlocks: [{ type: "para", text: "B" }],
      createdAt: new Date("2026-07-13T00:00:00Z"),
      facts: { trigger: "standing_dead", subjectCount: 1, idleSeconds: 259200 },
    }),
    row({
      status: "retracted", slug: retractedSlug,
      naturalKey: `standing_dead:${serverId}:${tag}:2026-07-11T00:00:00.000Z`,
      lifeStartedAt: new Date("2026-07-11T00:00:00Z"),
      createdAt: new Date("2026-07-14T00:00:00Z"),
      facts: { trigger: "standing_dead", subjectCount: 1 },
    }),
  ]);
});

afterAll(async () => {
  await db.delete(articles).where(eq(articles.serverId, serverId));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

describe("GET /news", () => {
  it("returns a published-news feed with defaults", async () => {
    const res = await app.inject({ method: "GET", url: "/news" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ page: 1, pageSize: 20 });
    expect(body.rows.some((r: { slug: string }) => r.slug === slug)).toBe(true);
  });

  it("never serves a retracted article in the feed", async () => {
    const res = await app.inject({ method: "GET", url: "/news" });
    expect(res.json().rows.some((r: { slug: string }) => r.slug === retractedSlug)).toBe(false);
  });

  it("coerces an invalid page to 1", async () => {
    const res = await app.inject({ method: "GET", url: "/news?page=-3" });
    expect(res.statusCode).toBe(200);
    expect(res.json().page).toBe(1);
  });
});

describe("GET /news/:slug", () => {
  it("returns the full article including the rich body blocks", async () => {
    const res = await app.inject({ method: "GET", url: `/news/${slug}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.headline).toBe("H");
    expect(body.trigger).toBe("standing_dead");
    expect(body.bodyBlocks).toEqual([{ type: "para", text: "B" }]);
    expect(body.pullQuote).toEqual({ text: "q", attribution: "a quartermaster" });
    expect(body.retracted).toBe(false);
    expect(body.subjectStatus).toMatchObject({ kind: "idle", idleDaysAtPublication: 3 });
  });

  it("serves a retracted article flagged, so the interior can noindex it", async () => {
    const res = await app.inject({ method: "GET", url: `/news/${retractedSlug}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().retracted).toBe(true);
  });

  it("unknown slug → 404", async () => {
    const res = await app.inject({ method: "GET", url: "/news/no-such-slug" });
    expect(res.statusCode).toBe(404);
  });
});
