import { describe, it, expect } from "vitest";
import { parseDeath } from "../src/index.js";

describe("parseDeath", () => {
  it("parses pvp with weapon and distance", () => {
    expect(parseDeath('10:00:00 | Player "Victim" (DEAD) (id=V=) killed by Player "Killer" (id=K=) with M4A1 from 153.4 meters'))
      .toEqual({ victim: "Victim", dayzId: "V=", cause: "pvp", killer: "Killer", weapon: "M4A1", distance: 153.4, energy: null, water: null, bleedSources: null });
  });
  it("parses pvp melee (no distance)", () => {
    const r = parseDeath('10:00:00 | Player "Victim" (DEAD) (id=V=) killed by Player "Killer" (id=K=) with Knife');
    expect(r).toMatchObject({ cause: "pvp", weapon: "Knife", distance: null, energy: null, water: null, bleedSources: null });
  });
  it("classifies environment causes", () => {
    expect(parseDeath('10:00:00 | Player "A" (DEAD) (id=A=) bled out')?.cause).toBe("bled_out");
    expect(parseDeath('10:00:00 | Player "A" (DEAD) (id=A=) drowned')?.cause).toBe("drowned");
    expect(parseDeath('10:00:00 | Player "A" (DEAD) (id=A=) committed suicide')?.cause).toBe("suicide");
    expect(parseDeath('10:00:00 | Player "A" (DEAD) (id=A=) killed by FallDamage')?.cause).toBe("environment");
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
