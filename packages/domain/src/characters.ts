// Vanilla DayZ console survivor roster. Each survivor head model maps 1:1 to a
// Survivor[MF]_<Name> class. `_2` head variants map to the same base name
// (m_niki_2 → SurvivorM_Niki). Derived from the live 1.29 asset-preload section.

export type Gender = "female" | "male";
export type SurvivorClass = { class: string; name: string; gender: Gender; head: string };

const HEADS: Record<Gender, string[]> = {
  female: ["f_baty", "f_eva_2", "f_frida_2", "f_gabi_2", "f_helga", "f_irena_2", "f_judy", "f_keiko", "f_linda_2", "f_maria_2", "f_naomi"],
  male: ["m_adam", "m_boris", "m_cyril", "m_denis_2", "m_elias", "m_francis", "m_guo", "m_hassan", "m_indar", "m_jose", "m_kaito", "m_lewis", "m_manua", "m_niki_2", "m_oliver", "m_peter", "m_quinn", "m_rolf", "m_seth", "m_taiki"],
};

function nameFromHead(head: string): string {
  const base = head.replace(/^[mf]_/, "").replace(/_2$/, "");
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/** "f_linda_2" → "SurvivorF_Linda"; non-head strings → null (forward-compat with game updates). */
export function classFromHead(head: string): string | null {
  const m = /^([mf])_/.exec(head);
  if (!m) return null;
  return `Survivor${m[1] === "f" ? "F" : "M"}_${nameFromHead(head)}`;
}

export const SURVIVOR_ROSTER: SurvivorClass[] = (Object.entries(HEADS) as [Gender, string[]][]).flatMap(
  ([gender, heads]) => heads.map((head) => ({ class: classFromHead(head)!, name: nameFromHead(head), gender, head })),
);

const BY_CLASS = new Map(SURVIVOR_ROSTER.map((e) => [e.class, e]));

/** Roster entry for a Survivor[MF]_<Name> class, or null for unknown/modded classes. */
export function rosterByClass(cls: string): SurvivorClass | null {
  return BY_CLASS.get(cls) ?? null;
}
