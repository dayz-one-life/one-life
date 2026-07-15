import type { Server, SurvivorSort } from "./types";

export const SORTS: SurvivorSort[] = ["kills", "time", "longest"];
export const DEFAULT_SORT: SurvivorSort = "time";

/** Coerce a raw `page` query value to a 1-based page number (default/floor 1). */
export function parsePage(raw: string | string[] | undefined): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/**
 * Board tabs: an "All maps" tab (slug null) followed by one tab per active,
 * slugged server (label = server name), sorted alphabetically by label.
 * Unslugged servers never participate.
 */
export function buildTabs(servers: Server[]): { slug: string | null; label: string }[] {
  return [
    { slug: null, label: "All maps" },
    ...servers
      .filter((s): s is Server & { slug: string } => s.slug !== null)
      .map((s) => ({ slug: s.slug, label: s.name }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ];
}

export type SurvivorsRoute =
  | { kind: "board"; slug: string | null; sort: SurvivorSort }
  | { kind: "redirect"; to: string }
  | { kind: "notFound" };

function isSort(v: string): v is SurvivorSort {
  return (SORTS as string[]).includes(v);
}

/**
 * Resolve the dynamic path segments after `/survivors` (sort lives in the path,
 * page does not) against the set of active server slugs.
 * - []                 -> combined board, default sort
 * - [sortWord]         -> combined board sorted by it (explicit default -> redirect to /survivors)
 * - [slug]             -> that map, default sort
 * - [slug, sortWord]   -> that map sorted (explicit default -> redirect to /survivors/<slug>)
 * - anything else      -> notFound
 * The three sort words are reserved and win over an identically-named slug.
 */
export function resolveSurvivorsRoute(segments: string[], slugs: string[]): SurvivorsRoute {
  if (segments.length === 0) return { kind: "board", slug: null, sort: DEFAULT_SORT };
  if (segments.length === 1) {
    const seg = segments[0]!;
    if (isSort(seg)) {
      return seg === DEFAULT_SORT
        ? { kind: "redirect", to: "/survivors" }
        : { kind: "board", slug: null, sort: seg };
    }
    if (slugs.includes(seg)) return { kind: "board", slug: seg, sort: DEFAULT_SORT };
    return { kind: "notFound" };
  }
  if (segments.length === 2) {
    const mapSeg = segments[0]!;
    const sortSeg = segments[1]!;
    if (!slugs.includes(mapSeg)) return { kind: "notFound" };
    if (!isSort(sortSeg)) return { kind: "notFound" };
    if (sortSeg === DEFAULT_SORT) return { kind: "redirect", to: `/survivors/${mapSeg}` };
    return { kind: "board", slug: mapSeg, sort: sortSeg };
  }
  return { kind: "notFound" };
}
