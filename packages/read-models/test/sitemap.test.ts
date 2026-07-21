import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, articles } from "@onelife/db";
import { eq, inArray } from "drizzle-orm";
import { getSitemapEntries } from "../src/sitemap.js";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 62e7;

const ENDED_AT = new Date("2026-07-01T00:00:00Z");
const LATER_AT = new Date("2026-07-05T00:00:00Z");
const OPEN_STARTED_AT = new Date("2026-07-02T00:00:00Z");
const HARTMAN_FIRST_STARTED_AT = new Date("2026-06-20T00:00:00Z");

let sakhal: number; // slugged
let noSlugServer: number; // slug NULL
let livonia: number; // slug 'livonia', map 'enoch'

const slugs = [`sm-published-one-${svc}`, `sm-retracted-one-${svc}`, `sm-draft-one-${svc}`];

beforeAll(async () => {
  const [a] = await db
    .insert(servers)
    .values({ nitradoServiceId: svc, name: "sm-sakhal", map: "sakhal", slug: `sakhal-${svc}`, active: true })
    .returning();
  sakhal = a!.id;

  const [b] = await db
    .insert(servers)
    .values({ nitradoServiceId: svc + 1, name: "sm-noslug", map: "chernarusplus", slug: null, active: true })
    .returning();
  noSlugServer = b!.id;

  const [c] = await db
    .insert(servers)
    .values({ nitradoServiceId: svc + 2, name: "sm-livonia", map: "enoch", slug: `livonia-${svc}`, active: true })
    .returning();
  livonia = c!.id;

  const [hartman] = await db
    .insert(players)
    .values({ gamertag: `Hartman-${svc}`, firstSeenAt: HARTMAN_FIRST_STARTED_AT, lastSeenAt: LATER_AT })
    .returning();

  await db.insert(players).values({ gamertag: `Ghost-${svc}` });

  const [runner] = await db.insert(players).values({ gamertag: `Runner-${svc}` }).returning();

  const [drifter] = await db.insert(players).values({ gamertag: `Drifter-${svc}` }).returning();

  // Hartman: an earlier ended life on livonia (this is the one the map-slug/life-number tests key
  // off — life_number 2, mapSlug 'livonia', lastmod ENDED_AT).
  await db.insert(lives).values({
    serverId: livonia,
    playerId: hartman!.id,
    lifeNumber: 2,
    startedAt: HARTMAN_FIRST_STARTED_AT,
    endedAt: ENDED_AT,
    playtimeSeconds: 100,
  });

  // Hartman: a later life on sakhal, ended at LATER_AT — drives the player-level lastmod.
  await db.insert(lives).values({
    serverId: sakhal,
    playerId: hartman!.id,
    lifeNumber: 3,
    startedAt: ENDED_AT,
    endedAt: LATER_AT,
    playtimeSeconds: 100,
  });

  // Runner: an open (never-ended) life on sakhal.
  await db.insert(lives).values({
    serverId: sakhal,
    playerId: runner!.id,
    lifeNumber: 1,
    startedAt: OPEN_STARTED_AT,
    endedAt: null,
    playtimeSeconds: 50,
  });

  // Drifter: a life on the un-slugged server — must be omitted entirely.
  await db.insert(lives).values({
    serverId: noSlugServer,
    playerId: drifter!.id,
    lifeNumber: 1,
    startedAt: HARTMAN_FIRST_STARTED_AT,
    endedAt: ENDED_AT,
    playtimeSeconds: 50,
  });

  await db.insert(articles).values([
    {
      kind: "obituary",
      status: "published",
      slug: `sm-published-one-${svc}`,
      headline: "Published",
      body: "x",
      createdAt: ENDED_AT,
    },
    {
      kind: "obituary",
      status: "retracted",
      slug: `sm-retracted-one-${svc}`,
      headline: "Retracted",
      body: "x",
      createdAt: ENDED_AT,
    },
    {
      kind: "obituary",
      status: "draft",
      slug: `sm-draft-one-${svc}`,
      headline: "Draft",
      body: "x",
      createdAt: ENDED_AT,
    },
  ]);
});

afterAll(async () => {
  await db.delete(articles).where(inArray(articles.slug, slugs));
  await db.delete(lives).where(inArray(lives.serverId, [sakhal, noSlugServer, livonia]));
  await db.delete(players).where(inArray(players.gamertag, [`Hartman-${svc}`, `Ghost-${svc}`, `Runner-${svc}`, `Drifter-${svc}`]));
  await db.delete(servers).where(inArray(servers.id, [sakhal, noSlugServer, livonia]));
  await sql.end();
});

describe("getSitemapEntries", () => {
  it("lists a player who has at least one life", async () => {
    const out = await getSitemapEntries(db);
    expect(out.players.map((p) => p.gamertag)).toContain(`Hartman-${svc}`);
  });

  it("omits a player with no lives", async () => {
    const out = await getSitemapEntries(db);
    expect(out.players.map((p) => p.gamertag)).not.toContain(`Ghost-${svc}`);
  });

  it("omits a life on a server with no slug", async () => {
    const out = await getSitemapEntries(db);
    expect(out.lives.some((l) => l.gamertag === `Drifter-${svc}`)).toBe(false);
  });

  it("returns the server slug, not the map codename, for a life", async () => {
    const out = await getSitemapEntries(db);
    const life = out.lives.find((l) => l.gamertag === `Hartman-${svc}` && l.n === 2);
    expect(life?.mapSlug).toBe(`livonia-${svc}`);
    expect(life?.mapSlug).not.toBe("enoch");
  });

  it("uses the life number the route resolves by", async () => {
    const out = await getSitemapEntries(db);
    const life = out.lives.find((l) => l.gamertag === `Hartman-${svc}` && l.mapSlug === `livonia-${svc}`);
    expect(life?.n).toBe(2);
  });

  it("includes a published article and excludes retracted and draft ones", async () => {
    const out = await getSitemapEntries(db);
    const outSlugs = out.articles.map((a) => a.slug);
    expect(outSlugs).toContain(`sm-published-one-${svc}`);
    expect(outSlugs).not.toContain(`sm-retracted-one-${svc}`);
    expect(outSlugs).not.toContain(`sm-draft-one-${svc}`);
  });

  it("takes a life's lastmod from ended_at, falling back to started_at for an open life", async () => {
    const out = await getSitemapEntries(db);
    const ended = out.lives.find((l) => l.gamertag === `Hartman-${svc}` && l.n === 2);
    const open = out.lives.find((l) => l.gamertag === `Runner-${svc}`);
    expect(ended?.lastmod.toISOString()).toBe(ENDED_AT.toISOString());
    expect(open?.lastmod.toISOString()).toBe(OPEN_STARTED_AT.toISOString());
  });

  it("takes a player's lastmod from their most recent life activity", async () => {
    const out = await getSitemapEntries(db);
    expect(out.players.find((p) => p.gamertag === `Hartman-${svc}`)?.lastmod.toISOString()).toBe(
      LATER_AT.toISOString(),
    );
  });
});
