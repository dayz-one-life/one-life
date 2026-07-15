import { describe, it, expect } from "vitest";
import { SURVIVOR_ROSTER, rosterByClass } from "../src/characters.js";

describe("survivor roster", () => {
  it("has all 31 vanilla survivors (11 female, 20 male)", () => {
    expect(SURVIVOR_ROSTER).toHaveLength(31);
    expect(SURVIVOR_ROSTER.filter((s) => s.gender === "female")).toHaveLength(11);
    expect(SURVIVOR_ROSTER.filter((s) => s.gender === "male")).toHaveLength(20);
  });

  it("resolves real create_entity persona classes, including Mirek", () => {
    expect(rosterByClass("SurvivorF_Helga")).toMatchObject({ name: "Helga", gender: "female" });
    expect(rosterByClass("SurvivorM_Niki")).toMatchObject({ name: "Niki", gender: "male" });
    // Mirek is a real persona (create_entity emits SurvivorM_Mirek) — must resolve, not null.
    expect(rosterByClass("SurvivorM_Mirek")).toMatchObject({ name: "Mirek", gender: "male" });
  });

  it("has no phantom 'Adam' and returns null for unknown/modded classes", () => {
    // "Adam" only ever came from the (removed) head-asset path; it is not a real persona.
    expect(rosterByClass("SurvivorM_Adam")).toBeNull();
    expect(SURVIVOR_ROSTER.some((s) => s.name === "Adam")).toBe(false);
    expect(SURVIVOR_ROSTER.some((s) => s.name === "Mirek")).toBe(true);
    expect(rosterByClass("SurvivorX_Unknown")).toBeNull();
    expect(rosterByClass("ZmbM_something")).toBeNull();
  });
});
