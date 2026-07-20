import { describe, it, expect } from "vitest";
import { classifyDeath, causeFamily, type RecentHit } from "../src/death-verdict.js";

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

// Observed in production: RonaldRaygun552, Sakhal, 2026-07-20. The ADM recorded the fall as a
// separate hit line ("hit by FallDamageHealth" at HP 0) and the death line itself carried no
// killer clause — a bare "died." So the parser's FallDamage entity dict never fired, and the
// paper reported "no cause recorded" for a man who fell to his death in plain sight of the log.
describe("classifyDeath — a fall the death line did not name", () => {
  const fell = (over: Partial<RecentHit> = {}): RecentHit => ({
    attackerType: "environment", attackerLabel: "FallDamageHealth",
    secondsBeforeDeath: 0, victimHp: 0, ...over,
  });
  const bare = { mechanism: "died", energy: 1373, water: 672, bleedSources: 0, weapon: null };

  it("reads a terminal FallDamage hit as a fall", () => {
    const v = classifyDeath(bare, [fell()]);
    expect(v.cause).toBe("fall");
    expect(v.confidence).toBe("high");
  });

  // The fall is what killed him; being hungry at the time is background, not cause.
  it("keeps starvation as a condition rather than promoting it over the fall", () => {
    const v = classifyDeath({ ...bare, energy: 0 }, [fell()]);
    expect(v.cause).toBe("fall");
    expect(v.conditions).toContain("starving");
  });

  // A survivable fall followed by death from something else must not be blamed on the fall.
  it("ignores a non-terminal fall hit", () => {
    const v = classifyDeath({ ...bare, energy: 0 }, [fell({ victimHp: 74, secondsBeforeDeath: 90 })]);
    expect(v.cause).toBe("starvation");
  });

  // A stated mechanism still wins — inference only ever fills a gap.
  it("never overrides a stated mechanism", () => {
    expect(classifyDeath({ ...bare, mechanism: "pvp" }, [fell()]).cause).toBe("pvp");
  });

  // Suicide-by-falling is a stated mechanism and returns before the rung is ever reached.
  it("leaves a suicide by falling as a suicide", () => {
    expect(classifyDeath({ ...bare, mechanism: "suicide" }, [fell()]).cause).toBe("suicide");
  });

  // A hit line with no [HP:] token parses to null, and a pre-stage-2 caller omits the field
  // entirely. Neither is evidence of a terminal fall, so neither may claim one.
  it("treats a fall hit with unknown HP as no evidence", () => {
    expect(classifyDeath({ ...bare, energy: 0 }, [fell({ victimHp: null })]).cause).toBe("starvation");
    const { victimHp: _omitted, ...noHp } = fell();
    expect(classifyDeath({ ...bare, energy: 0 }, [noHp]).cause).toBe("starvation");
  });

  // The window is the same 120s every other inference uses.
  it("ignores a terminal fall hit older than the recent window", () => {
    expect(classifyDeath(bare, [fell({ secondsBeforeDeath: 121 })]).cause).toBe("unknown");
  });
});

describe("causeFamily", () => {
  it("groups the animal kingdom, passes everything else through", () => {
    expect(causeFamily("wolf")).toBe("animal");
    expect(causeFamily("bear")).toBe("animal");
    expect(causeFamily("animal")).toBe("animal");
    expect(causeFamily("pvp")).toBe("pvp");
    expect(causeFamily("fall")).toBe("fall");
    expect(causeFamily("died")).toBe("died");
  });
});
