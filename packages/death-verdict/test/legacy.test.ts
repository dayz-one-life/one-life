import { describe, it, expect } from "vitest";
import { LOGOUT_CAUSES, PUBLIC_ROWS, legacyCause, type Confidence, type PublicCauseKey } from "../src/index.js";

const KEYS = Object.keys(PUBLIC_ROWS) as PublicCauseKey[];
const CERTAINTIES: Confidence[] = ["definitive", "strong", "inferred", "unknown"];
// The union readers had before the stored verdict (`DeathVerdict["cause"]` in @onelife/domain).
// Written out, not imported: this package has no workspace dependencies, and the point of the
// legacy fields is that this list does not move.
const TODAY = ["pvp", "suicide", "starvation", "dehydration", "bled_out", "mauled", "environmental", "unknown",
  "wolf", "bear", "animal", "infected", "fall", "vehicle", "explosion"];

describe("legacyCause", () => {
  it("never returns a logout token or pneumonia", () => {
    for (const key of KEYS) for (const c of CERTAINTIES) {
      const { cause } = legacyCause(key, c);
      expect(LOGOUT_CAUSES.has(cause as never), `${key}/${c}`).toBe(false);
      expect(cause).not.toMatch(/logout|respawn|unconscious|restrain|pneumonia|silicosis|heatstroke/);
    }
  });

  it("never returns high for an inferred certainty", () => {
    for (const key of KEYS) {
      expect(legacyCause(key, "inferred").confidence, key).toBe("low");
      expect(legacyCause(key, "unknown"), key).toEqual({ cause: "unknown", confidence: "low" });
    }
  });

  it("every result is in today's DeathVerdict[\"cause\"] union", () => {
    for (const key of KEYS) for (const c of CERTAINTIES) expect(TODAY, `${key}/${c}`).toContain(legacyCause(key, c).cause);
  });

  it("an unknown cause is never high", () => {
    for (const key of KEYS) for (const c of CERTAINTIES) {
      const r = legacyCause(key, c);
      if (r.cause === "unknown") expect(r.confidence, `${key}/${c}`).toBe("low");
    }
  });

  it("the table", () => {
    const high = (cause: string) => ({ cause, confidence: "high" });
    const D: Record<PublicCauseKey, string> = {
      pvp: "pvp", pvp_unnamed: "pvp", shot: "pvp", held_grenade: "pvp",
      suicide: "suicide", self_inflicted: "suicide",
      tripwire: "explosion", land_mine: "explosion", grenade: "explosion", explosion: "explosion",
      own_explosive: "explosion", fuel_pump: "explosion",
      hit_by_vehicle: "vehicle", hit_by_vehicle_driver: "vehicle", motorbike_crash: "vehicle", vehicle_crash: "vehicle",
      vehicle: "vehicle",
      infected: "infected", wolf: "wolf", bear: "bear", dog: "animal", animal: "animal",
      fall: "fall", bled_out: "bled_out",
      starvation: "starvation", starvation_and_thirst: "starvation", dehydration: "dehydration",
      burned: "environmental", drowned: "environmental", exposure: "environmental", illness: "environmental",
      withheld: "unknown", unknown: "unknown", awaiting: "unknown",
    };
    for (const key of KEYS) {
      for (const c of ["definitive", "strong"] as const) {
        expect(legacyCause(key, c), `${key}/${c}`).toEqual(D[key] === "unknown" ? { cause: "unknown", confidence: "low" } : high(D[key]));
      }
    }
    // Older readers print "Likely starvation" for a low confidence, so these three keep their word.
    expect(legacyCause("starvation", "inferred")).toEqual({ cause: "starvation", confidence: "low" });
    expect(legacyCause("starvation_and_thirst", "inferred")).toEqual({ cause: "starvation", confidence: "low" });
    expect(legacyCause("dehydration", "inferred")).toEqual({ cause: "dehydration", confidence: "low" });
    // Every other inferred row degrades to unknown.
    for (const key of KEYS) {
      if (key === "starvation" || key === "starvation_and_thirst" || key === "dehydration") continue;
      expect(legacyCause(key, "inferred"), key).toEqual({ cause: "unknown", confidence: "low" });
    }
  });
});
