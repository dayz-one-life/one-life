import { describe, it, expect } from "vitest";
import { parseDeath } from "../src/index.js";

describe("parseDeath", () => {
  it("parses pvp with weapon and distance", () => {
    expect(parseDeath('10:00:00 | Player "Victim" (DEAD) (id=V=) killed by Player "Killer" (id=K=) with M4A1 from 153.4 meters'))
      .toEqual({ victim: "Victim", dayzId: "V=", cause: "pvp", killer: "Killer", weapon: "M4A1", distance: 153.4, energy: null, water: null, bleedSources: null, deathEntity: null });
  });
  it("parses pvp melee (no distance)", () => {
    const r = parseDeath('10:00:00 | Player "Victim" (DEAD) (id=V=) killed by Player "Killer" (id=K=) with Knife');
    expect(r).toMatchObject({ cause: "pvp", weapon: "Knife", distance: null, energy: null, water: null, bleedSources: null, deathEntity: null });
  });
  it("classifies environment causes", () => {
    expect(parseDeath('10:00:00 | Player "A" (DEAD) (id=A=) bled out')?.cause).toBe("bled_out");
    expect(parseDeath('10:00:00 | Player "A" (DEAD) (id=A=) drowned')?.cause).toBe("drowned");
    expect(parseDeath('10:00:00 | Player "A" (DEAD) (id=A=) committed suicide')?.cause).toBe("suicide");
    expect(parseDeath('10:00:00 | Player "A" (DEAD) (id=A=) killed by FallDamage')?.cause).toBe("fall");
    expect(parseDeath('10:00:00 | Player "A" (DEAD) (id=A=) died.')?.cause).toBe("died");
  });
  it("ignores hit-by damage lines", () => {
    expect(parseDeath('10:00:00 | Player "A" (id=A=)[HP: 50] hit by Player "B" (id=B=) into Torso')).toBeNull();
  });
});

describe("parseDeath — stats + precision", () => {
  const suicide = `Player "flaminx0r" (DEAD) (id=875FAED7 pos=<13446.2, 12250.6, 2.5>) died. Stats> Water: 620.083 Energy: 0 Bleed sources: 1`;
  const rosterDead = `Player "flaminx0r" (DEAD) (id=875FAED7 pos=<13446.2, 12250.6, 2.5>)`;
  const committed = `Player "flaminx0r" (DEAD) (id=875FAED7 pos=<13446.2, 12250.6, 2.5>) committed suicide`;

  it("captures Water/Energy/Bleed off the died. Stats> line", () => {
    const d = parseDeath(suicide)!;
    expect(d.cause).toBe("died");
    expect(d.water).toBeCloseTo(620.083);
    expect(d.energy).toBe(0);
    expect(d.bleedSources).toBe(1);
  });

  it("treats a bare (DEAD) marker with no death verb as NOT a death", () => {
    expect(parseDeath(rosterDead)).toBeNull();
  });

  it("still parses the committed-suicide line (no stats present)", () => {
    const d = parseDeath(committed)!;
    expect(d.cause).toBe("suicide");
    expect(d.energy).toBeNull();
  });

  it("PvP death is unaffected and carries null stats", () => {
    const pvp = `Player "A" (DEAD) (id=1) killed by Player "B" (id=2) with M4A1 from 42 meters`;
    const d = parseDeath(pvp)!;
    expect(d.cause).toBe("pvp");
    expect(d.killer).toBe("B");
    expect(d.energy).toBeNull();
  });
});

describe("parseDeath — named non-player killers (stage 2)", () => {
  const line = (killer: string) => `10:00:00 | Player "A" (DEAD) (id=A= pos=<1.0, 2.0, 3.0>) killed by ${killer}`;

  it("maps wolf, bear, other animals, infected, and falls to first-class causes", () => {
    expect(parseDeath(line("Animal_CanisLupus"))).toMatchObject({ cause: "wolf", deathEntity: "Animal_CanisLupus" });
    expect(parseDeath(line("Animal_UrsusArctos"))).toMatchObject({ cause: "bear", deathEntity: "Animal_UrsusArctos" });
    expect(parseDeath(line("Animal_GallusGallusDomesticus"))).toMatchObject({ cause: "animal", deathEntity: "Animal_GallusGallusDomesticus" });
    expect(parseDeath(line("ZmbM_CitizenASkater_Blue"))).toMatchObject({ cause: "infected", deathEntity: "ZmbM_CitizenASkater_Blue" });
    expect(parseDeath(line("FallDamage"))).toMatchObject({ cause: "fall", deathEntity: "FallDamage" });
  });

  it("an unmapped entity stays environment but keeps the entity for the survey", () => {
    expect(parseDeath(line("BarbedWireKit"))).toMatchObject({ cause: "environment", deathEntity: "BarbedWireKit" });
  });

  it("pvp and verb-only deaths carry a null deathEntity", () => {
    expect(parseDeath('10:00:00 | Player "V" (DEAD) (id=V=) killed by Player "K" (id=K=) with M4A1 from 10 meters')?.deathEntity).toBeNull();
    expect(parseDeath('10:00:00 | Player "A" (DEAD) (id=A=) died.')?.deathEntity).toBeNull();
    expect(parseDeath('10:00:00 | Player "A" (DEAD) (id=A=) bled out')?.deathEntity).toBeNull();
  });
});
