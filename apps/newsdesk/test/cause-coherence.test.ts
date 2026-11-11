import { describe, it, expect } from "vitest";
import { INTERNAL_CAUSES, PUBLIC_INFERRED, type Confidence, type InferredFamily } from "@onelife/death-verdict";
import { composeTags, buildObituaryPrompt, causeUnrecorded, NO_MECHANISM_DIRECTIVE } from "../src/prompt.js";
import { factsFor } from "./facts-fixture.js";

// The bug this file exists for: the paper contradicted itself on ~23% of deaths — an
// "Environment" tag over prose forbidden to name terrain, exposure, or weather. In v4 the tag and
// the prose both come from one stored verdict, so they cannot disagree.
const CONFIDENCES: Confidence[] = ["definitive", "strong", "inferred", "unknown"];

describe("tag and prose agree", () => {
  it("tag \"Unknown\" if and only if the certainty is unknown or withheld", () => {
    for (const cause of INTERNAL_CAUSES) {
      for (const confidence of CONFIDENCES) {
        for (const upstream of [null, { cause: "infected", confidence }, { cause: "player", confidence }]) {
          const f = factsFor({ verdict: { cause, confidence, upstream } });
          const tag = composeTags(f, [])[2];
          expect(tag === "Unknown", `${cause}:${confidence}`).toBe(f.death.certainty === "unknown");
          expect(f.causeCategory).toBe(tag);
        }
      }
    }
  });

  it("a cause that is not recorded tags Unknown and instructs the model that no mechanism is recorded", () => {
    const f = factsFor({ verdict: { cause: "unknown", confidence: "unknown" } });
    expect(composeTags(f, ["Elektro"])).toEqual(["Obituaries", "Chernarus", "Unknown", "Elektro"]);
    expect(causeUnrecorded(f)).toBe(true);
    expect(buildObituaryPrompt(f).user).toContain(NO_MECHANISM_DIRECTIVE);
  });

  it("a real mechanism tags its family and drops the no-mechanism directive", () => {
    const f = factsFor({ verdict: { cause: "bled_out_infected", confidence: "strong" } });
    expect(composeTags(f, [])).toEqual(["Obituaries", "Chernarus", "Blood Loss"]);
    expect(buildObituaryPrompt(f).user).not.toContain(NO_MECHANISM_DIRECTIVE);
  });

  it("an inferred cause in a family that is switched off reads as not recorded, tag and prompt alike", () => {
    const family: InferredFamily = "exposure";
    const was = PUBLIC_INFERRED[family];
    (PUBLIC_INFERRED as Record<InferredFamily, boolean>)[family] = false;
    try {
      const f = factsFor({ verdict: { cause: "cold_exposure", confidence: "inferred" } });
      expect(composeTags(f, [])[2]).toBe("Unknown");
      const { user } = buildObituaryPrompt(f);
      expect(user).toContain(NO_MECHANISM_DIRECTIVE);
      expect(user).not.toContain("Cause of death");
      expect(user).not.toContain("died of exposure");
    } finally {
      (PUBLIC_INFERRED as Record<InferredFamily, boolean>)[family] = was;
    }
  });
});
