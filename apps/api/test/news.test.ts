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
const draftSlug = `news-api-draft-${svc}`;
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
    row({
      status: "draft", slug: draftSlug,
      naturalKey: `standing_dead:${serverId}:${tag}:2026-07-12T00:00:00.000Z`,
      lifeStartedAt: new Date("2026-07-12T00:00:00Z"),
      createdAt: new Date("2026-07-15T00:00:00Z"),
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

describe("draft preview gate", () => {
  // `app` (module scope) is built with NO preview token — that is the unset-token fixture.
  const previewApp = buildApp(db, undefined, "test-token");

  it("404s a draft with no token", async () => {
    const res = await previewApp.inject({ method: "GET", url: `/news/${draftSlug}` });
    expect(res.statusCode).toBe(404);
  });

  it("404s a draft with the wrong token", async () => {
    const res = await previewApp.inject({ method: "GET", url: `/news/${draftSlug}?preview=nope` });
    expect(res.statusCode).toBe(404);
  });

  it("serves a draft with the right token, marked as a draft", async () => {
    const res = await previewApp.inject({ method: "GET", url: `/news/${draftSlug}?preview=test-token` });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("draft");
  });

  // FAIL CLOSED. An unset token must disable preview entirely, never match an empty ?preview=.
  // Precedent: MAGIC_LINK_ENABLED — absence of config is not permission.
  it("disables preview entirely when the token is unset", async () => {
    const res = await app.inject({ method: "GET", url: `/news/${draftSlug}?preview=` });
    expect(res.statusCode).toBe(404);
  });

  // Fastify parses a repeated param into an array; a throwing parse would surface as a 500 on a
  // PUBLIC article URL anyone can append junk to. Malformed input means "no token", nothing more.
  it("treats a repeated ?preview= param as no token, not a 500", async () => {
    const junk = await previewApp.inject({ method: "GET", url: `/news/${slug}?preview=a&preview=b` });
    expect(junk.statusCode).toBe(200);
    const draft = await previewApp.inject({ method: "GET", url: `/news/${draftSlug}?preview=test-token&preview=test-token` });
    expect(draft.statusCode).toBe(404);
  });
});
