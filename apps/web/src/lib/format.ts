export const BOARDS = [
  "alive-longest", "alltime-longest", "most-kills", "longest-killstreak",
  "longest-kills",
] as const;

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (parts.length === 0) parts.push(`${s % 60}s`);
  return parts.join(" ");
}

export function formatDistance(meters: number | null | undefined): string {
  if (meters === null || meters === undefined) return "—";
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${Math.round(meters)} m`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

export function boardLabel(board: string): string {
  return board.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

const DURATION_BOARDS = new Set(["alive-longest", "alltime-longest"]);
const DISTANCE_BOARDS = new Set(["longest-kills"]);

export function formatBoardValue(board: string, value: number): string {
  if (DURATION_BOARDS.has(board)) return formatDuration(value);
  if (DISTANCE_BOARDS.has(board)) return formatDistance(value);
  return String(value);
}
