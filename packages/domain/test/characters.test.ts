import { describe, it, expect } from "vitest";
import { SURVIVOR_ROSTER, classFromHead, rosterByClass } from "../src/characters.js";

describe("survivor roster", () => {
  it("has all 31 vanilla survivors", () => {
    expect(SURVIVOR_ROSTER).toHaveLength(31);
    expect(SURVIVOR_ROSTER.filter((s) => s.gender === "female")).toHaveLength(11);
    expect(SURVIVOR_ROSTER.filter((s) => s.gender === "male")).toHaveLength(20);
  });

  it("maps heads to classes, handling _2 variants", () => {
    expect(classFromHead("f_linda_2")).toBe("SurvivorF_Linda");
    expect(classFromHead("m_niki_2")).toBe("SurvivorM_Niki");
    expect(classFromHead("f_helga")).toBe("SurvivorF_Helga");
    expect(classFromHead("m_cyril")).toBe("SurvivorM_Cyril");
  });

  it("returns null for non-head strings", () => {
    expect(classFromHead("ZmbM_something")).toBeNull();
    expect(classFromHead("not-a-head")).toBeNull();
  });

  it("resolves roster entries by class, null for unknown", () => {
    expect(rosterByClass("SurvivorF_Helga")).toMatchObject({ name: "Helga", gender: "female", head: "f_helga" });
    expect(rosterByClass("SurvivorM_Niki")).toMatchObject({ name: "Niki", gender: "male", head: "m_niki_2" });
    expect(rosterByClass("SurvivorX_Unknown")).toBeNull();
  });
});
