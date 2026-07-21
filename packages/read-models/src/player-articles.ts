import type { Database } from "@onelife/db";
import { sql } from "drizzle-orm";

export const PLAYER_ARTICLES_PAGE_SIZE = 10;

export type PlayerArticleRole = "subject" | "killer";

export interface PlayerArticleRow {
  kind: string;
  slug: string;
  headline: string;
  createdAt: Date;
  role: PlayerArticleRole;
  mapSlug: string | null;
}

export interface PlayerArticlesFeed {
  rows: PlayerArticleRow[];
  total: number;
  page: number;
  pageSize: number;
}

/** postgres-js returns a RowList (a real Array) from db.execute; node-postgres would return
 *  `{ rows }`. Normalise once so the mapping below is driver-agnostic. */
function resultRows(res: unknown): Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  return ((res as { rows?: unknown[] }).rows ?? []) as Record<string, unknown>[];
}

/** postgres-js already parses timestamptz into a Date; a raw driver could hand back a string. */
const toDate = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v)));

/**
 * Every published article that names this player — either as the article's subject
 * (`articles.gamertag`) or as the killer named in someone else's obituary
 * (`articles.facts->>'killerGamertag'`). There is no join table; both facts live on the
 * `articles` row, so this is a UNION ALL of the two arms, deduped so an article that is
 * (degenerately) both about and by the same player appears exactly once, tagged "subject".
 *
 * Both arms filter `status = 'published'` and compare gamertags via `lower(...) = lower($1)`
 * to stay reachable by the partial expression indexes `articles_subject_idx` /
 * `articles_killer_idx` (migration 0017) — do not swap in ILIKE/upper() here.
 */
export async function getPlayerArticles(
  db: Database,
  gamertag: string,
  opts: { page: number; pageSize?: number },
): Promise<PlayerArticlesFeed> {
  const pageSize = opts.pageSize ?? PLAYER_ARTICLES_PAGE_SIZE;
  const page = Math.max(1, Math.trunc(opts.page) || 1);

  // DISTINCT ON (slug) with an ORDER BY that puts 'subject' before 'killer' collapses the
  // degenerate case where a player is both the subject and the killer of the same article —
  // it keeps exactly one row per slug, preferring the subject tag.
  const rows = await db.execute(sql`
    SELECT slug, kind, headline, created_at, map_slug, role
    FROM (
      SELECT DISTINCT ON (slug)
        slug, kind, headline, created_at, map_slug, role
      FROM (
        SELECT slug, kind, headline, created_at, map_slug, 'subject' AS role
        FROM articles
        WHERE status = 'published' AND lower(gamertag) = lower(${gamertag})
        UNION ALL
        SELECT slug, kind, headline, created_at, map_slug, 'killer' AS role
        FROM articles
        WHERE status = 'published' AND lower(facts->>'killerGamertag') = lower(${gamertag})
      ) both_arms
      ORDER BY slug, (role = 'subject') DESC
    ) deduped
    ORDER BY created_at DESC, slug
    LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
  `);

  const totalRes = await db.execute(sql`
    SELECT count(*)::int AS c
    FROM (
      SELECT DISTINCT slug
      FROM (
        SELECT slug
        FROM articles
        WHERE status = 'published' AND lower(gamertag) = lower(${gamertag})
        UNION ALL
        SELECT slug
        FROM articles
        WHERE status = 'published' AND lower(facts->>'killerGamertag') = lower(${gamertag})
      ) both_arms
    ) deduped
  `);

  const totalRows = resultRows(totalRes);
  const total = Number(totalRows[0]?.c ?? 0);

  return {
    rows: resultRows(rows).map((r) => ({
      kind: String(r.kind),
      slug: String(r.slug),
      headline: String(r.headline),
      createdAt: toDate(r.created_at),
      role: r.role as PlayerArticleRole,
      mapSlug: r.map_slug == null ? null : String(r.map_slug),
    })),
    total,
    page,
    pageSize,
  };
}
