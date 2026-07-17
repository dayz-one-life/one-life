import { cn } from "@/lib/utils";

type Character = { name: string | null } | null;

/** Portrait asset path for a roster character, or null (callers render the silhouette). */
export function characterSrc(character: Character): string | null {
  if (!character || !character.name) return null;
  return `/characters/${character.name.toLowerCase()}.webp`;
}

/** Decorative character portrait with silhouette fallback. alt="" — never given a role. */
export function CharacterImage({ character, size, dim = false }: { character: Character; size: number; dim?: boolean }) {
  const src = characterSrc(character);
  const box = { width: size, height: size };
  if (src) {
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        style={box}
        className={cn("border border-hairline object-cover", dim && "opacity-60 grayscale")}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      style={box}
      className={cn("flex items-center justify-center border border-hairline bg-bone text-ink-muted", dim && "opacity-60")}
    >
      {/* parent is aria-hidden — no second aria-hidden on the svg */}
      <svg viewBox="0 0 24 24" width={size * 0.5} height={size * 0.5} fill="currentColor">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" />
      </svg>
    </span>
  );
}
