import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { articles, articleImages, servers } from "@onelife/db";
import { eq, inArray } from "drizzle-orm";
import {
  findImageTargets, recentCovers, saveArticleImage, recordImageFailure, imageFileName,
} from "../src/image-pg-store.js";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 54e7;
const t0 = new Date("2026-07-17T00:00:00Z");
const hrs = (h: number) => new Date(t0.getTime() + h * 3600_000);
let serverId: number;
const articleIds: number[] = [];
let artSeq = 0;

// Minimal valid PNG header + IHDR (mirrors test/image-png.test.ts's fakePng — no cross-test-file
// import between vitest suites, so re-declared here per the Task 6 brief).
function fakePng(width: number, height: number): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0); // signature
  b.writeUInt32BE(13, 8); // IHDR length
  b.write("IHDR", 12);
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

async function seedArticle(over: Record<string, unknown> = {}) {
  artSeq += 1;
  const [a] = await db
    .insert(articles)
    .values({
      kind: "obituary",
      status: "published",
      slug: `img-slug-${svc}-${artSeq}`,
      serverId,
      gamertag: `img-tag-${svc}-${artSeq}`,
      map: "chernarusplus",
      lifeNumber: artSeq,
      lifeStartedAt: hrs(artSeq),
      headline: `Headline ${artSeq}`,
      lede: `Lede ${artSeq}`,
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
    .values({ nitradoServiceId: svc, name: "img", map: "chernarusplus", slug: `img-${svc}`, active: true })
    .returning();
  serverId = s!.id;
});

afterAll(async () => {
  // article_images cascades from articles (ON DELETE CASCADE), but delete it explicitly first —
  // mirrors the truncate-list instruction and keeps cleanup order independent of the FK behavior.
  if (articleIds.length) {
    await db.delete(articleImages).where(inArray(articleImages.articleId, articleIds));
    await db.delete(articles).where(inArray(articles.id, articleIds));
  }
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

describe("findImageTargets", () => {
  it("excludes obituary and birth_notice kinds; an image-eligible kind is selected", async () => {
    // 'news' stands in for any future image-eligible kind (kind is a free-text column).
    const obit = await seedArticle({ kind: "obituary", createdAt: hrs(101) });
    const birth = await seedArticle({ kind: "birth_notice", createdAt: hrs(102) });
    const news = await seedArticle({ kind: "news", createdAt: hrs(103) });

    const targets = await findImageTargets(db, { limit: 500, maxAttempts: 3 });
    const mineIds = targets
      .filter((t) => [obit.id, birth.id, news.id].includes(t.articleId))
      .map((t) => t.articleId);

    expect(mineIds).toContain(news.id);
    expect(mineIds).not.toContain(obit.id);
    expect(mineIds).not.toContain(birth.id);
  });

  it("skips already-imaged, failed stubs, and exhausted attempts (for an image-eligible kind)", async () => {
    const imaged = await seedArticle({ kind: "news", imageUrl: "/media/heroes/already-imaged.png" });
    const failed = await seedArticle({ kind: "news", status: "failed" });
    const exhausted = await seedArticle({ kind: "news", imageAttempts: 3 });

    const targets = await findImageTargets(db, { limit: 500, maxAttempts: 3 });
    const mine = targets.filter((t) => [imaged.id, failed.id, exhausted.id].includes(t.articleId));
    expect(mine).toEqual([]);
  });

  it("is inert while only the two shipped kinds exist — no news row means no image target", async () => {
    // The safety claim of PR-C1 in one assertion. Both rows are published, un-imaged and have
    // zero attempts, so they are eligible on every dimension EXCEPT kind.
    const obit = await seedArticle({ kind: "obituary", imageUrl: null, imageAttempts: 0, createdAt: hrs(301) });
    const birth = await seedArticle({ kind: "birth_notice", imageUrl: null, imageAttempts: 0, createdAt: hrs(302) });

    const targets = await findImageTargets(db, { limit: 500, maxAttempts: 3 });
    const mine = targets.filter((t) => [obit.id, birth.id].includes(t.articleId));
    expect(mine).toEqual([]);
  });

  it("excludes a retracted row even though its kind is image-eligible", async () => {
    // `articles.status` is free-text; C2's retraction sweep will write 'retracted'. findImageTargets
    // filters eq(status,'published'), so a de-published article can never acquire a photo. Pinning
    // it here means C2 inherits the guarantee rather than having to re-derive it.
    const retracted = await seedArticle({ kind: "news", status: "retracted", createdAt: hrs(303) });
    const targets = await findImageTargets(db, { limit: 500, maxAttempts: 3 });
    expect(targets.map((t) => t.articleId)).not.toContain(retracted.id);
  });
});

describe("recentCovers", () => {
  it("returns caption + first paragraph of image_prompt for the last N same-kind covers, isolated by kind", async () => {
    const obit1 = await seedArticle({
      kind: "obituary",
      imageUrl: "/media/heroes/obit1.png",
      imagePrompt: `SCENE LINE ONE ${svc}\n\nSTYLE: full body shot, cinematic, deadpan tabloid photography.`,
      imageCaption: `REC-OBIT-1-${svc}`,
      createdAt: hrs(200),
    });
    const obit2 = await seedArticle({
      kind: "obituary",
      imageUrl: "/media/heroes/obit2.png",
      imagePrompt: `SCENE LINE TWO ${svc}\n\nSTYLE: full body shot, cinematic, deadpan tabloid photography.`,
      imageCaption: `REC-OBIT-2-${svc}`,
      createdAt: hrs(201),
    });
    const birth1 = await seedArticle({
      kind: "birth_notice",
      imageUrl: "/media/heroes/birth1.png",
      imagePrompt: `BIRTH SCENE LINE ${svc}\n\nSTYLE: full body shot, cinematic, deadpan tabloid photography.`,
      imageCaption: `REC-BIRTH-1-${svc}`,
      createdAt: hrs(202),
    });
    void obit1;
    void birth1;

    const obitCovers = await recentCovers(db, "obituary", 50);
    const obitCaptions = obitCovers.map((c) => c.caption);
    expect(obitCaptions).toContain(`REC-OBIT-1-${svc}`);
    expect(obitCaptions).toContain(`REC-OBIT-2-${svc}`);
    expect(obitCaptions).not.toContain(`REC-BIRTH-1-${svc}`); // kind isolation

    const found2 = obitCovers.find((c) => c.caption === `REC-OBIT-2-${svc}`)!;
    expect(found2.sceneLine).toBe(`SCENE LINE TWO ${svc}`);
    void obit2;

    const birthCovers = await recentCovers(db, "birth_notice", 50);
    const birthCaptions = birthCovers.map((c) => c.caption);
    expect(birthCaptions).toContain(`REC-BIRTH-1-${svc}`);
    expect(birthCaptions).not.toContain(`REC-OBIT-1-${svc}`); // kind isolation, other direction

    const foundBirth = birthCovers.find((c) => c.caption === `REC-BIRTH-1-${svc}`)!;
    expect(foundBirth.sceneLine).toBe(`BIRTH SCENE LINE ${svc}`);
  });
});

describe("saveArticleImage / recordImageFailure", () => {
  it("stores bytes and stamps every image column in one go", async () => {
    const target = await seedArticle({ imageAttempts: 0 });
    const png = fakePng(1024, 1536);
    const now = hrs(300);

    await saveArticleImage(db, {
      articleId: target.id,
      slug: target.slug!,
      prompt: "SCENE LINE\n\nSTYLE: full body shot, cinematic, deadpan tabloid photography.",
      caption: "A DEADPAN CAPTION",
      model: "test-image-model",
      image: { bytes: png, contentType: "image/png" },
      now,
    });

    const [row] = await db.select().from(articles).where(eq(articles.id, target.id));
    expect(row!.imageUrl).toBe(`/media/heroes/${target.slug}.png`);
    expect(row!.imageKind).toBe("hero");
    expect(row!.imageCaption).toBe("A DEADPAN CAPTION");
    expect(row!.imageModel).toBe("test-image-model");
    expect(row!.imagePrompt).toBe("SCENE LINE\n\nSTYLE: full body shot, cinematic, deadpan tabloid photography.");
    expect(row!.imageAttempts).toBe(1);
    expect(row!.imageError).toBeNull();

    const [img] = await db.select().from(articleImages).where(eq(articleImages.articleId, target.id));
    expect(img).toBeDefined();
    expect(img!.bytes.equals(png)).toBe(true);
    expect(img!.contentType).toBe("image/png");
    expect(img!.width).toBe(1024);
    expect(img!.height).toBe(1536);
  });

  it("failure bumps image_attempts and stores the error, leaving image_url null", async () => {
    const target = await seedArticle({ imageAttempts: 0 });

    await recordImageFailure(db, { articleId: target.id, error: "boom-1" });
    let [row] = await db.select().from(articles).where(eq(articles.id, target.id));
    expect(row!.imageAttempts).toBe(1);
    expect(row!.imageError).toBe("boom-1");
    expect(row!.imageUrl).toBeNull();

    await recordImageFailure(db, { articleId: target.id, error: "boom-2" });
    [row] = await db.select().from(articles).where(eq(articles.id, target.id));
    expect(row!.imageAttempts).toBe(2);
    expect(row!.imageError).toBe("boom-2");
    expect(row!.imageUrl).toBeNull();
  });

  it("imageFileName maps content types", () => {
    expect(imageFileName("a-slug", "image/png")).toBe("a-slug.png");
    expect(imageFileName("a-slug", "image/jpeg")).toBe("a-slug.jpg");
    expect(imageFileName("a-slug", "image/webp")).toBe("a-slug.webp");
    expect(imageFileName("a-slug", "application/octet-stream")).toBe("a-slug.png");
  });

  // v0.27.2's cache-bust rule (CLAUDE.md): the read-model versions imageUrl as
  // `?v=<article_images.created_at epoch>`, so a regenerated hero under the SAME filename must
  // bump created_at, or the CDN/browser's year-long immutable cache header pins the stale bytes
  // forever. This is Task 5's Fix C — the regenerate path previously left created_at untouched.
  it("regenerating the SAME article's image bumps article_images.created_at, so ?v= changes", async () => {
    const target = await seedArticle({ imageAttempts: 0 });
    const first = fakePng(640, 480);
    const firstAt = hrs(310);

    await saveArticleImage(db, {
      articleId: target.id, slug: target.slug!,
      prompt: "SCENE LINE\n\nSTYLE: full body shot, cinematic, deadpan tabloid photography.",
      caption: "FIRST CAPTION", model: "test-image-model",
      image: { bytes: first, contentType: "image/png" }, now: firstAt,
    });
    const [afterFirst] = await db.select().from(articleImages).where(eq(articleImages.articleId, target.id));
    expect(afterFirst!.createdAt.getTime()).toBe(firstAt.getTime());

    const second = fakePng(800, 600);
    const secondAt = hrs(311);
    await saveArticleImage(db, {
      articleId: target.id, slug: target.slug!,
      prompt: "SCENE LINE TWO\n\nSTYLE: full body shot, cinematic, deadpan tabloid photography.",
      caption: "REGENERATED CAPTION", model: "test-image-model",
      image: { bytes: second, contentType: "image/png" }, now: secondAt,
    });

    const [afterSecond] = await db.select().from(articleImages).where(eq(articleImages.articleId, target.id));
    expect(afterSecond!.bytes.equals(second)).toBe(true);
    expect(afterSecond!.createdAt.getTime()).toBe(secondAt.getTime());
    expect(afterSecond!.createdAt.getTime()).not.toBe(afterFirst!.createdAt.getTime());
  });

  it("allow-lists the stored content type — an untrusted/unexpected type is stored as image/png and the URL extension matches", async () => {
    const target = await seedArticle({ imageAttempts: 0 });
    const png = fakePng(640, 480);
    const now = hrs(301);

    await saveArticleImage(db, {
      articleId: target.id,
      slug: target.slug!,
      prompt: "SCENE LINE\n\nSTYLE: full body shot, cinematic, deadpan tabloid photography.",
      caption: "A DEADPAN CAPTION",
      model: "test-image-model",
      image: { bytes: png, contentType: "text/html" },
      now,
    });

    const [row] = await db.select().from(articles).where(eq(articles.id, target.id));
    expect(row!.imageUrl).toBe(`/media/heroes/${target.slug}.png`);

    const [img] = await db.select().from(articleImages).where(eq(articleImages.articleId, target.id));
    expect(img!.contentType).toBe("image/png");
  });
});
