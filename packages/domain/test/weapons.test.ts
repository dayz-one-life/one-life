import { describe, it, expect } from "vitest";
import { isMeleeWeapon, MELEE_WEAPONS } from "../src/weapons.js";

describe("isMeleeWeapon", () => {
  it("matches known melee weapons case-insensitively and trimmed", () => {
    expect(isMeleeWeapon("Fists")).toBe(true);
    expect(isMeleeWeapon("  combat knife ")).toBe(true);
    expect(isMeleeWeapon("MACHETE")).toBe(true);
  });

  it("treats firearms, unknown weapons, and null as non-melee", () => {
    expect(isMeleeWeapon("M4-A1")).toBe(false);
    expect(isMeleeWeapon("Blowtorch")).toBe(false); // unknown → firearm (spec §4)
    expect(isMeleeWeapon(null)).toBe(false);
  });

  it("stores names lowercase so the set is directly checkable", () => {
    for (const name of MELEE_WEAPONS) expect(name).toBe(name.toLowerCase());
  });
});
