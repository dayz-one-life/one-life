import type { SurvivorCharacter } from "@/lib/types";

export function formatTimeAlive(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}

/**
 * Avatar asset path for a survivor's roster character, or null when
 * unknown (character is null, or its roster name is null). Callers must
 * render an inline silhouette fallback when this returns null — no binary
 * placeholder asset is shipped.
 */
export function avatarSrc(character: SurvivorCharacter | null): string | null {
  if (!character || !character.name) return null;
  return `/characters/${character.name.toLowerCase()}.webp`;
}
