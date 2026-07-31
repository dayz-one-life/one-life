// Ordered entity dict (first match wins) — moved verbatim from adm-parser's death.ts so hit
// labels and death entities classify with the SAME rules. Only class-name patterns
// confirmable from DayZ conventions ship; anything else returns null.
const ENTITY_CLASSES: readonly [RegExp, "wolf" | "bear" | "animal"][] = [
  [/^Animal_CanisLupus/, "wolf"],
  [/^Animal_UrsusArctos/, "bear"],
  [/^Animal_/, "animal"],
];

export function classifyEntityLabel(label: string | null): "wolf" | "bear" | "animal" | null {
  if (!label) return null;
  return ENTITY_CLASSES.find(([re]) => re.test(label))?.[1] ?? null;
}
