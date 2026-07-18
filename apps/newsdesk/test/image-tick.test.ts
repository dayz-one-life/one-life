import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { articles, articleImages, servers } from "@onelife/db";
import { eq, inArray } from "drizzle-orm";
import { imageTick, type ImageTickDeps } from "../src/image-tick.js";
import { findImageTargets } from "../src/image-pg-store.js";
import { IMAGE_STYLE } from "../src/image-prompt.js";
import type { CompletionClient } from "../src/generate.js";
import type { ImageClient } from "../src/openrouter.js";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 56e7;
const t0 = new Date("2026-07-17T00:00:00Z");
let serverId: number;
const articleIds: number[] = [];
let artSeq = 0;
const log = { info: () => {}, error: () => {} };

// Every seeded article and every imageTick call takes the next tick from this shared, strictly
// monotonic counter. findImageTargets orders newest-created-first, so with batchCap: 1 the
// just-seeded row for a given test is always the one picked — regardless of any earlier test's
// leftover rows still sitting in the table.
let seq = 0;
const nextTick = () => new Date(t0.getTime() + ++seq * 3600_000);

const sceneJson = JSON.stringify({
  caption: "DAY ONE",
  scene: "A drenched survivor crouched over a struggling campfire in drizzle.",
});

// Minimal valid PNG header + IHDR (mirrors test/image-png.test.ts's fakePng — no cross-test-file
// import between vitest suites, so re-declared here per the Task 6 brief's convention).
function fakePng(width: number, height: number): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0); // signature
  b.writeUInt32BE(13, 8); // IHDR length
  b.write("IHDR", 12);
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

function stubCompletion(response: string = sceneJson) {
  const calls: unknown[] = [];
  return {
    calls,
    client: { complete: async (req: unknown) => { calls.push(req); return response; } } as CompletionClient,
  };
}
function failCompletion(message: string) {
  const calls: unknown[] = [];
  return {
    calls,
    client: { complete: async (req: unknown) => { calls.push(req); throw new Error(message); } } as CompletionClient,
  };
}
function failThenSucceedCompletion(failMessage: string, response: string = sceneJson) {
  const calls: unknown[] = [];
  return {
    calls,
    client: {
      complete: async (req: unknown) => {
        calls.push(req);
        if (calls.length === 1) throw new Error(failMessage);
        return response;
      },
    } as CompletionClient,
  };
}
function stubImage() {
  const calls: { prompt: string; model: string }[] = [];
  return {
    calls,
    client: {
      generate: async (req: { prompt: string; model: string }) => {
        calls.push(req);
        return { bytes: fakePng(1024, 1024), contentType: "image/png" };
      },
    } as ImageClient,
  };
}

async function seedArticle(over: Record<string, unknown> = {}) {
  artSeq += 1;
  const ts = nextTick();
  const [a] = await db
    .insert(articles)
    .values({
      kind: "obituary",
      status: "published",
      slug: `imgtick-slug-${svc}-${artSeq}`,
      serverId,
      gamertag: `imgtick-tag-${svc}-${artSeq}`,
      map: "chernarusplus",
      lifeNumber: artSeq,
      lifeStartedAt: ts,
      headline: `Headline ${artSeq}`,
      lede: `Lede ${artSeq}`,
      facts: {},
      createdAt: ts,
      ...over,
    })
    .returning();
  articleIds.push(a!.id);
  return a!;
}

const baseDeps: Omit<ImageTickDeps, "client" | "imageClient" | "now"> = {
  enabled: true,
  dryRun: false,
  batchCap: 1,
  maxAttempts: 3,
  model: "workhorse-model",
  flagshipModel: "flagship-model",
  log,
};

beforeAll(async () => {
  const [s] = await db
    .insert(servers)
    .values({ nitradoServiceId: svc, name: "imgtick", map: "chernarusplus", slug: `imgtick-${svc}`, active: true })
    .returning();
  serverId = s!.id;
});

