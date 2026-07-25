import type { Server } from "./types";

/** Coerce a raw `page` query value to a 1-based page number (default/floor 1). */
export function parsePage(raw: string | string[] | undefined): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/**
 * Board tabs: one per active, slugged server (label = server name), alphabetically by label.
 * Unslugged servers never participate.
 *
 * ⚠️ There is no "All maps" tab any more. Sub-project D deleted the combined board: a life is
 * per-server, so ranking across servers puts lives in one race that were never in it.
 */
export function buildTabs(servers: Server[]): { slug: string; label: string }[] {
  return servers
    .filter((s): s is Server & { slug: string } => s.slug !== null)
    .map((s) => ({ slug: s.slug, label: s.name }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export type SurvivorsRoute =
  | { kind: "board"; slug: string }
  | { kind: "notFound" };

/**
 * Resolve the dynamic segment after `/survivors`. Page lives in the query string; nothing else
 * lives in the path.
 *
 * ⚠️ Sub-project D deleted the sort layer, and with it **the rule that a server's `servers.slug`
 * may never be `kills`, `time` or `longest`**. Those words shadowed a slug in this exact position;
 * with no sort segment there is nothing left to shadow, and the constraint must be treated as
 * GONE rather than merely unenforced — a future maintainer honouring a dead rule is the failure
 * mode this note exists to prevent.
 */
export function resolveSurvivorsRoute(segments: string[], slugs: string[]): SurvivorsRoute {
  if (segments.length !== 1) return { kind: "notFound" };
  const seg = segments[0]!;
  return slugs.includes(seg) ? { kind: "board", slug: seg } : { kind: "notFound" };
}
