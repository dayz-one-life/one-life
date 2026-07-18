import { describe, it, expect } from "vitest";
import { causeLabel, verdictPhrase } from "./cause-format";

describe("causeLabel", () => {
  it("pvp => Killed", () => expect(causeLabel("pvp")).toBe("Killed"));
  it("null => Unknown", () => expect(causeLabel(null)).toBe("Unknown"));
  it("humanizes underscore tokens", () => expect(causeLabel("bled_out")).toBe("Bled Out"));
});

describe("verdictPhrase", () => {
  const v = (cause: string, confidence: "high" | "low" = "high", conditions: string[] = []) => ({ cause, confidence, conditions });

  it("no verdict falls back to the mechanism label", () => {
    expect(verdictPhrase(null, "drowned")).toBe("Drowned");
  });
  it("pvp => Killed", () => expect(verdictPhrase(v("pvp"), "pvp")).toBe("Killed"));
  it("inferred nouns render directly", () => {
    expect(verdictPhrase(v("starvation"), "died")).toBe("Starvation");
    expect(verdictPhrase(v("mauled"), "died")).toBe("Mauled");
    expect(verdictPhrase(v("bled_out"), "bled_out")).toBe("Bled out");
  });
  it("low confidence hedges", () => {
    expect(verdictPhrase(v("starvation", "low"), "died")).toBe("Likely starvation");
  });
  it("suicide lists non-healthy conditions", () => {
    expect(verdictPhrase(v("suicide", "high", ["starving", "hunted"]), "suicide")).toBe("Suicide (starving, hunted)");
  });
  it("healthy suicide reads deliberate", () => {
    expect(verdictPhrase(v("suicide", "high", ["healthy"]), "suicide")).toBe("Suicide (in good health)");
  });
  it("environmental/unknown verdicts keep the mechanism's specificity", () => {
    expect(verdictPhrase(v("environmental"), "drowned")).toBe("Drowned");
    expect(verdictPhrase(v("unknown", "low"), null)).toBe("Unknown");
  });
});
