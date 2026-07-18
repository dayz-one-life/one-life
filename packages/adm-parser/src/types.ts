export type DeathCause =
  | "pvp" | "bled_out" | "drowned" | "suicide" | "environment" | "died" | "unknown"
  // Stage 2 — named non-player killers. `vehicle`/`explosion` are reserved in the type; the
  // entity dict emits them only once real class names are confirmed by the backfill survey.
  | "wolf" | "bear" | "animal" | "infected" | "fall" | "vehicle" | "explosion";

export type BuildAction = "placed" | "built" | "dismantled" | "packed" | "repaired";

export type ParsedLine =
  | { kind: "connecting"; gamertag: string; dayzId: string }
  | { kind: "connected"; gamertag: string; dayzId: string }
  | { kind: "disconnected"; gamertag: string; dayzId: string }
  | { kind: "death"; victim: string; dayzId: string; cause: DeathCause;
      killer: string | null; weapon: string | null; distance: number | null;
      energy: number | null; water: number | null; bleedSources: number | null; deathEntity: string | null }
  | { kind: "position"; gamertag: string; x: number; y: number }
  | { kind: "emote"; gamertag: string; emote: string; item: string | null; x: number | null; y: number | null }
  | { kind: "hit"; victim: string; victimHp: number | null; attackerType: "player" | "infected" | "environment";
      attackerGamertag: string | null; attackerLabel: string | null; damage: number | null; bodyPart: string | null;
      x: number | null; y: number | null }
  | { kind: "build"; gamertag: string; action: BuildAction; object: string; className: string | null; tool: string | null;
      x: number | null; y: number | null }
  | { kind: "teleport"; gamertag: string; from: [number, number, number]; to: [number, number, number]; reason: string }
  | { kind: "roster"; count: number }
  | { kind: "boot"; localDateTime: string };
