import type { Metadata } from "next";
import type { SurvivorSort } from "./types";
import { boardHref } from "@/components/survivors/links";

const SORT_LABELS: Record<SurvivorSort, string> = {
  kills: "Kills",
  time: "Time alive",
  longest: "Longest kill",
};

/** Title-cases a map slug: "chernarus" -> "Chernarus". */
function mapLabel(slug: string): string {
  return slug.replace(/\b\w/g, (c) => c.toUpperCase());
}

export interface SurvivorMetadataArgs {
  slug: string | null;
  sort: SurvivorSort;
  page: number;
  total: number;
  pageSize: number;
  leaderName?: string | null;
}

/**
 * Pure builder for a survivors-board page's Next `Metadata`.
 *
 * - Title: `Top {Map} survivors by {sortLabel}` (combined board drops the map name),
 *   with `· Page N` appended when N > 1.
 * - Canonical is **self-referential** — `boardHref(slug, sort, page)`, NOT collapsed
 *   to page 1 (so paginated URLs canonicalise to themselves).
 * - prev/next paginated links are surfaced via the `other` field when they exist.
 */
export function buildSurvivorMetadata(args: SurvivorMetadataArgs): Metadata {
  const { slug, sort, page, total, pageSize, leaderName } = args;

  const sortLabel = SORT_LABELS[sort];
  const scope = slug ? `${mapLabel(slug)} survivors` : "survivors";
  const baseTitle = `Top ${scope} by ${sortLabel}`;
  const title = page > 1 ? `${baseTitle} · Page ${page}` : baseTitle;

  const where = slug ? `on ${mapLabel(slug)}` : "across every One Life server";
  const leaderClause = leaderName ? ` ${leaderName} leads the pack.` : "";
  const description = `The survivors currently alive ${where}, ranked by ${sortLabel.toLowerCase()}.${leaderClause}`;

  const canonical = boardHref(slug, sort, page);

  const hasPrev = page > 1;
  const hasNext = page * pageSize < total;
  const other: Record<string, string> = {};
  if (hasPrev) other.prev = boardHref(slug, sort, page - 1);
  if (hasNext) other.next = boardHref(slug, sort, page + 1);

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, type: "website" },
    twitter: { card: "summary", title, description },
    ...(Object.keys(other).length > 0 ? { other } : {}),
  };
}
