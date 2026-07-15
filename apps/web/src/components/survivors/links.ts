import type { SurvivorSort } from "@/lib/types";

/**
 * Pure href builder for the survivors board.
 * - slug null -> "/survivors", else "/survivors/<slug>"
 * - ?sort included only when not the default ("kills")
 * - ?page included only when > 1
 */
export function boardHref(slug: string | null, sort: SurvivorSort, page: number): string {
  const base = slug === null ? "/survivors" : `/survivors/${slug}`;
  const params = new URLSearchParams();
  if (sort !== "kills") params.set("sort", sort);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

export const MAP_TABS: { slug: string | null; label: string }[] = [
  { slug: null, label: "All maps" },
  { slug: "chernarus", label: "Chernarus" },
  { slug: "sakhal", label: "Sakhal" },
];
