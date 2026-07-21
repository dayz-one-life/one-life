import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { articles } from "@onelife/db";
import { inArray } from "drizzle-orm";
import { getPlayerArticles } from "../src/player-articles.js";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 61e7;
const start = new Date("2026-07-15T00:00:00Z");
const mins = (m: number) => new Date(start.getTime() + m * 60_000);

const slugs = [
  `pa-obit-${svc}`,
  `pa-victim-${svc}`,
  `pa-retracted-${svc}`,
  `pa-draft-${svc}`,
  `pa-multi-1-${svc}`,
  `pa-multi-2-${svc}`,
  `pa-multi-3-${svc}`,
  `pa-self-${svc}`,
];

beforeAll(async () => {
  await db.insert(articles).values([
    {
      kind: "obituary",
      status: "published",
      slug: `pa-obit-${svc}`,
      gamertag: `Hero-${svc}`,
      headline: "Hero Falls",
      body: "x",
      createdAt: mins(10),
    },
    {
      kind: "obituary",
      status: "published",
      slug: `pa-victim-${svc}`,
      gamertag: `Victim-${svc}`,
      headline: "Victim Falls",
      body: "x",
      facts: { killerGamertag: `Killer-${svc}` },
      createdAt: mins(20),
    },
    {
      kind: "obituary",
      status: "retracted",
      slug: `pa-retracted-${svc}`,
      gamertag: `Retracted-${svc}`,
      headline: "Retracted Piece",
      body: "x",
      createdAt: mins(30),
    },
    {
      kind: "obituary",
      status: "draft",
      slug: `pa-draft-${svc}`,
      gamertag: `Drafted-${svc}`,
      headline: "Draft Piece",
      body: "x",
      createdAt: mins(40),
    },
    {
      kind: "obituary",
      status: "published",
      slug: `pa-multi-1-${svc}`,
      gamertag: `Multi-${svc}`,
      headline: "Multi One",
      body: "x",
      createdAt: mins(50),
    },
    {
      kind: "obituary",
      status: "published",
      slug: `pa-multi-2-${svc}`,
      gamertag: `Multi-${svc}`,
      headline: "Multi Two",
      body: "x",
      createdAt: mins(60),
    },
    {
      kind: "obituary",
      status: "published",
      slug: `pa-multi-3-${svc}`,
      gamertag: `Multi-${svc}`,
      headline: "Multi Three",
      body: "x",
      createdAt: mins(70),
    },
    {
      kind: "obituary",
      status: "published",
      slug: `pa-self-${svc}`,
      gamertag: `Selfkill-${svc}`,
      headline: "Self Kill",
      body: "x",
      facts: { killerGamertag: `Selfkill-${svc}` },
      createdAt: mins(80),
    },
  ]);
});

afterAll(async () => {
  await db.delete(articles).where(inArray(articles.slug, slugs));
  await sql.end();
});

describe("getPlayerArticles", () => {
  it("returns nothing for a player the paper has never written about", async () => {
    const feed = await getPlayerArticles(db, `Nobody-${svc}`, { page: 1 });
    expect(feed.rows).toEqual([]);
    expect(feed.total).toBe(0);
  });

  it("returns an article whose subject is the player, tagged subject", async () => {
    const feed = await getPlayerArticles(db, `Hero-${svc}`, { page: 1 });
    expect(feed.rows.map((r) => [r.slug, r.role])).toContainEqual([`pa-obit-${svc}`, "subject"]);
  });

  it("matches the gamertag case-insensitively", async () => {
    const feed = await getPlayerArticles(db, `hero-${svc}`.toUpperCase(), { page: 1 });
    expect(feed.total).toBeGreaterThan(0);
  });

  it("returns an article where the player is the killer, tagged killer", async () => {
    const feed = await getPlayerArticles(db, `Killer-${svc}`, { page: 1 });
    expect(feed.rows.map((r) => [r.slug, r.role])).toContainEqual([`pa-victim-${svc}`, "killer"]);
  });

  it("excludes a retracted article", async () => {
    // A retraction is a public correction, not a credit. It must not appear on anyone's profile.
    const feed = await getPlayerArticles(db, `Retracted-${svc}`, { page: 1 });
    expect(feed.rows).toEqual([]);
  });

  it("excludes a draft article", async () => {
    const feed = await getPlayerArticles(db, `Drafted-${svc}`, { page: 1 });
    expect(feed.rows).toEqual([]);
  });

  it("orders newest first", async () => {
    const feed = await getPlayerArticles(db, `Multi-${svc}`, { page: 1 });
    const times = feed.rows.map((r) => r.createdAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("paginates, and total counts every match not just the page", async () => {
    const feed = await getPlayerArticles(db, `Multi-${svc}`, { page: 1, pageSize: 2 });
    expect(feed.rows).toHaveLength(2);
    expect(feed.total).toBeGreaterThan(2);
    expect(feed.page).toBe(1);
    expect(feed.pageSize).toBe(2);
    const p2 = await getPlayerArticles(db, `Multi-${svc}`, { page: 2, pageSize: 2 });
    expect(p2.rows[0]!.slug).not.toBe(feed.rows[0]!.slug);
  });

  it("lists an article once, as subject, when the player is both subject and killer", async () => {
    // Does not occur in the live corpus (no published obituary has a self-kill), but the union
    // must not emit the same article twice.
    const feed = await getPlayerArticles(db, `Selfkill-${svc}`, { page: 1 });
    const forArticle = feed.rows.filter((r) => r.slug === `pa-self-${svc}`);
    expect(forArticle).toHaveLength(1);
    expect(forArticle[0]!.role).toBe("subject");
  });
});
