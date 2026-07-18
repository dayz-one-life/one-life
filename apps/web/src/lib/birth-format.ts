import { mapLabel, formatDuration, relativeDate } from "@/components/player/format";
import type { BirthNoticeArticle } from "./types";

export function freshSpawnsHref(page: number): string {
  return page > 1 ? `/fresh-spawns?page=${page}` : "/fresh-spawns";
}

export function birthNoticeHref(slug: string): string {
  return `/fresh-spawns/${slug}`;
}

/** Hours/minutes-aware relative time; falls back to the day-granular relativeDate for >= 24h. */
function bornAgo(iso: string, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  return relativeDate(iso, now);
}

/** "CHERNARUS BUREAU · 2 hours ago" — map is the dateline, never a coordinate (Fog Rule). */
export function birthDateline(map: string, bornAtIso: string, now: Date): string {
  return `${mapLabel(map).toUpperCase()} BUREAU · ${bornAgo(bornAtIso, now)}`;
}

export interface PriorFact { label: string; value: string; hot?: boolean }

function causeLabel(cause: string | null): string {
  if (cause === "pvp") return "Killed";
  if (!cause) return "Unknown";
  return cause.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The deterministic "Priors" box rows — never the LLM. Empty for a first-lifer (no priors). */
export function priorsFacts(a: BirthNoticeArticle): PriorFact[] {
  const p = a.priors;
  if (p.livesLived === 0) return [];
  const out: PriorFact[] = [
    { label: "Lives lived", value: String(p.livesLived) },
    { label: "Longest life", value: formatDuration(p.longestLifeSeconds) },
    { label: "Kills, all lives", value: String(p.totalKills) },
  ];
  if (p.usualDeathCause) out.push({ label: "Usual end", value: causeLabel(p.usualDeathCause), hot: true });
  return out;
}

export function birthShowingLine(page: number, total: number, pageSize: number): string {
  const to = Math.min(page * pageSize, total);
  const from = Math.min((page - 1) * pageSize + 1, to);
  return `Showing ${from}–${to} of ${total} ashore`;
}
