import { CharacterImage } from "@/components/character-image";
import type { PlayerCharacter } from "@/lib/types";

export function PlayerAvatar({ character, size = 44, dim = false }: { character: PlayerCharacter | null; size?: number; dim?: boolean }) {
  return <CharacterImage character={character} size={size} dim={dim} />;
}
