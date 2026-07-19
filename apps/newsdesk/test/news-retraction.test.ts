import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, sessions, articles } from "@onelife/db";
import { eq, inArray } from "drizzle-orm";
import { findReturnedStandingDead, retractNewsArticles } from "../src/news-pg-store.js";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 56e7;
const t0 = new Date("2026-07-11T00:00:00.000Z");
const hrs = (h: number) => new Date(t0.getTime() + h * 3_600_000);
const PUBLISHED_AT = hrs(100);
let serverId: number;
const pids: number[] = [];
const tag = (n: string) => `nr-${n}-${svc}`;

/** Seed one player with a life, one session, and one published news article. */
async function seed(name: string, o: {
  kind: "standing_dead" | "long_form"; sessionAt: Date | null; status?: string;
}) {
  const [p] = await db.insert(players).values({ gamertag: tag(name), lastSeenAt: hrs(1) }).returning();
  pids.push(p!.id);
  const [l] = await db.insert(lives).values({
    serverId, playerId: p!.id, lifeNumber: 1, startedAt: hrs(0), endedAt: null, playtimeSeconds: 7200,
  }).returning();
  if (o.sessionAt) {
    await db.insert(sessions).values({
      serverId, playerId: p!.id, lifeId: l!.id,
      connectedAt: o.sessionAt, disconnectedAt: null, durationSeconds: 60, closeReason: null,
    });
  }
  const [a] = await db.insert(articles).values({
    kind: "news", status: o.status ?? "published",
    naturalKey: `${o.kind}:${serverId}:${tag(name)}:${hrs(0).toISOString()}`,
    serverId, gamertag: tag(name), map: "chernarusplus", mapSlug: "chernarus",
    lifeNumber: 1, lifeStartedAt: hrs(0), deathAt: null,
    slug: `nr-${name}-${svc}`, headline: "H", lede: "L", body: "B",
    promptVersion: "news-v1", model: "test", attempts: 1, createdAt: PUBLISHED_AT,
  }).returning();
  return a!.id;
}

let returnedId: number;
let quietId: number;
let beforeOnlyId: number;
let longFormId: number;
let alreadyRetractedId: number;

beforeAll(async () => {
  const [s] = await db.insert(servers).values({
    nitradoServiceId: svc, name: "nr", map: "chernarusplus", slug: `nr-${svc}`, active: true,
  }).returning();
  serverId = s!.id;
  returnedId = await seed("returned", { kind: "standing_dead", sessionAt: hrs(120) });
  quietId = await seed("quiet", { kind: "standing_dead", sessionAt: null });
  beforeOnlyId = await seed("before", { kind: "standing_dead", sessionAt: hrs(50) });
  longFormId = await seed("longform", { kind: "long_form", sessionAt: hrs(120) });
  alreadyRetractedId = await seed("already", { kind: "standing_dead", sessionAt: hrs(120), status: "retracted" });
});

afterAll(async () => {
  await db.delete(articles).where(eq(articles.serverId, serverId));
  await db.delete(sessions).where(eq(sessions.serverId, serverId));
  await db.delete(lives).where(eq(lives.serverId, serverId));
  await db.delete(players).where(inArray(players.id, pids));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

const ids = async () => (await findReturnedStandingDead(db, { limit: 100 })).map((r) => r.articleId);

describe("findReturnedStandingDead", () => {
  it("finds a subject who connected AFTER the article was published", async () => {
    expect(await ids()).toContain(returnedId);
  });

  it("leaves a subject who never came back", async () => {
    expect(await ids()).not.toContain(quietId);
  });

  it("leaves a subject whose only session predates publication", async () => {
    // The session the article was WRITTEN about must never retract the article about it.
    expect(await ids()).not.toContain(beforeOnlyId);
  });

  it("never touches a Long Form article — its subjects are dead and cannot come back", async () => {
    expect(await ids()).not.toContain(longFormId);
  });

  it("skips an already-retracted row so it is not swept every tick forever", async () => {
    expect(await ids()).not.toContain(alreadyRetractedId);
  });

  it("reports the key and slug so the tick can log what it de-published", async () => {
    const found = (await findReturnedStandingDead(db, { limit: 100 }))
      .find((r) => r.articleId === returnedId)!;
    expect(found.naturalKey).toMatch(/^standing_dead:/);
    expect(found.gamertag).toBe(tag("returned"));
    expect(found.slug).toBe(`nr-returned-${svc}`);
  });
});

describe("retractNewsArticles", () => {
  it("moves the row to 'retracted' without deleting it, and the sweep then goes quiet", async () => {
    await retractNewsArticles(db, [returnedId]);
    const [row] = await db.select().from(articles).where(eq(articles.id, returnedId));
    expect(row!.status).toBe("retracted");
    // The row SURVIVES — only the status changes, so the prose and the hero image are kept rather
    // than cascade-deleted. What stops the subject being re-covered is the WIDENED ANTI-JOIN
    // (Steps 7-11), not the row's mere existence; that property is asserted in
    // news-antijoin-retracted.test.ts and again end-to-end in news-tick.test.ts.
    expect(row!.headline).toBe("H");
    expect(row!.naturalKey).toMatch(/^standing_dead:/);
    expect(await ids()).not.toContain(returnedId);
  });

  it("is a no-op on an empty id list", async () => {
    await expect(retractNewsArticles(db, [])).resolves.toBeUndefined();
  });
});
