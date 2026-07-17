import type { PlayerPage } from "@/lib/types";

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

export function banCountdown(expiresAt: string | null, now: Date): string | null {
  if (!expiresAt) return null;
  return formatDuration((new Date(expiresAt).getTime() - now.getTime()) / 1000);
}

const MAP_LABEL: Record<string, string> = { chernarusplus: "Chernarus", sakhal: "Sakhal", enoch: "Livonia" };
export function mapLabel(map: string): string {
  return MAP_LABEL[map] ?? map.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function aliveMaps(page: Pick<PlayerPage, "standing">): string[] {
  return page.standing.filter((s) => s.state === "alive").map((s) => mapLabel(s.map));
}

export type HeroStat = { label: string; value: string; hot: boolean };

export function heroStats(totals: { kills: number; lives: number; deaths: number; longestLifeSeconds: number }): HeroStat[] {
  const out: HeroStat[] = [];
  if (totals.kills > 0) out.push({ label: "Kills", value: String(totals.kills), hot: false });
  out.push({ label: "Lives", value: String(totals.lives), hot: false });
  out.push({ label: "Deaths", value: String(totals.deaths), hot: true });
  out.push({ label: "Longest life", value: formatDuration(totals.longestLifeSeconds), hot: false });
  return out;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function monthYear(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function relativeDate(iso: string, now: Date): string {
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) { const w = Math.floor(days / 7); return `${w} week${w > 1 ? "s" : ""} ago`; }
  const m = Math.floor(days / 30);
  return `${m} month${m > 1 ? "s" : ""} ago`;
}
