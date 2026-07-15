import type { Server, SurvivorSort } from "./types";

const SORTS: SurvivorSort[] = ["kills", "time", "longest"];

/** Coerce a raw `sort` query value to a valid `SurvivorSort` (default `kills`). */
export function parseSort(raw: string | string[] | undefined): SurvivorSort {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return SORTS.includes(v as SurvivorSort) ? (v as SurvivorSort) : "kills";
}

/** Coerce a raw `page` query value to a 1-based page number (default/floor 1). */
export function parsePage(raw: string | string[] | undefined): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/**
 * Board tabs: an "All maps" tab (slug null) followed by one tab per active,
 * slugged server (label = server name). Unslugged servers never participate.
 */
export function buildTabs(servers: Server[]): { slug: string | null; label: string }[] {
  return [
    { slug: null, label: "All maps" },
    ...servers
      .filter((s): s is Server & { slug: string } => s.slug !== null)
      .map((s) => ({ slug: s.slug, label: s.name })),
  ];
}
