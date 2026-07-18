import { describe, it, expect } from "vitest";
import { OBITUARY_SYSTEM } from "../src/voice.js";
import { BIRTH_SYSTEM } from "../src/birth-voice.js";

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

  it("BIRTH_SYSTEM quotes no concrete attribution", () => {
    for (const s of SEEDED) expect(BIRTH_SYSTEM.toLowerCase()).not.toContain(s);
  });

  it("both still state the anonymity rule for attributions", () => {
    expect(OBITUARY_SYSTEM).toMatch(/attribution/i);
    expect(OBITUARY_SYSTEM).toMatch(/anonymous/i);
    expect(BIRTH_SYSTEM).toMatch(/attribution/i);
    expect(BIRTH_SYSTEM).toMatch(/anonymous/i);
  });
});

describe("system prompts carry the standing anti-repetition rule", () => {
  it("OBITUARY_SYSTEM forbids reusing a recent attribution", () => {
    expect(OBITUARY_SYSTEM).toMatch(/never reuse/i);
  });
  it("BIRTH_SYSTEM forbids reusing a recent attribution", () => {
    expect(BIRTH_SYSTEM).toMatch(/never reuse/i);
  });
});
