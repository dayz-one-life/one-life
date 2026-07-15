import type { SurvivorSort } from "@/lib/types";
import { DEFAULT_SORT } from "@/lib/board-params";

/**
 * Pure href builder for the survivors board.
 * - slug null -> "/survivors", else "/survivors/<slug>"
 * - sort appended as a path segment only when not the default ("time")
 * - ?page included only when > 1
 */
export function boardHref(slug: string | null, sort: SurvivorSort, page: number): string {
  let base = slug === null ? "/survivors" : `/survivors/${slug}`;
  if (sort !== DEFAULT_SORT) base += `/${sort}`;
  const params = new URLSearchParams();
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

export const MAP_TABS: { slug: string | null; label: string }[] = [
  { slug: null, label: "All maps" },
  { slug: "chernarus", label: "Chernarus" },
  { slug: "sakhal", label: "Sakhal" },
];
