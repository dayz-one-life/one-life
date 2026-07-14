import { describe, it, expect } from "vitest";
import { parseHit } from "../src/index.js";

describe("parseHit", () => {
  it("parses infected hit with damage and hp", () => {
    const r = parseHit('17:31:59 | Player "Steveo12491" (id=D0= pos=<949.6, 7677.4, 181.0>)[HP: 98.5375] hit by Infected into LeftLeg(8) for 5.85 damage (MeleeInfected)');
    expect(r).toMatchObject({ victim: "Steveo12491", victimHp: 98.5375, attackerType: "infected", attackerGamertag: null, damage: 5.85, bodyPart: "LeftLeg" });
  });
  it("parses pvp hit", () => {
    const r = parseHit('10:00:00 | Player "A" (id=A=)[HP: 50] hit by Player "B" (id=B=) into Torso');
    expect(r).toMatchObject({ victim: "A", attackerType: "player", attackerGamertag: "B", bodyPart: "Torso" });
  });
  it("parses fall damage as environment", () => {
    const r = parseHit('15:54:09 | Player "T" (id=T= pos=<1,2,3>)[HP: 43.4025] hit by FallDamageHealth');
    expect(r).toMatchObject({ victim: "T", attackerType: "environment", attackerLabel: "FallDamageHealth" });
  });
  it("returns null for non-hit lines", () => {
    expect(parseHit('10:00:00 | Player "A" (id=A=) is connected')).toBeNull();
  });
  it("captures victim position", () => {
    const r = parseHit('12:00:00 | Player "V" (id=H= pos=<50, 60, 1>)[HP: 90] hit by Infected into Head(1) for 5 damage (MeleeInfected)');
    expect(r).toMatchObject({ victim: "V", x: 50, y: 60 });
  });
});
