import { describe, it, expect } from "vitest";
import { classifyDeath, type RecentHit } from "../src/death-verdict.js";

const infected: RecentHit = { attackerType: "infected", attackerLabel: "Infected", secondsBeforeDeath: 30 };
const playerHit: RecentHit = { attackerType: "player", attackerLabel: "PlayerName", secondsBeforeDeath: 45 };

describe("classifyDeath", () => {
  it("flaminx0r: starving suicide by blade, bleed is self-inflicted (not bled_out)", () => {
    const v = classifyDeath(
      { mechanism: "suicide", energy: 0, water: 620.083, bleedSources: 1, weapon: "StoneKnife" },
      [infected],
    );
    expect(v.cause).toBe("suicide");
    expect(v.conditions).toEqual(expect.arrayContaining(["starving", "hunted"]));
    expect(v.conditions).not.toContain("bleeding"); // side-effect subtracted
  });

  it("RonaldRaygun552: healthy suicide", () => {
    const v = classifyDeath(
      { mechanism: "suicide", energy: 469.478, water: 722.265, bleedSources: 3, weapon: "SteakKnife" },
      [],
    );
    expect(v.cause).toBe("suicide");
    expect(v.conditions).toEqual(["healthy"]);
  });

  it("plain died with Energy 0 and no recent combat => starvation (high)", () => {
    const v = classifyDeath({ mechanism: "died", energy: 0, water: 500, bleedSources: 0, weapon: null }, []);
    expect(v.cause).toBe("starvation");
    expect(v.confidence).toBe("high");
  });

  it("plain died, bleeding after infected hits => mauled", () => {
    const v = classifyDeath({ mechanism: "died", energy: 500, water: 500, bleedSources: 2, weapon: null }, [infected]);
    expect(v.cause).toBe("mauled");
    expect(v.conditions).toContain("bleeding");
  });

  it("PvP mechanism passes through", () => {
    const v = classifyDeath({ mechanism: "pvp", energy: null, water: null, bleedSources: null, weapon: "M4A1" }, []);
    expect(v.cause).toBe("pvp");
  });

  it("mechanism: drowned => environmental cause with high confidence", () => {
    const v = classifyDeath({ mechanism: "drowned", energy: 500, water: 500, bleedSources: 0, weapon: null }, []);
    expect(v.cause).toBe("environmental");
    expect(v.conditions).toContain("drowned");
    expect(v.confidence).toBe("high");
  });

  it("mechanism: environment (no recent hits) => environmental cause with high confidence", () => {
    const v = classifyDeath({ mechanism: "environment", energy: 500, water: 500, bleedSources: 0, weapon: null }, []);
    expect(v.cause).toBe("environmental");
    expect(v.confidence).toBe("high");
  });

  it("mechanism: environment with recent player hit => still high confidence (stated mechanism is high)", () => {
    const v = classifyDeath({ mechanism: "environment", energy: 500, water: 500, bleedSources: 0, weapon: null }, [playerHit]);
    expect(v.cause).toBe("environmental");
    expect(v.confidence).toBe("high");
  });

  it("plain died with water 0 and no hits => dehydration with high confidence", () => {
    const v = classifyDeath({ mechanism: "died", energy: 500, water: 0, bleedSources: 0, weapon: null }, []);
    expect(v.cause).toBe("dehydration");
    expect(v.confidence).toBe("high");
  });

  it("plain died with water 0 and recent hit => dehydration with low confidence (competing explanation)", () => {
    const v = classifyDeath({ mechanism: "died", energy: 500, water: 0, bleedSources: 0, weapon: null }, [playerHit]);
    expect(v.cause).toBe("dehydration");
    expect(v.confidence).toBe("low");
  });

  it("plain died with bleed sources and non-infected player hit => bled_out (not mauled), with bleeding condition", () => {
    const v = classifyDeath({ mechanism: "died", energy: 500, water: 500, bleedSources: 2, weapon: null }, [playerHit]);
    expect(v.cause).toBe("bled_out");
    expect(v.conditions).toContain("bleeding");
  });

  it("plain died with all vitals healthy/null and no hits => unknown cause with healthy conditions", () => {
    const v = classifyDeath({ mechanism: "died", energy: 500, water: 500, bleedSources: null, weapon: null }, []);
    expect(v.cause).toBe("unknown");
    expect(v.conditions).toEqual(["healthy"]);
  });

  it("recent-hit window: a hit older than 120s does not grade starvation down", () => {
    const old: RecentHit = { attackerType: "player", attackerLabel: null, secondsBeforeDeath: 300 };
    const v = classifyDeath({ mechanism: "died", energy: 0, water: 500, bleedSources: 0, weapon: null }, [old]);
    expect(v.cause).toBe("starvation");
    expect(v.confidence).toBe("high");
  });

  it("recent-hit window: a hit at exactly 120s IS recent and grades starvation down", () => {
    const boundary: RecentHit = { attackerType: "player", attackerLabel: null, secondsBeforeDeath: 120 };
    const v = classifyDeath({ mechanism: "died", energy: 0, water: 500, bleedSources: 0, weapon: null }, [boundary]);
    expect(v.cause).toBe("starvation");
    expect(v.confidence).toBe("low");
  });

  it("stage-2 entity mechanisms pass through at high confidence (wolf, healthy)", () => {
    const v = classifyDeath({ mechanism: "wolf", energy: 500, water: 500, bleedSources: 2, weapon: null }, []);
    expect(v.cause).toBe("wolf");
    expect(v.confidence).toBe("high");
    expect(v.conditions).toEqual(["healthy"]); // the wolf explains its own bleed — not "bleeding"
  });

  it("entity mechanism keeps real conditions (fall while starving)", () => {
    const v = classifyDeath({ mechanism: "fall", energy: 0, water: 500, bleedSources: 0, weapon: null }, []);
    expect(v.cause).toBe("fall");
    expect(v.conditions).toEqual(["starving"]);
  });
});
