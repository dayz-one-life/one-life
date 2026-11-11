import { describe, it, expect } from "vitest";
import { PUBLIC_ROWS, legacyCause, type Confidence, type PublicCauseKey } from "@onelife/death-verdict";
import { readerVerdict, verdictPhrase } from "./fixtures/reader-v0.80.0.js";

/**
 * An article written from release 3 on keeps `articles.cause` and `facts.verdict` in TODAY'S
 * vocabulary (spec 3.6), so the v0.80.0 reader — an old build, a rolled-back deploy, an old mobile
 * app — still prints something correct and hedged. This drives the verbatim v0.80.0 code over every
 * (key, certainty) the legacy fields can come from.
 */
const KEYS = Object.keys(PUBLIC_ROWS) as PublicCauseKey[];
const CERTAINTIES: Confidence[] = ["definitive", "strong", "inferred", "unknown"];

// Every word the v0.80.0 reader could already print for a death. Anything else would be a raw key
// leaking through causeLabel's title-casing ("Explosive Trap", "Land Mine").
const TODAYS_WORDS = new Set([
  "Killed", "Suicide", "Explosion", "Vehicle", "Infected", "Wolf", "Bear", "Animal", "Fell", "Bled out",
  "Starvation", "Dehydration", "Likely starvation", "Likely dehydration", "Environmental", "Unknown",
]);

function chip(key: PublicCauseKey, certainty: Confidence): string {
  const legacy = legacyCause(key, certainty);
  // what step 8 writes: articles.cause = the legacy token, facts.verdict = the legacy triple
  const row = { cause: legacy.cause, facts: { verdict: { cause: legacy.cause, confidence: legacy.confidence, conditions: [] } } };
  return verdictPhrase(readerVerdict(row.facts), row.cause);
}

describe("the v0.80.0 reader over a v4 article row", () => {
  it("a v4 article row prints a correct, hedged chip under the v0.80.0 reader for every (key, certainty)", () => {
    for (const key of KEYS) {
      for (const c of CERTAINTIES) {
        const out = chip(key, c);
        expect(TODAYS_WORDS.has(out), `${key}/${c} -> ${out}`).toBe(true);
        // an inferred cause is hedged or not stated at all; never stated as fact
        if (c === "inferred" || c === "unknown") expect(out === "Unknown" || out.startsWith("Likely "), `${key}/${c} -> ${out}`).toBe(true);
      }
    }
  });

  it("no output is a raw key such as \"Explosive Trap\"", () => {
    const outs = KEYS.flatMap((k) => CERTAINTIES.map((c) => chip(k, c)));
    for (const o of outs) {
      expect(o).not.toMatch(/Explosive|Trap|Tripwire|Land Mine|Logout|Respawn|Pneumonia|Heatstroke|Silicosis|Withheld|Awaiting/);
    }
  });
});
