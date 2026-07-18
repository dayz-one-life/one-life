import type { Database } from "@onelife/db";
import { articles, articleImages } from "@onelife/db";
import { and, eq, desc, isNull, isNotNull, notInArray, sql } from "drizzle-orm";
import type { GeneratedImage } from "./openrouter.js";
import type { RecentCover } from "./image-scene.js";
import { pngDimensions } from "./image-png.js";

export interface ImageTarget {
  articleId: number;
  kind: "obituary" | "birth_notice";
  slug: string;
  gamertag: string;
  headline: string;
  lede: string | null;
  facts: Record<string, unknown>;
}

/** Published articles (both kinds) still missing an image, retries bounded by image_attempts.
 *  Newest created first: fresh articles jump the queue, the backfill drains behind them. */
export async function findImageTargets(
  db: Database,
  opts: { limit: number; maxAttempts: number },
): Promise<ImageTarget[]> {
  const rows = await db
    .select({
      articleId: articles.id,
      kind: articles.kind,
      slug: articles.slug,
      gamertag: articles.gamertag,
      headline: articles.headline,
      lede: articles.lede,
      facts: articles.facts,
    })
    .from(articles)
    .where(
      and(
        eq(articles.status, "published"),
        isNull(articles.imageUrl),
        isNotNull(articles.slug),
        sql`${articles.imageAttempts} < ${opts.maxAttempts}`,
        // Images are reserved for news/editorial — obituaries and birth notices never get one.
        // A future 'news' kind is not excluded here, so it becomes image-eligible automatically.
        notInArray(articles.kind, ["obituary", "birth_notice"]),
      ),
    )
    .orderBy(desc(articles.createdAt))
    .limit(opts.limit);
  return rows.map((r) => ({
    articleId: r.articleId,
    kind: r.kind as ImageTarget["kind"],
    slug: r.slug!,
    gamertag: r.gamertag,
    headline: r.headline ?? "",
    lede: r.lede,
    facts: (r.facts ?? {}) as Record<string, unknown>,
  }));
}

/** The last N same-kind covers (caption + scene line) for the do-not-repeat block. The scene line
 *  is the first paragraph of the stored full prompt — no extra storage needed. */
export async function recentCovers(db: Database, kind: string, limit = 8): Promise<RecentCover[]> {
  const rows = await db
    .select({ caption: articles.imageCaption, prompt: articles.imagePrompt })
    .from(articles)
    .where(and(eq(articles.kind, kind), eq(articles.status, "published"), isNotNull(articles.imageUrl)))
    .orderBy(desc(articles.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    caption: r.caption ?? "",
    sceneLine: (r.prompt ?? "").split("\n\n")[0] ?? "",
  }));
}

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
export function imageFileName(slug: string, contentType: string): string {
  return `${slug}.${EXT[contentType] ?? "png"}`;
}

/** Allow-list the stored content type — anything outside the three we actually generate/serve
 *  falls back to image/png, matching imageFileName's own fallback so the URL extension and the
 *  stored content-type can never disagree (a mismatched pair is the stored-XSS surface: a
 *  attacker-influenced contentType like "text/html" served back with that header). */
const ALLOWED_CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
export function safeContentType(contentType: string): string {
  return ALLOWED_CONTENT_TYPES.has(contentType) ? contentType : "image/png";
}

/** One transaction: bytes into article_images, provenance + URL onto the article. */
export async function saveArticleImage(
  db: Database,
  input: { articleId: number; slug: string; prompt: string; caption: string; model: string; image: GeneratedImage; now: Date },
): Promise<void> {
  const dims = pngDimensions(input.image.bytes);
  const contentType = safeContentType(input.image.contentType);
  await db.transaction(async (tx) => {
    await tx
      .insert(articleImages)
      .values({
        articleId: input.articleId,
        bytes: input.image.bytes,
        contentType,
        width: dims?.width ?? null,
        height: dims?.height ?? null,
        createdAt: input.now,
      })
      .onConflictDoUpdate({
        target: [articleImages.articleId],
        set: { bytes: input.image.bytes, contentType, width: dims?.width ?? null, height: dims?.height ?? null },
      });
    await tx
      .update(articles)
      .set({
        imageUrl: `/media/heroes/${imageFileName(input.slug, contentType)}`,
        imagePrompt: input.prompt,
        imageKind: "hero",
        imageCaption: input.caption,
        imageModel: input.model,
        imageAttempts: sql`${articles.imageAttempts} + 1`,
        imageError: null,
      })
      .where(eq(articles.id, input.articleId));
  });
}

export async function recordImageFailure(db: Database, input: { articleId: number; error: string }): Promise<void> {
  await db
    .update(articles)
    .set({ imageAttempts: sql`${articles.imageAttempts} + 1`, imageError: input.error })
    .where(eq(articles.id, input.articleId));
}
