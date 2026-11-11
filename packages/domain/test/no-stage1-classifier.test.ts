import { describe, it, expect } from "vitest";
import * as domain from "../src/index.js";

/**
 * The stage-1 read-time classifier (`classifyDeath`, `causeFamily`, `ENTITY_MECHANISMS`) is gone
 * (death-verdict plan step 10). Every page reads the stored verdict from `@onelife/death-verdict`;
 * a second classifier here would be a second answer to "how did this player die".
 */
describe("@onelife/domain after the death-verdict cleanup", () => {
  it.each(["classifyDeath", "causeFamily", "ENTITY_MECHANISMS", "RECENT_HIT_WINDOW_S", "STARVE_ENERGY_MAX", "DEHYDRATE_WATER_MAX", "TERMINAL_HP_MAX"])(
    "exports no %s", (name) => {
      expect(Object.hasOwn(domain, name)).toBe(false);
    });

  it("still exports the entity labels the parser and the encounters read", () => {
    expect(domain.classifyEntityLabel("Animal_CanisLupus_Grey")).toBe("wolf");
  });
});
