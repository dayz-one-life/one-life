import { describe, it, expect } from "vitest";
import { classifyDeath } from "@onelife/domain";
import { conditions, toPublicDeath, type DeathContext } from "@onelife/death-verdict";
import { verdictPhrase } from "./fixtures/reader-v0.80.0.js";

/**
 * Suicide wording is unchanged (spec 7): the label the stored verdict prints equals what the site
 * printed before stage 4 — `verdictPhrase(classifyDeath(...))` — on the same inputs. It uses the old
 * code while it exists (step 10 deletes it). ⚠️ Invented numbers only.
 */
const T0 = 1_000_000;
type Case = { name: string; energy: number | null; water: number | null; infectedHitSecondsBefore: number | null };
const CASES: Case[] = [
  { name: "starving", energy: 0, water: 900, infectedHitSecondsBefore: null },
  { name: "dehydrated", energy: 900, water: 0, infectedHitSecondsBefore: null },
  { name: "hunted", energy: 900, water: 900, infectedHitSecondsBefore: 30 },
  { name: "healthy", energy: 900, water: 900, infectedHitSecondsBefore: null },
  { name: "starving, dehydrated and hunted", energy: 1, water: 1, infectedHitSecondsBefore: 120 },
  { name: "an infected hit outside the window is not hunted", energy: 900, water: 900, infectedHitSecondsBefore: 121 },
];

describe("suicide wording", () => {
  it.each(CASES)("the label equals verdictPhrase(classifyDeath(...)): $name", (c) => {
    const old = classifyDeath(
      { mechanism: "suicide", energy: c.energy, water: c.water, bleedSources: 0, weapon: null },
      c.infectedHitSecondsBefore == null ? [] : [{ attackerType: "infected", attackerLabel: "Infected", victimHp: 80, secondsBeforeDeath: c.infectedHitSecondsBefore }],
      [],
    );
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
    expect(stored.label).toBe(verdictPhrase(old, "suicide"));
  });
});