afterAll(async () => {
  if (articleIds.length) {
    await db.delete(articleImages).where(inArray(articleImages.articleId, articleIds));
    await db.delete(articles).where(inArray(articles.id, articleIds));
  }
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

describe("imageTick", () => {
  it("enabled=false: short-circuits to zeros, touches neither client, leaves the target untouched", async () => {
    const target = await seedArticle();
    const c = stubCompletion();
    const img = stubImage();

    const r = await imageTick(db, { ...baseDeps, client: c.client, imageClient: img.client, enabled: false, now: nextTick() });

    expect(r).toEqual({ generated: 0, failed: 0, skipped: 0, dryRun: false });
    expect(c.calls).toHaveLength(0);
    expect(img.calls).toHaveLength(0);

    const [row] = await db.select().from(articles).where(eq(articles.id, target.id));
    expect(row!.imageUrl).toBeNull();
    expect(row!.imageAttempts).toBe(0);
    expect(row!.imageError).toBeNull();

    // Clean up so this still-eligible leftover doesn't pollute the batchCap:1 selection in later
    // cases (findImageTargets has no server scoping — it sweeps every published article).
    await db.delete(articles).where(eq(articles.id, target.id));
  });

  it("dryRun=true: logs one DRY RUN line per target, calls neither client, writes nothing", async () => {
    const target = await seedArticle();
    const c = stubCompletion();
    const img = stubImage();
    const infos: { obj: unknown; msg?: string }[] = [];
    const dryLog = {
      info: (obj: unknown, msg?: string) => { infos.push({ obj, msg }); },
      error: () => {},
    };

    const r = await imageTick(db, { ...baseDeps, client: c.client, imageClient: img.client, dryRun: true, log: dryLog, now: nextTick() });

    expect(r).toEqual({ generated: 0, failed: 0, skipped: 0, dryRun: true });
    expect(c.calls).toHaveLength(0);
    expect(img.calls).toHaveLength(0);
    expect(infos).toHaveLength(1);
    expect(infos[0]!.msg).toContain("DRY RUN");

    const [row] = await db.select().from(articles).where(eq(articles.id, target.id));
    expect(row!.imageUrl).toBeNull();
    expect(row!.imageAttempts).toBe(0);

    // Clean up so this still-eligible leftover doesn't pollute the batchCap:1 selection in later
    // cases (findImageTargets has no server scoping — it sweeps every published article).
    await db.delete(articles).where(eq(articles.id, target.id));
  });

  it("live happy path: writes the scene + hero image, and is idempotent on re-run", async () => {
    const target = await seedArticle({ kind: "obituary", facts: { isLegend: false }, headline: "A Death On The Coast", lede: "L" });
    const c = stubCompletion();
    const img = stubImage();

    const r = await imageTick(db, { ...baseDeps, client: c.client, imageClient: img.client, now: nextTick() });

    expect(r).toEqual({ generated: 1, failed: 0, skipped: 0, dryRun: false });
    expect(c.calls).toHaveLength(1);
    expect(img.calls).toHaveLength(1);

    const imageCall = img.calls[0]!;
    expect(imageCall.prompt.startsWith("A drenched survivor crouched over a struggling campfire in drizzle.")).toBe(true);
    expect(imageCall.prompt).toContain(IMAGE_STYLE);
    expect(imageCall.model).toBe("workhorse-model");

    const [row] = await db.select().from(articles).where(eq(articles.id, target.id));
    expect(row!.imageUrl).toBe(`/media/heroes/${target.slug}.png`);
    expect(row!.imageCaption).toBe("DAY ONE");
    expect(row!.imageKind).toBe("hero");
    expect(row!.imageAttempts).toBe(1);
    expect(row!.imageError).toBeNull();

    const [imgRow] = await db.select().from(articleImages).where(eq(articleImages.articleId, target.id));
    expect(imgRow).toBeDefined();

    // Idempotent re-run: the target now has an image, so it's gone — neither client is touched.
    const c2 = stubCompletion();
    const img2 = stubImage();
    const r2 = await imageTick(db, { ...baseDeps, client: c2.client, imageClient: img2.client, now: nextTick() });

    expect(r2).toEqual({ generated: 0, failed: 0, skipped: 0, dryRun: false });
    expect(c2.calls).toHaveLength(0);
    expect(img2.calls).toHaveLength(0);
  });

  it("flagship pick: isLegend true uses flagshipModel, a non-legend uses model", async () => {
    const legend = await seedArticle({ kind: "obituary", facts: { isLegend: true } });
    const c1 = stubCompletion();
    const img1 = stubImage();
    const r1 = await imageTick(db, { ...baseDeps, client: c1.client, imageClient: img1.client, now: nextTick() });
    expect(r1).toEqual({ generated: 1, failed: 0, skipped: 0, dryRun: false });
    expect(img1.calls).toHaveLength(1);
    expect(img1.calls[0]!.model).toBe("flagship-model");
    void legend;

    const nonLegend = await seedArticle({ kind: "obituary", facts: { isLegend: false } });
    const c2 = stubCompletion();
    const img2 = stubImage();
    const r2 = await imageTick(db, { ...baseDeps, client: c2.client, imageClient: img2.client, now: nextTick() });
    expect(r2).toEqual({ generated: 1, failed: 0, skipped: 0, dryRun: false });
    expect(img2.calls).toHaveLength(1);
    expect(img2.calls[0]!.model).toBe("workhorse-model");
    void nonLegend;
  });

  it("failure path: scene-writer rejection records image_attempts/image_error, and exhausted attempts drop the target", async () => {
    const target = await seedArticle({ kind: "obituary" });
    const c = failCompletion("scene writer boom");
    const img = stubImage();

    const r = await imageTick(db, { ...baseDeps, client: c.client, imageClient: img.client, now: nextTick() });

    expect(r).toEqual({ generated: 0, failed: 1, skipped: 0, dryRun: false });
    expect(img.calls).toHaveLength(0); // the completion call failed before an image was ever requested

    const [row] = await db.select().from(articles).where(eq(articles.id, target.id));
    expect(row!.imageAttempts).toBe(1);
    expect(row!.imageError).toMatch(/boom/);
    expect(row!.imageUrl).toBeNull();

    const [imgRow] = await db.select().from(articleImages).where(eq(articleImages.articleId, target.id));
    expect(imgRow).toBeUndefined();

    // Clean up the still-eligible (1 < 3 attempts) leftover before it can pollute later cases.
    await db.delete(articles).where(eq(articles.id, target.id));

    // Third failure: pre-seed image_attempts: 2 so this failing run is the exhausting one.
    const exhausted = await seedArticle({ kind: "obituary", imageAttempts: 2 });
    const c2 = failCompletion("scene writer boom again");
    const img2 = stubImage();

    const r2 = await imageTick(db, { ...baseDeps, client: c2.client, imageClient: img2.client, maxAttempts: 3, now: nextTick() });

    expect(r2).toEqual({ generated: 0, failed: 1, skipped: 0, dryRun: false });
    const [row2] = await db.select().from(articles).where(eq(articles.id, exhausted.id));
    expect(row2!.imageAttempts).toBe(3);

    const targets = await findImageTargets(db, { limit: 1000, maxAttempts: 3 });
    expect(targets.some((t) => t.articleId === exhausted.id)).toBe(false);
  });

  it("recency: the completion request's user prompt carries the last same-kind cover's caption + scene", async () => {
    await seedArticle({
      kind: "obituary",
      imageUrl: "/media/heroes/old-cover.png",
      imagePrompt: "OLD SCENE\n\nSTYLE: full body shot, cinematic, deadpan tabloid photography.",
      imageCaption: "OLD CAP",
    });
    const target = await seedArticle({ kind: "obituary" });
    const c = stubCompletion();
    const img = stubImage();

    const r = await imageTick(db, { ...baseDeps, client: c.client, imageClient: img.client, now: nextTick() });

    expect(r).toEqual({ generated: 1, failed: 0, skipped: 0, dryRun: false });
    expect(c.calls).toHaveLength(1);
    const req = c.calls[0] as { system: string; user: string };
    expect(req.user).toContain("OLD CAP — OLD SCENE");
    void target;
  });

  it("failure isolation: a failing target in a batch doesn't stop the rest", async () => {
    // Seeded first (older createdAt) so it's processed second by findImageTargets' newest-first order.
    const olderSucceeds = await seedArticle({ kind: "obituary" });
    // Seeded second (newer createdAt) so it's the batch's first target — and the one that fails.
    const newerFails = await seedArticle({ kind: "obituary" });

    const c = failThenSucceedCompletion("scene writer boom (batch)");
    const img = stubImage();

    const r = await imageTick(db, {
      ...baseDeps,
      client: c.client,
      imageClient: img.client,
      batchCap: 2,
      maxAttempts: 3,
      now: nextTick(),
    });

    expect(r).toEqual({ generated: 1, failed: 1, skipped: 0, dryRun: false });
    expect(c.calls).toHaveLength(2);
    expect(img.calls).toHaveLength(1); // only the surviving (second) target reached image generation

    const [failedRow] = await db.select().from(articles).where(eq(articles.id, newerFails.id));
    expect(failedRow!.imageAttempts).toBe(1);
    expect(failedRow!.imageError).toMatch(/boom/);
    expect(failedRow!.imageUrl).toBeNull();

    const [succeededRow] = await db.select().from(articles).where(eq(articles.id, olderSucceeds.id));
    expect(succeededRow!.imageUrl).not.toBeNull();

    const [imgRow] = await db.select().from(articleImages).where(eq(articleImages.articleId, olderSucceeds.id));
    expect(imgRow).toBeDefined();

    // Clean up the still-eligible (1 < 3 attempts) failing leftover before it can pollute later
    // batchCap:1 cases (findImageTargets has no server scoping — it sweeps every published article).
    await db.delete(articles).where(eq(articles.id, newerFails.id));
  });
});
