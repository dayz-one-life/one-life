import type { PlayerCharacter, PlayerPage } from "@/lib/types";

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

export function avatarSrc(character: PlayerCharacter | null): string | null {
  if (!character || !character.name) return null;
  return `/characters/${character.name.toLowerCase()}.webp`;
}

export function banCountdown(expiresAt: string | null, now: Date): string | null {
  if (!expiresAt) return null;
  return formatDuration((new Date(expiresAt).getTime() - now.getTime()) / 1000);
}

const MAP_LABEL: Record<string, string> = { chernarusplus: "Chernarus", sakhal: "Sakhal" };
export function mapLabel(map: string): string {
  return MAP_LABEL[map] ?? map.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function heroStatusLine(page: Pick<PlayerPage, "standing">): string {
  const alive = page.standing.filter((s) => s.state === "alive").map((s) => mapLabel(s.map));
  return alive.length ? `Alive on ${alive.join(", ")}` : "No open lives";
}
