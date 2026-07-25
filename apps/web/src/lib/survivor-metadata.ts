import type { Metadata } from "next";
import { boardHref } from "@/components/survivors/links";

/** Title-cases a map slug: "chernarus" -> "Chernarus". */
function mapLabel(slug: string): string {
  return slug.replace(/\b\w/g, (c) => c.toUpperCase());
}

export interface SurvivorMetadataArgs {
  slug: string;
  page: number;
  total: number;
  pageSize: number;
  leaderName?: string | null;
}

/**
 * Pure builder for a survivors-board page's Next `Metadata`.
 *
 * - Title: `Top {Map} survivors`, with `· Page N` appended when N > 1. The `by {sort}` clause is
 *   gone with the sort layer (sub-project D) — there is one ranking, so naming it in every title
 *   said nothing.
 * - Canonical is **self-referential** — `boardHref(slug, page)`, NOT collapsed to page 1, so
 *   paginated URLs canonicalise to themselves.
 * - prev/next paginated links are surfaced via the `other` field when they exist.
 *
 * ⚠️ `slug` is required: there is no combined board, so there is no board without a map.
 */
export function buildSurvivorMetadata(args: SurvivorMetadataArgs): Metadata {
  const { slug, page, total, pageSize, leaderName } = args;

  const map = mapLabel(slug);
  const baseTitle = `Top ${map} survivors`;
  const title = page > 1 ? `${baseTitle} · Page ${page}` : baseTitle;

  const leaderClause = leaderName ? ` ${leaderName} leads the pack.` : "";
  const description = `The survivors currently alive on ${map}, ranked by time alive.${leaderClause}`;

  const canonical = boardHref(slug, page);

  const hasPrev = page > 1;
  const hasNext = page * pageSize < total;
  const other: Record<string, string> = {};
  if (hasPrev) other.prev = boardHref(slug, page - 1);
  if (hasNext) other.next = boardHref(slug, page + 1);

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, type: "website" },
    twitter: { card: "summary", title, description },
    ...(Object.keys(other).length > 0 ? { other } : {}),
  };
}
