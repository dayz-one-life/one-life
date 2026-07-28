export function formatTimeAlive(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}

export type RowTier = "hero" | "podium" | "compact";

/** Visual tier by global rank: 1 = hero row, 2-5 = podium, everything else compact. */
export function tierFor(rank: number): RowTier {
  if (rank === 1) return "hero";
  if (rank <= 5) return "podium"; // widened from 3 (avatar-account-pass spec §6)
  return "compact";
}

export function dekLine(total: number): string {
  return `${total} still drawing breath. Every name is one bad decision from the archive.`;
}

export function showingLine(page: number, pageSize: number, total: number): string {
  const to = Math.min(page * pageSize, total);
  const from = Math.min((page - 1) * pageSize + 1, to);
  return `Showing ${from}–${to} of ${total} still breathing`;
}
