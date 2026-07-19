import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { user, servers, gamertagLinks, articles } from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { articleGenerator } from "../src/generators/articles.js";

const { db, sql } = getTestDb();
const NOW = new Date("2026-07-19T12:00:00Z");
const deps = { db, now: NOW, since: new Date("2026-07-01T00:00:00Z"), lookbackHours: 24, siteUrl: "https://s" };

beforeAll(async () => {
  await db.insert(user).values({ id: "ar1", name: "AR1", email: "ar1@x.com" });
  const [s] = await db.insert(servers).values({ nitradoServiceId: 993001, name: "artsrv", slug: "artsrv" }).returning();
  await db.insert(gamertagLinks).values({ userId: "ar1", gamertag: "ArtOne", status: "verified", verifiedAt: new Date("2026-07-02T00:00:00Z") });
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
});
