import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { articles, syndications } from "@onelife/db";
import { inArray } from "drizzle-orm";
import { findSyndicationTargets, recordSuccess, recordFailure, lastPostedAt } from "../src/pg-store.js";

const { db, sql } = getTestDb();
const t0 = new Date("2026-07-31T00:00:00Z");
const hrs = (h: number) => new Date(t0.getTime() + h * 3600_000);
const run = Math.random().toString(36).slice(2, 8);
const slugOf = (n: string) => `crier-${run}-${n}`;
const slugs: string[] = [];

async function seedObit(name: string, over: Partial<typeof articles.$inferInsert> = {}) {
  const slug = slugOf(name);
  slugs.push(slug);
  await db.insert(articles).values({
    kind: "obituary", status: "published", slug,
    headline: `H ${name}`, lede: `L ${name}`, deathAt: hrs(1), ...over,
  });
  return slug;
}

beforeAll(async () => {
  await seedObit("fresh");
  await seedObit("old", { deathAt: hrs(-48) });                       // before since
  await seedObit("failed-stub", { status: "failed", slug: slugOf("failed-stub") });
  await seedObit("posted");
  await seedObit("capped");
  await db.insert(syndications).values([
    { slug: slugOf("posted"), channel: "discord", postedAt: hrs(2), attempts: 1 },
    { slug: slugOf("capped"), channel: "discord", attempts: 5, lastError: "x" },
  ]);
});

afterAll(async () => {
  await db.delete(syndications).where(inArray(syndications.slug, slugs));
  await db.delete(articles).where(inArray(articles.slug, slugs));
  await sql.end();
});

const opts = { channels: ["discord"], since: hrs(0), maxAttempts: 5, limit: 10 };

describe("findSyndicationTargets", () => {
  it("returns published obituaries after since lacking a successful row, per channel", async () => {
    const targets = await findSyndicationTargets(db, opts);
    const mine = targets.filter((t) => t.slug.startsWith(`crier-${run}`));
    expect(mine.map((t) => t.slug)).toEqual([slugOf("fresh")]);
  });

  it("excludes rows at the attempt cap", async () => {
    const targets = await findSyndicationTargets(db, opts);
    expect(targets.some((t) => t.slug === slugOf("capped"))).toBe(false);
  });

  it("excludes non-published and pre-since rows", async () => {
    const targets = await findSyndicationTargets(db, opts);
    expect(targets.some((t) => t.slug === slugOf("failed-stub"))).toBe(false);
    expect(targets.some((t) => t.slug === slugOf("old"))).toBe(false);
  });

  it("returns a target per missing channel", async () => {
    const targets = await findSyndicationTargets(db, { ...opts, channels: ["discord", "facebook"] });
    const fresh = targets.filter((t) => t.slug === slugOf("fresh"));
    expect(fresh.map((t) => t.channel).sort()).toEqual(["discord", "facebook"]);
    // 'posted' was posted to discord only — facebook is still missing:
    const posted = targets.filter((t) => t.slug === slugOf("posted"));
    expect(posted.map((t) => t.channel)).toEqual(["facebook"]);
  });
});

describe("ledger transitions", () => {
  it("failure inserts then increments; success stamps posted_at", async () => {
    const s = slugOf("fresh");
    await recordFailure(db, s, "discord", "boom");
    await recordFailure(db, s, "discord", "boom again");
    let [row] = await db.select().from(syndications).where(inArray(syndications.slug, [s]));
    expect(row!.attempts).toBe(2);
    expect(row!.lastError).toBe("boom again");
    expect(row!.postedAt).toBeNull();
    await recordSuccess(db, s, "discord", hrs(3));
    [row] = await db.select().from(syndications).where(inArray(syndications.slug, [s]));
    expect(row!.postedAt).toEqual(hrs(3));
  });
});

// Backs the Reddit rate cap. Scoped to THIS test run's slugs is impossible — the query is a
// per-channel MAX over the whole table — so the assertions use a channel name no other test
// touches, which is also how the real thing behaves: one window per channel, site-wide.
describe("lastPostedAt", () => {
  it("returns null for a channel that has never posted", async () => {
    expect(await lastPostedAt(db, `never-${run}`)).toBeNull();
  });

  it("returns the most recent posted_at, ignoring rows that only have failures", async () => {
    const chan = `ratecap-${run}`;
    const a = await seedObit("cap-a");
    const b = await seedObit("cap-b");
    const c = await seedObit("cap-c");
    await recordSuccess(db, a, chan, hrs(2));
    await recordSuccess(db, b, chan, hrs(5));
    // A pure failure row has posted_at NULL and must not be mistaken for the latest post.
    await recordFailure(db, c, chan, "boom");
    expect(await lastPostedAt(db, chan)).toEqual(hrs(5));
  });
});
