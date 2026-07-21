import type { Database } from "@onelife/db";
import { articles, players } from "@onelife/db";
import { and, desc, eq, like, or, sql } from "drizzle-orm";
import { EDITORIAL_PREFIXES } from "@onelife/read-models";
import { editorialSlug, flattenBlocks, type EditorialPayload } from "./contract.js";

/** State-transition ops act ONLY inside the editorial namespace. `parsePayload` enforces the
 *  prefix on the way in; without this predicate on the way out, `unpublish` → `spike` composes
 *  into deleting a PUBLISHED AUTOMATED article — and the intermediate 'draft' state escapes the
 *  trigger anti-join (published|retracted only), so an enabled newsTick would regenerate the
 *  same subject at a paid model call per tick. */
const editorialOnly = or(...EDITORIAL_PREFIXES.map((p) => like(articles.naturalKey, `${p}%`)));

/**
 * A subject roster is public link surface: `facts.subjects` drives prose linkification on the
 * article page, so an unknown gamertag ships a link to a 404. Fail the publish instead.
 * Compared case-insensitively — the desk writes prose casing, not stored casing.
 */
export async function assertKnownSubjects(
  db: Database,
  subjects: { gamertag: string }[],
): Promise<void> {
  for (const s of subjects) {
    const hit = await db
      .select({ gamertag: players.gamertag })
      .from(players)
      .where(sql`lower(${players.gamertag}) = lower(${s.gamertag})`)
      .limit(1);
    if (hit.length === 0) {
      throw new Error(
        `subjects names "${s.gamertag}", which is not a known player. ` +
        `Fix the callsign — a subject roster becomes links on the published page.`,
      );
    }
  }
}

export async function draftArticle(db: Database, p: EditorialPayload): Promise<string> {
  const slug = p.slug ?? editorialSlug(p.format, p.headline, p.naturalKey);

  const clash = await db.select({ slug: articles.slug }).from(articles).where(eq(articles.slug, slug)).limit(1);
  if (clash[0]) throw new Error(`slug "${slug}" already exists — pass an explicit slug to override`);
  const dupe = await db.select({ slug: articles.slug }).from(articles).where(eq(articles.naturalKey, p.naturalKey)).limit(1);
  if (dupe[0]) throw new Error(`story already covered: natural key "${p.naturalKey}" is article "${dupe[0].slug}"`);
  await assertKnownSubjects(db, p.subjects);

  await db.insert(articles).values({
    kind: "news",
    status: "draft",
    slug,
    naturalKey: p.naturalKey,
    headline: p.headline,
    lede: p.lede,
    body: flattenBlocks(p.blocks),
    bodyBlocks: p.blocks,
    pullQuoteText: p.pullQuote?.text ?? null,
    pullQuoteAttribution: p.pullQuote?.attribution ?? null,
    tags: p.tags,
    facts: { format: p.format, factCheck: p.factCheck, subjects: p.subjects, subjectCount: p.subjects.length },
    promptVersion: "editorial-v1",
    model: null,                       // no OpenRouter call is ever made for an editorial piece
    generatedAt: new Date(),
  });
  return slug;
}

/** draft -> published. `created_at` is bumped: the feed orders by it, and a draft reviewed for
 *  three days must not publish already buried under newer stories. */
export async function publishArticle(db: Database, slug: string): Promise<"published" | "noop"> {
  const rows = await db.select({ status: articles.status }).from(articles)
    .where(and(eq(articles.kind, "news"), eq(articles.slug, slug))).limit(1);
  const row = rows[0];
  if (!row) throw new Error(`no article with slug "${slug}"`);
  if (row.status === "published") return "noop";
  if (row.status !== "draft") throw new Error(`"${slug}" is ${row.status}, not a draft`);
  await db.update(articles).set({ status: "published", createdAt: new Date() })
    .where(and(eq(articles.kind, "news"), eq(articles.slug, slug)));
  return "published";
}

/** published -> draft. The mistake hatch. NEVER writes `retracted`: retraction is a public
 *  correction with a banner and an overprinted OG card, owned by the newsdesk's own sweep. */
export async function unpublishArticle(db: Database, slug: string): Promise<void> {
  const res = await db.update(articles).set({ status: "draft" })
    .where(and(eq(articles.kind, "news"), eq(articles.slug, slug), eq(articles.status, "published"), editorialOnly))
    .returning({ slug: articles.slug });
  if (!res[0]) {
    throw new Error(
      `no PUBLISHED editorial article with slug "${slug}" (automated standing_dead:/long_form: rows are owned by the newsdesk sweep)`);
  }
}

/** Deletes a DRAFT. A published row is never deleted — the archive promise is permanent. */
export async function spikeArticle(db: Database, slug: string): Promise<void> {
  const res = await db.delete(articles)
    .where(and(eq(articles.kind, "news"), eq(articles.slug, slug), eq(articles.status, "draft"), editorialOnly))
    .returning({ slug: articles.slug });
  if (!res[0]) {
    throw new Error(
      `no editorial DRAFT with slug "${slug}" (a published article cannot be spiked, and automated rows are never touched)`);
  }
}

export async function listArticles(db: Database, draftsOnly = false) {
  return db.select({
    slug: articles.slug, status: articles.status, facts: articles.facts,
    headline: articles.headline, createdAt: articles.createdAt,
  }).from(articles)
    .where(draftsOnly ? and(eq(articles.kind, "news"), eq(articles.status, "draft")) : eq(articles.kind, "news"))
    .orderBy(desc(articles.createdAt));
}
