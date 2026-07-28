import type { Database } from "@onelife/db";
import { articles } from "@onelife/db";
import { and, eq, desc } from "drizzle-orm";

/** One recently published article's prose fingerprint — what the do-not-reuse block shows the
 *  model. Mirrors recentCovers in image-pg-store.ts (same kind/status/order/limit shape). */
export interface RecentProse {
  headline: string;
  attribution: string | null;
  opener: string;
}

const OPENER_MAX = 120;

/** The lede's first sentence, trimmed and truncated for the prompt block. */
function opener(lede: string | null): string {
  const s = (lede ?? "").trim();
  if (!s) return "";
  const stop = s.search(/[.!?](\s|$)/);
  const first = (stop === -1 ? s : s.slice(0, stop + 1)).trim();
  return first.length > OPENER_MAX ? `${first.slice(0, OPENER_MAX).trimEnd()}…` : first;
}

/** The last N same-kind published articles, for the do-not-reuse prose block. Read-only — no
 *  migration, no new storage; headline / pull_quote_attribution / lede already exist. */
export async function recentProse(db: Database, kind: string, limit = 12): Promise<RecentProse[]> {
  const rows = await db
    .select({ headline: articles.headline, attribution: articles.pullQuoteAttribution, lede: articles.lede })
    .from(articles)
    .where(and(eq(articles.kind, kind), eq(articles.status, "published")))
    .orderBy(desc(articles.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    headline: r.headline ?? "",
    attribution: r.attribution ?? null,
    opener: opener(r.lede ?? null),
  }));
}
