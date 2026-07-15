import type { PlayerCharacter } from "@/lib/types";
import { avatarSrc } from "./format";
import { cn } from "@/lib/utils";

export function PlayerAvatar({
  character,
  size = 44,
  dim = false,
}: {
  character: PlayerCharacter | null;
  size?: number;
  dim?: boolean;
}) {
  const src = avatarSrc(character);
  const box = { width: size, height: size };
  if (src) {
    return (
      <img
        src={src}
        alt={character?.name ?? "survivor"}
        style={box}
        className={cn("rounded-full border border-line object-cover", dim && "opacity-60 grayscale")}
      />
    );
  }
  return (
    <span
      aria-label="Unknown survivor"
      style={box}
      className={cn("flex items-center justify-center rounded-full border border-line bg-panel-2 text-muted", dim && "opacity-60")}
    >
      <svg viewBox="0 0 24 24" width={size * 0.5} height={size * 0.5} fill="currentColor" aria-hidden="true">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" />
      </svg>
    </span>
  );
}
