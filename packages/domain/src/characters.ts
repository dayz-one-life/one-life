// Vanilla DayZ console survivor roster. The persona NAME comes from the game's authoritative
// `Create entity type 'Survivor[MF]_<Name>'` log line (create_entity) — NOT from head-model asset
// names, which do not match persona names (e.g. head `m_adam` is not a persona; there is no "Adam").
// Each name below has a headshot at apps/web/public/characters/<name>.webp. Unknown/modded classes
// resolve to null → the UI shows a neutral silhouette.

export type Gender = "female" | "male";
export type SurvivorClass = { class: string; name: string; gender: Gender; head: string };

const PERSONAS: Record<Gender, string[]> = {
  female: ["Baty", "Eva", "Frida", "Gabi", "Helga", "Irena", "Judy", "Keiko", "Linda", "Maria", "Naomi"],
  male: ["Boris", "Cyril", "Denis", "Elias", "Francis", "Guo", "Hassan", "Indar", "Jose", "Kaito",
         "Lewis", "Manua", "Mirek", "Niki", "Oliver", "Peter", "Quinn", "Rolf", "Seth", "Taiki"],
};

export const SURVIVOR_ROSTER: SurvivorClass[] = (Object.entries(PERSONAS) as [Gender, string[]][]).flatMap(
  ([gender, names]) => names.map((name) => ({
    class: `Survivor${gender === "female" ? "F" : "M"}_${name}`,
    name,
    gender,
    head: `${gender === "female" ? "f" : "m"}_${name.toLowerCase()}`,
  })),
);

const BY_CLASS = new Map(SURVIVOR_ROSTER.map((e) => [e.class, e]));

/** Roster entry for a `Survivor[MF]_<Name>` class, or null for unknown/modded classes
 *  (forward-compatible with game updates — an unrecognized class → silhouette). */
export function rosterByClass(cls: string): SurvivorClass | null {
  return BY_CLASS.get(cls) ?? null;
}
