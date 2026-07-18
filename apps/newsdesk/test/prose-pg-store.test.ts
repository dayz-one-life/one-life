import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { articles, servers } from "@onelife/db";
import { eq, inArray } from "drizzle-orm";
import { recentProse } from "../src/prose-pg-store.js";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 55e7;
const t0 = new Date("2026-07-18T00:00:00Z");
const hrs = (h: number) => new Date(t0.getTime() + h * 3600_000);
let serverId: number;
const articleIds: number[] = [];
let artSeq = 0;

async function seedArticle(over: Record<string, unknown> = {}) {
  artSeq += 1;
  const [a] = await db
    .insert(articles)
    .values({
      kind: "obituary",
      status: "published",
      slug: `prose-slug-${svc}-${artSeq}`,
      serverId,
      gamertag: `prose-tag-${svc}-${artSeq}`,
      map: "chernarusplus",
      lifeNumber: artSeq,
      lifeStartedAt: hrs(artSeq),
      headline: `Headline ${artSeq}`,
      lede: `Lede ${artSeq}.`,
      pullQuoteText: `Quote ${artSeq}`,
      pullQuoteAttribution: `attribution ${artSeq}`,
      facts: { seq: artSeq },
      createdAt: hrs(artSeq),
      ...over,
    })
    .returning();
  articleIds.push(a!.id);
  return a!;
}

beforeAll(async () => {
  const [s] = await db
    .insert(servers)
    .values({ nitradoServiceId: svc, name: "prose", map: "chernarusplus", slug: `prose-${svc}`, active: true })
    .returning();
  serverId = s!.id;
});

afterAll(async () => {
  if (articleIds.length) await db.delete(articles).where(inArray(articles.id, articleIds));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

describe("recentProse", () => {
  it("returns same-kind published rows newest-first, capped by limit", async () => {
    const oldest = `Oldest ${svc}`;
    const middle = `Middle ${svc}`;
    const newest = `Newest ${svc}`;
    await seedArticle({ headline: oldest, createdAt: hrs(1) });
    await seedArticle({ headline: middle, createdAt: hrs(2) });
    await seedArticle({ headline: newest, createdAt: hrs(3) });

    // Ordering: a per-run-unique headline suffix + a wide limit + filtering to "mine" keeps this
    // immune to other published obituary rows already in the shared table (e.g. pg-store.test.ts,
    // which runs earlier in this same invocation per vitest.config.ts's fileParallelism:false and
    // publishes real obituaries with wall-clock created_at that can outrank these fixed fixtures).
    const rows = await recentProse(db, "obituary", 50);
    const mine = rows.filter((r) => [oldest, middle, newest].includes(r.headline));
    expect(mine.map((r) => r.headline)).toEqual([newest, middle, oldest]);

    // Capping: at least 3 published obituary rows exist (the ones just seeded), so a limit of 2
    // must return exactly 2 — independent of which rows they are, so it doesn't re-depend on
    // global ordering the way an identity check would.
    const capped = await recentProse(db, "obituary", 2);
    expect(capped).toHaveLength(2);
  });

  it("excludes the other kind and unpublished rows", async () => {
    await seedArticle({ kind: "birth_notice", headline: "A Nursery Piece", deathAt: null, createdAt: hrs(9) });
    await seedArticle({ status: "failed", headline: "A Failed Stub", createdAt: hrs(10) });
    const rows = await recentProse(db, "obituary", 50);
    const heads = rows.map((r) => r.headline);
    expect(heads).not.toContain("A Nursery Piece");
    expect(heads).not.toContain("A Failed Stub");
  });

  it("carries the attribution and a truncated first-sentence opener", async () => {
    const long = `${"word ".repeat(60)}sentence end. And a second sentence entirely.`;
    await seedArticle({ headline: "Opener Case", lede: long, pullQuoteAttribution: "a bored coroner", createdAt: hrs(20) });
    const rows = await recentProse(db, "obituary", 50);
    const row = rows.find((r) => r.headline === "Opener Case")!;
    expect(row.attribution).toBe("a bored coroner");
    expect(row.opener.length).toBeLessThanOrEqual(121); // 120 + the ellipsis char
    expect(row.opener.endsWith("…")).toBe(true);
  });

  it("tolerates a null lede and a null attribution", async () => {
    await seedArticle({ headline: "Bare Row", lede: null, pullQuoteAttribution: null, createdAt: hrs(21) });
    const rows = await recentProse(db, "obituary", 50);
    const row = rows.find((r) => r.headline === "Bare Row")!;
    expect(row.attribution).toBeNull();
    expect(row.opener).toBe("");
  });
});
