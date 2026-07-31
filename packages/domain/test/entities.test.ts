import { describe, expect, it } from "vitest";
import { classifyEntityLabel } from "../src/entities.js";

describe("classifyEntityLabel", () => {
  it("classifies DayZ entity class names", () => {
    expect(classifyEntityLabel("Animal_CanisLupus")).toBe("wolf");
    expect(classifyEntityLabel("Animal_UrsusArctos")).toBe("bear");
    expect(classifyEntityLabel("Animal_CapreolusCapreolus")).toBe("animal");
    expect(classifyEntityLabel("Transport_CivilianSedan")).toBeNull();
    expect(classifyEntityLabel(null)).toBeNull();
  });
});
