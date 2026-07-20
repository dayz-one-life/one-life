import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { user, servers, gamertagLinks, articles } from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { articleGenerator } from "../src/generators/articles.js";

const { db, sql } = getTestDb();
const NOW = new Date("2026-07-19T12:00:00Z");
const deps = { db, now: NOW, since: new Date("2026-07-01T00:00:00Z"), lookbackHours: 24, siteUrl: "https://s" };

beforeAll(async () => {
  await db.insert(user).values([
    { id: "ar1", name: "AR1", email: "ar1@x.com" },
    { id: "ar2", name: "AR2", email: "ar2@x.com" },
  ]);
  const [s] = await db.insert(servers).values({ nitradoServiceId: 993001, name: "artsrv", slug: "artsrv" }).returning();
  await db.insert(gamertagLinks).values([
    { userId: "ar1", gamertag: "ArtOne", status: "verified", verifiedAt: new Date("2026-07-02T00:00:00Z") },
    // Claimed but never emote-verified. An article names its subject's gamertag in the
    // headline, so the verified predicate is what stops a stranger's claim from delivering
    // that stranger's obituary headline into this inbox.
    { userId: "ar2", gamertag: "ArtTwo", status: "pending" },
  ]);
  await db.insert(articles).values([
    { kind: "obituary", status: "published", slug: "art-ob-1", serverId: s!.id, gamertag: "artone",
      map: "chernarusplus", lifeNumber: 1, lifeStartedAt: new Date("2026-07-17T00:00:00Z"),
      deathAt: new Date("2026-07-19T10:00:00Z"), headline: "Gone", lede: "l", body: "b",
      generatedAt: new Date("2026-07-19T10:05:00Z") },
    { kind: "birth_notice", status: "published", slug: "art-bn-1", serverId: s!.id, gamertag: "ArtOne",
      map: "chernarusplus", lifeNumber: 2, lifeStartedAt: new Date("2026-07-19T11:00:00Z"),
      headline: "Born", lede: "l", body: "b", generatedAt: new Date("2026-07-19T11:05:00Z") },
    { kind: "obituary", status: "failed", slug: "art-ob-2", serverId: s!.id, gamertag: "ArtOne",
      map: "chernarusplus", lifeNumber: 3, lifeStartedAt: new Date("2026-07-18T00:00:00Z"),
      deathAt: new Date("2026-07-19T09:00:00Z"), headline: "x", lede: "l", body: "b",
      generatedAt: new Date("2026-07-19T09:05:00Z") },
    // Published, owned, right kind — but generated two days before the window opens. If the
    // window clause regresses, the whole published back-catalogue ships at go-live.
    { kind: "obituary", status: "published", slug: "art-ob-old", serverId: s!.id, gamertag: "ArtOne",
      map: "chernarusplus", lifeNumber: 4, lifeStartedAt: new Date("2026-07-10T00:00:00Z"),
      deathAt: new Date("2026-07-17T09:00:00Z"), headline: "Old news", lede: "l", body: "b",
      generatedAt: new Date("2026-07-17T09:05:00Z") },
    // Published, in-window, right kind — and owned by the PENDING link. Differs from the
    // emitting obituary above in nothing but whose gamertag it names.
    { kind: "obituary", status: "published", slug: "art-ob-pending", serverId: s!.id, gamertag: "arttwo",
      map: "chernarusplus", lifeNumber: 1, lifeStartedAt: new Date("2026-07-17T00:00:00Z"),
      deathAt: new Date("2026-07-19T10:00:00Z"), headline: "Not yours", lede: "l", body: "b",
      generatedAt: new Date("2026-07-19T10:05:00Z") },
  ]);
});
afterAll(async () => { await sql.end(); });

describe("articleGenerator", () => {
  it("emits for published obituaries and birth notices only", async () => {
    const drafts = await articleGenerator(deps);
    expect(drafts.map((d) => d.kind).sort()).toEqual(["birth_notice_published", "obituary_published"]);
  });

  it("links to the right interior and keys on article id", async () => {
    const drafts = await articleGenerator(deps);
    const ob = drafts.find((d) => d.kind === "obituary_published")!;
    const bn = drafts.find((d) => d.kind === "birth_notice_published")!;
    expect(ob.href).toBe("/obituaries/art-ob-1");
    expect(bn.href).toBe("/fresh-spawns/art-bn-1");
    expect(ob.naturalKey).toMatch(/^article:\d+$/);
  });

  it("skips articles generated before the window opened", async () => {
    const drafts = await articleGenerator(deps);
    expect(drafts.some((d) => d.body === "Old news")).toBe(false);
    expect(drafts).toHaveLength(2);
  });

  it("emits nothing once the window has moved past every article", async () => {
    const narrow = await articleGenerator({ ...deps, now: new Date("2026-07-19T23:00:00Z"), lookbackHours: 1 });
    expect(narrow).toHaveLength(0);
  });

  // CLAUDE.md: notifications are scoped to the user's own VERIFIED links.
  it("never emits for an article whose gamertag link is only pending", async () => {
    const drafts = await articleGenerator(deps);
    expect(drafts.filter((d) => d.userId === "ar2")).toHaveLength(0);
    expect(drafts.some((d) => d.body === "Not yours")).toBe(false);
    // Fixture guard: the identically-shaped verified obituary still emits.
    expect(drafts.some((d) => d.userId === "ar1" && d.href === "/obituaries/art-ob-1")).toBe(true);
  });
});
