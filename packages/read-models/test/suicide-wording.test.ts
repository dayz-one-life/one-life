import { describe, it, expect } from "vitest";
import { conditions, toPublicDeath, type DeathContext } from "@onelife/death-verdict";

/**
 * Suicide wording is unchanged (spec 7): the label the stored verdict prints equals what the site
 * printed before stage 4 on the same inputs. `expected` is what the old code
 * (`verdictPhrase(classifyDeath(...))`, deleted in step 10) printed for each case, recorded from it
 * before the deletion. ⚠️ Invented numbers only.
 */
const T0 = 1_000_000;
type Case = { name: string; energy: number | null; water: number | null; infectedHitSecondsBefore: number | null; expected: string };
const CASES: Case[] = [
  { name: "starving", energy: 0, water: 900, infectedHitSecondsBefore: null, expected: "Suicide (starving)" },
  { name: "dehydrated", energy: 900, water: 0, infectedHitSecondsBefore: null, expected: "Suicide (dehydrated)" },
  { name: "hunted", energy: 900, water: 900, infectedHitSecondsBefore: 30, expected: "Suicide (hunted)" },
  { name: "healthy", energy: 900, water: 900, infectedHitSecondsBefore: null, expected: "Suicide (in good health)" },
  { name: "starving, dehydrated and hunted", energy: 1, water: 1, infectedHitSecondsBefore: 120, expected: "Suicide (starving, dehydrated, hunted)" },
  { name: "an infected hit outside the window is not hunted", energy: 900, water: 900, infectedHitSecondsBefore: 121, expected: "Suicide (in good health)" },
];

describe("suicide wording", () => {
  it.each(CASES)("the label equals the pre-stage-4 label: $name", (c) => {
    // The sweep's conditions, from the same facts (only the fields `conditions` reads).
    const ctx = {
      stats: { energy: c.energy, water: c.water }, t0: T0,
      hits: c.infectedHitSecondsBefore == null ? [] : [{ cat: "infected", ts: T0 - c.infectedHitSecondsBefore }],
    } as unknown as DeathContext;
    const stored = toPublicDeath(
      { cause: "suicide", confidence: "definitive", mechanismStated: true, objectKey: null, upstream: null, attrBasis: "kill_line_self",
        ownerlessFirearm: false, conditions: conditions(ctx) },
      { deathCause: "suicide", deathByGamertag: null, deathWeapon: null, deathDistance: null },
    );
    expect(stored.label).toBe(c.expected);
  });
});
