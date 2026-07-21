import { describe, it, expect, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { articles, players } from "@onelife/db";
import { eq, like } from "drizzle-orm";
import {
  draftArticle, publishArticle, unpublishArticle, spikeArticle, listArticles, assertKnownSubjects,
} from "../src/newsroom/store.js";
import type { EditorialPayload } from "../src/newsroom/contract.js";

const { db, sql } = getTestDb();
const run = Math.floor(Math.random() * 1e8);
const key = (tail: string) => `almanac:test-${run}:${tail}`;

const payload = (over: Partial<EditorialPayload> = {}): EditorialPayload => ({
  format: "almanac",
  naturalKey: key("w29"),
  headline: `The Coldest Map ${run}`,
  lede: "The registry has finished counting.",
  blocks: [{ type: "para", text: "Sakhal is the punishing one." }, { type: "subhead", text: "The Count" }],
  pullQuote: null,
  tags: ["The Almanac"],
  factCheck: [{ claim: "45 vs 70", source: "sessions grouped by server" }],
  subjects: [],
  slug: undefined,
  ...over,
});

afterAll(async () => {
  await db.delete(articles).where(like(articles.naturalKey, `almanac:test-${run}:%`));
  await sql.end();
});

describe("newsroom store", () => {
  it("drafts with status='draft' and a body derived from the para blocks only", async () => {
    const slug = await draftArticle(db, payload());
    const [row] = await db.select().from(articles).where(eq(articles.slug, slug));
    expect(row!.status).toBe("draft");
    expect(row!.kind).toBe("news");
    expect(row!.body).toBe("Sakhal is the punishing one.");
    expect(row!.bodyBlocks).toEqual(payload().blocks);
    expect(row!.model).toBeNull();
  });

  it("refuses a second draft with the same natural key", async () => {
    await expect(draftArticle(db, payload({ headline: `Different Headline ${run}` })))
      .rejects.toThrow(/story already covered/);
  });

  it("publish flips a draft to published and bumps createdAt", async () => {
    const slug = await draftArticle(db, payload({ naturalKey: key("w30"), headline: `Week Thirty ${run}` }));
    const [before] = await db.select().from(articles).where(eq(articles.slug, slug));
    expect(await publishArticle(db, slug)).toBe("published");
    const [after] = await db.select().from(articles).where(eq(articles.slug, slug));
    expect(after!.status).toBe("published");
    expect(after!.createdAt.getTime()).toBeGreaterThan(before!.createdAt.getTime() - 1);
  });

  it("publish twice is a noop", async () => {
    const slug = `almanac-week-thirty-${run}-test-${run}-w30`;
    const rows = await db.select({ slug: articles.slug }).from(articles)
      .where(eq(articles.naturalKey, key("w30")));
    expect(await publishArticle(db, rows[0]!.slug!)).toBe("noop");
  });

  it("unpublish returns a published row to draft — never retracted", async () => {
    const rows = await db.select({ slug: articles.slug }).from(articles)
      .where(eq(articles.naturalKey, key("w30")));
    await unpublishArticle(db, rows[0]!.slug!);
    const [row] = await db.select().from(articles).where(eq(articles.slug, rows[0]!.slug!));
    expect(row!.status).toBe("draft");
  });

  it("spike deletes a draft", async () => {
    const slug = await draftArticle(db, payload({ naturalKey: key("w31"), headline: `Week Thirty One ${run}` }));
    await spikeArticle(db, slug);
    const rows = await db.select().from(articles).where(eq(articles.slug, slug));
    expect(rows).toHaveLength(0);
  });

  it("spike refuses a published row", async () => {
    const slug = await draftArticle(db, payload({ naturalKey: key("w32"), headline: `Week Thirty Two ${run}` }));
    await publishArticle(db, slug);
    await expect(spikeArticle(db, slug)).rejects.toThrow(/cannot be spiked/);
  });

  // The archive promise composes: without a namespace guard, unpublish → spike deletes a
  // PUBLISHED AUTOMATED article, and its intermediate 'draft' state escapes the trigger
  // anti-join (published|retracted only), so an enabled newsTick would regenerate the same
  // subject at a paid model call per tick.
  it("unpublish refuses an automated (non-editorial) article", async () => {
    const autoSlug = `standing-dead-test-${run}`;
    await db.insert(articles).values({
      kind: "news", status: "published", slug: autoSlug,
      naturalKey: `almanac:test-${run}:auto-standin`.replace("almanac", "standing_dead"),
      headline: "H", lede: "L", body: "B", promptVersion: "news-v1", model: "test", attempts: 1,
    });
    await expect(unpublishArticle(db, autoSlug)).rejects.toThrow(/editorial/i);
    await db.delete(articles).where(eq(articles.slug, autoSlug));
  });

  it("spike refuses an automated (non-editorial) draft", async () => {
    const autoSlug = `long-form-test-${run}`;
    await db.insert(articles).values({
      kind: "news", status: "draft", slug: autoSlug,
      naturalKey: `long_form:test-${run}:auto-standin`,
      headline: "H", lede: "L", body: "B", promptVersion: "news-v1", model: "test", attempts: 1,
    });
    await expect(spikeArticle(db, autoSlug)).rejects.toThrow(/editorial/i);
    await db.delete(articles).where(eq(articles.slug, autoSlug));
  });

  it("list --drafts shows only drafts", async () => {
    const slug = await draftArticle(db, payload({ naturalKey: key("w33"), headline: `Week Thirty Three ${run}` }));
    const drafts = await listArticles(db, true);
    expect(drafts.some((d) => d.slug === slug)).toBe(true);
    expect(drafts.every((d) => d.status === "draft")).toBe(true);
  });
});

describe("assertKnownSubjects", () => {
  const tag = `Hartman${run}`;

  it("passes for a gamertag that exists (case-insensitive)", async () => {
    const [row] = await db.insert(players).values({ gamertag: tag }).returning();
    try {
      await expect(assertKnownSubjects(db, [{ gamertag: tag.toLowerCase() }])).resolves.toBeUndefined();
    } finally {
      await db.delete(players).where(eq(players.id, row!.id));
    }
  });

  it("throws naming the unknown gamertag", async () => {
    await expect(assertKnownSubjects(db, [{ gamertag: `Hartmn${run}` }])).rejects.toThrow(
      new RegExp(`Hartmn${run}`),
    );
  });

  it("accepts an empty subjects list", async () => {
    await expect(assertKnownSubjects(db, [])).resolves.toBeUndefined();
  });

  it("draftArticle refuses a roster naming an unknown player, before any row is written", async () => {
    const naturalKey = key("w34");
    await expect(
      draftArticle(db, payload({
        naturalKey, headline: `Week Thirty Four ${run}`,
        subjects: [{ gamertag: `NoSuchPlayer${run}` }],
      })),
    ).rejects.toThrow(new RegExp(`NoSuchPlayer${run}`));
    const rows = await db.select().from(articles).where(eq(articles.naturalKey, naturalKey));
    expect(rows).toHaveLength(0);
  });

  it("draftArticle succeeds when every subject is a known player", async () => {
    const [row] = await db.insert(players).values({ gamertag: tag }).returning();
    try {
      const naturalKey = key("w35");
      const slug = await draftArticle(db, payload({
        naturalKey, headline: `Week Thirty Five ${run}`,
        subjects: [{ gamertag: tag.toLowerCase() }],
      }));
      const [saved] = await db.select().from(articles).where(eq(articles.slug, slug));
      expect((saved!.facts as { subjects: { gamertag: string }[] }).subjects).toEqual([{ gamertag: tag.toLowerCase() }]);
    } finally {
      await db.delete(players).where(eq(players.id, row!.id));
    }
  });
});
