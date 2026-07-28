import { describe, it, expect } from "vitest";
import { OBITUARY_SYSTEM } from "../src/voice.js";

// D5 regression guard: 89 of 123 birth notices and 8 obituaries reused an attribution string
// that appeared VERBATIM as an example in these prompts. No concrete attribution example may
// ever return — describe the register instead.
const SEEDED = [
  "a voice on the coast",
  "an old rival",
  "sources who have buried him before",
  "a rival",
  "sources on the coast",
  "reps for the deceased did not respond",
];

describe("system prompts carry no seeded attribution examples", () => {
  it("OBITUARY_SYSTEM quotes no concrete attribution", () => {
    for (const s of SEEDED) expect(OBITUARY_SYSTEM.toLowerCase()).not.toContain(s);
  });

  it("still states the anonymity rule for attributions", () => {
    expect(OBITUARY_SYSTEM).toMatch(/attribution/i);
    expect(OBITUARY_SYSTEM).toMatch(/anonymous/i);
  });
});

describe("system prompts carry the standing anti-repetition rule", () => {
  it("OBITUARY_SYSTEM forbids reusing a recent attribution", () => {
    expect(OBITUARY_SYSTEM).toMatch(/never reuse/i);
  });
});

describe("the no-building rule is stated in the prompt, not only enforced", () => {
  it("OBITUARY_SYSTEM forbids construction", () => {
    expect(OBITUARY_SYSTEM.toLowerCase()).toContain("no-build");
  });
});

describe("the No-Place Rule replaces the Fog Rule", () => {
  it("carries the No-Place Rule and has retired the Fog Rule", () => {
    expect(OBITUARY_SYSTEM).toContain("THE NO-PLACE RULE");
    expect(OBITUARY_SYSTEM).not.toContain("FOG RULE");
    expect(OBITUARY_SYSTEM).not.toMatch(/locale like/i); // no "a locale like Elektro" tag example
  });
});
