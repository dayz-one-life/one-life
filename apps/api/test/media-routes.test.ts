import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, articles, articleImages } from "@onelife/db";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { FILE_RE } from "../src/routes/media.js";

const { db, sql } = getTestDb();
const app = buildApp(db);
const svc = Math.floor(Math.random() * 1e8) + 55e7;
let serverId: number;
const imagedSlug = `media-api-${svc}`;
const noImageSlug = `media-api-noimg-${svc}`;
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

beforeAll(async () => {
  const [s] = await db
    .insert(servers)
    .values({ nitradoServiceId: svc, name: "media", map: "chernarusplus", slug: `media-${svc}`, active: true })
    .returning();
  serverId = s!.id;

  const [imaged] = await db
    .insert(articles)
    .values({
      kind: "obituary", status: "published", slug: imagedSlug, serverId, gamertag: `media-tag-${svc}`,
      map: "chernarusplus", lifeNumber: 1, lifeStartedAt: new Date("2026-07-10T00:00:00Z"),
      headline: "H", imageUrl: `/media/heroes/${imagedSlug}.png`,
    })
    .returning();
  await db.insert(articleImages).values({
    articleId: imaged!.id,
    bytes: png,
    contentType: "image/png",
    width: 1,
    height: 1,
  });

  await db.insert(articles).values({
    kind: "obituary", status: "published", slug: noImageSlug, serverId, gamertag: `media-tag-noimg-${svc}`,
    map: "chernarusplus", lifeNumber: 1, lifeStartedAt: new Date("2026-07-10T00:00:00Z"),
    headline: "H2",
  });
});

afterAll(async () => {
  await db.delete(articles).where(eq(articles.serverId, serverId));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

describe("GET /media/heroes/:file", () => {
  it("200s with the stored bytes, content-type, and immutable cache header", async () => {
    const res = await app.inject({ method: "GET", url: `/media/heroes/${imagedSlug}.png` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(Buffer.from(res.rawPayload).equals(png)).toBe(true);
  });

  it("404s for a published article with no image row", async () => {
    const res = await app.inject({ method: "GET", url: `/media/heroes/${noImageSlug}.png` });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "not_found" });
  });

  it("404s for an unknown slug", async () => {
    const res = await app.inject({ method: "GET", url: "/media/heroes/no-such-slug.png" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "not_found" });
  });

  it.each([
    ["UPPER.png"],
    ["x.gif"],
  ])("400s for bad filename %s", async (file) => {
    const res = await app.inject({ method: "GET", url: `/media/heroes/${file}` });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "bad_filename" });
  });

  it("400s for a percent-encoded traversal payload (the realistic bypass shape — a literal '../../etc/passwd' never reaches the handler at all, see FILE_RE unit test below)", async () => {
    const res = await app.inject({ method: "GET", url: "/media/heroes/..%2F..%2Fetc%2Fpasswd" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "bad_filename" });
  });
});

// A literal "GET /media/heroes/../../etc/passwd" request never reaches the route handler at
// all: both Fastify's inject() and a real listening socket resolve the ".." path segments
// (light-my-request via the WHATWG URL parser; find-my-way's router requires a matching
// segment count) before the request is ever dispatched — it 404s as an unmatched route, never
// serving a file. That's the router doing traversal defense for free. The regex is still the
// guard for anything that *does* reach the handler (e.g. percent-encoded slashes collapsed
// into the single :file segment, covered above), so assert it directly here too.
describe("FILE_RE filename guard", () => {
  it("rejects a traversal payload", () => {
    expect(FILE_RE.test("../../etc/passwd")).toBe(false);
  });
  it("rejects uppercase and disallowed extensions", () => {
    expect(FILE_RE.test("UPPER.png")).toBe(false);
    expect(FILE_RE.test("x.gif")).toBe(false);
  });
  it("accepts a well-formed hero filename", () => {
    expect(FILE_RE.test("some-obit-slug.png")).toBe(true);
  });
});
