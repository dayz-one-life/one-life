import { describe, it, expect } from "vitest";
import { generateSequence, isExpired } from "../src/index.js";
import { safeVerificationEmotes } from "@onelife/domain";

// A deterministic seeded RNG (mulberry32) so tests are reproducible.
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("generateSequence", () => {
  const safeTokens = new Set(safeVerificationEmotes().map((e) => e.token));

  it("returns 3 distinct tokens by default, all from the safe set", () => {
    const seq = generateSequence(seeded(1));
    expect(seq).toHaveLength(3);
    expect(new Set(seq).size).toBe(3);
    for (const t of seq) expect(safeTokens.has(t)).toBe(true);
  });

  it("is deterministic for a given rng seed", () => {
    expect(generateSequence(seeded(42))).toEqual(generateSequence(seeded(42)));
  });

  it("honors a custom length", () => {
    expect(generateSequence(seeded(1), 5)).toHaveLength(5);
  });
});

describe("isExpired", () => {
  it("is true only after expiresAt", () => {
    const c = { expiresAt: new Date("2026-07-09T12:00:00Z") };
    expect(isExpired(c, new Date("2026-07-09T11:59:59Z"))).toBe(false);
    expect(isExpired(c, new Date("2026-07-09T12:00:01Z"))).toBe(true);
  });
});
