import { describe, it, expect } from "vitest";
import { mayUpgradeCause } from "../src/backfill-death-causes.js";

// Pure: which stored cause the backfill may replace with what the parser says today.
describe("mayUpgradeCause", () => {
  it("upgrades a vague stored cause to a specific mechanism", () => {
    expect(mayUpgradeCause("environment", "wolf")).toBe(true);
    expect(mayUpgradeCause("environment", "explosion")).toBe(true);
    expect(mayUpgradeCause("died", "suicide")).toBe(true);
    expect(mayUpgradeCause("unknown", "fall")).toBe(true);
  });

  it("never rewrites a specific stored cause, and never moves between vague ones", () => {
    expect(mayUpgradeCause("wolf", "explosion")).toBe(false);
    expect(mayUpgradeCause("pvp", "explosion")).toBe(false);
    expect(mayUpgradeCause("environment", "died")).toBe(false);
    expect(mayUpgradeCause("environment", "environment")).toBe(false);
    expect(mayUpgradeCause(undefined, "wolf")).toBe(false);
  });

  // The backfill patches `cause` and `deathEntity` only. A stored death the parser now reads as a
  // player kill (a line whose killer carries `(DEAD)`) would become `pvp` with killer, weapon and
  // distance still null: a qualifying death — so a ban, and bans are durable — with no kills row.
  it("never upgrades anything to pvp", () => {
    for (const stored of ["environment", "died", "unknown"]) {
      expect(mayUpgradeCause(stored, "pvp")).toBe(false);
    }
  });
});
