import { describe, it, expect } from "vitest";
import {
  allClusters, buildDeathContext, classifyDeath, creditEvidence, DeathContext, inCreditScope, selectContextLines,
  type CreditEvidence, type InternalVerdict, type StampedLine,
} from "../src/index.js";
import { at, logFile, OTHER, stamped, T0, THIRD, VICTIM, who, type Who } from "./lines.js";

/**
 * The evidence half of the trap-kill bar on hand-built deaths. ⚠️ Every name, id, position and
 * line here is invented. The real trap deaths are checked by a private golden suite.
 *
 * The victim trips a wire at (1000, 2000) and a frag goes off four seconds later, or steps on a
 * mine there. What varies is what the log holds about who placed what, where and when.
 */
const V = (x = 1000, z = 2000) => who(VICTIM, at(x, z));
const D = (x = 1000, z = 2000) => who(VICTIM, at(x, z), true);
const wire = (p: Who, x: number, z = 2000) => `${who(p, at(x, z))} placed Tripwire<TripwireTrap>`;
const mine = (p: Who, x: number, z = 2000) => `${who(p, at(x, z))} placed Land Mine<LandMineTrap>`;
const trip = (p: Who, x: number, z = 2000) => `${who(p, at(x, z))}[HP: 100] hit by TripwireTrap into (-1) for 0 damage (TripWireHit)`;
const mineBlast = (p: Who, x: number, hp = 40, ammo = "LandMineExplosion_Ammo") => `${who(p, at(x, 2000))}[HP: ${hp}] hit by explosion (${ammo})`;
const TRIP_DEATH: [number, string][] = [
  [-300, `${V()} is connected`], [-4, trip(VICTIM, 1000)],
  [0, `${D()}[HP: 0] hit by explosion (M67Grenade_Ammo)`], [0, `${D()} killed by 6-M7 Frag Grenade`],
];
const MINE_DEATH: [number, string][] = [
  [-300, `${V()} is connected`], [0, `${D()}[HP: 0] hit by explosion (LandMineExplosion_Ammo)`], [0, `${D()} killed by LandMineTrap`],
];
const HOUR = 3600;

function contextOf(lines: StampedLine[], boots?: Map<number, number>): DeathContext {
  const clusters = allClusters(lines.filter((l) => l.subject?.id === VICTIM.id));
  return new DeathContext(lines, { serverId: 1, map: "chernarusplus", cluster: clusters[clusters.length - 1]!, prevDeaths: [] }, boots);
}
function verdictOf(entries: [number, string][]): InternalVerdict {
  return classifyDeath(contextOf(stamped([...entries].sort((a, b) => a[0] - b[0]))));
}
const creditOf = (before: [number, string][], death = TRIP_DEATH): CreditEvidence => verdictOf([...before, ...death]).evidence.credit!;

describe("the bar passes", () => {
  it("a sole placer 1.5 m from the anchor passes", () => {
    const c = creditOf([[-50 * HOUR, wire(OTHER, 1001.5)]]);
    expect(c).toEqual({
      outcome: "credited", refusedBy: null, placerDayzId: OTHER.id, placement: { admFileId: 7, lineIndex: 0 },
      distanceM: 1.5, ageHours: 50, boots: null, flags: [],
    });
  });

  it("a single placement plus only the fatal trip passes", () => {
    // the death's own detonation is not an earlier one
    const c = creditOf([[-2 * HOUR, wire(OTHER, 1001)]]);
    expect(c).toMatchObject({ outcome: "credited", refusedBy: null, flags: [] });
  });

  it("a mine death whose blast wrote two lines on the victim and one on a bystander passes", () => {
    const c = creditOf([[-20 * HOUR, mine(OTHER, 1001)]], [
      [-300, `${V()} is connected`],
      [-1, mineBlast(VICTIM, 1000, 5, "LandMineExplosion")], [0, `${D()}[HP: 0] hit by explosion (LandMineExplosion)`],
      [0, mineBlast(THIRD, 1003, 60, "LandMineExplosion")], [0, `${D()} killed by LandMineTrap`],
    ]);
    expect(c).toMatchObject({ outcome: "credited", refusedBy: null, placerDayzId: OTHER.id, distanceM: 1, ageHours: 20 });
    expect(c.flags).toEqual(["others_present"]);
  });

  it("a claymore on a tripped wire is in scope like a frag", () => {
    const c = creditOf([[-HOUR, wire(OTHER, 1002)]], [
      [-300, `${V()} is connected`], [0, trip(VICTIM, 1000)],
      [0, `${D()}[HP: 0] hit by explosion (ClaymoreMine_Ammo)`], [0, `${D()} killed by Claymore`],
    ]);
    expect(c).toMatchObject({ outcome: "credited", placerDayzId: OTHER.id, distanceM: 2 });
  });

  it("the anchor is where the victim tripped the wire, not where they died", () => {
    // the victim ran 12 m in the four seconds of the fuse: the wire is by the trip line
    const death: [number, string][] = [
      [-300, `${V(1012)} is connected`], [-4, trip(VICTIM, 1000)],
      [0, `${D(1012)}[HP: 0] hit by explosion (M67Grenade_Ammo)`], [0, `${D(1012)} killed by 6-M7 Frag Grenade`],
    ];
    expect(creditOf([[-HOUR, wire(OTHER, 1001)]], death)).toMatchObject({ outcome: "credited", distanceM: 1 });
    expect(creditOf([[-HOUR, wire(OTHER, 1011)]], death)).toMatchObject({ outcome: "refused", refusedBy: 2, placerDayzId: null });
  });

  it("the anchor is the trip the fuse started at, not a second wire walked into afterwards", () => {
    const death: [number, string][] = [
      [-300, `${V()} is connected`], [-4, trip(VICTIM, 1000)], [-1, trip(VICTIM, 1030)],
      [0, `${D(1030)}[HP: 0] hit by explosion (M67Grenade_Ammo)`], [0, `${D(1030)} killed by 6-M7 Frag Grenade`],
    ];
    expect(creditOf([[-HOUR, wire(OTHER, 1001)]], death)).toMatchObject({ outcome: "credited", placerDayzId: OTHER.id, distanceM: 1 });
  });

  it("exactly 5.0 m is a candidate and 5.1 m is not", () => {
    expect(creditOf([[-HOUR, wire(OTHER, 1005)]])).toMatchObject({ outcome: "credited", distanceM: 5 });
    expect(creditOf([[-HOUR, wire(OTHER, 1005.1)]])).toMatchObject({ outcome: "refused", refusedBy: 2, placement: null });
  });
});

describe("the bar refuses, by the first test that fails", () => {
  it("two placers within 5 m is refused by test 2", () => {
    const c = creditOf([[-9 * HOUR, wire(OTHER, 1001)], [-8 * HOUR, wire(THIRD, 1003)]]);
    expect(c).toMatchObject({ outcome: "refused", refusedBy: 2, placerDayzId: null, distanceM: 1 });
  });

  it("the victim's own placement is refused by test 4", () => {
    const c = creditOf([[-9 * HOUR, wire(VICTIM, 1001)]]);
    expect(c).toMatchObject({ outcome: "refused", refusedBy: 4, placerDayzId: VICTIM.id });
  });

  it("the victim and another player both within 5 m is refused by test 2", () => {
    const c = creditOf([[-9 * HOUR, wire(VICTIM, 1001)], [-8 * HOUR, wire(OTHER, 1002)]]);
    expect(c).toMatchObject({ outcome: "refused", refusedBy: 2 });
  });

  it("another player's untripped wire 12 m away is refused by test 3", () => {
    const c = creditOf([[-9 * HOUR, wire(OTHER, 1001)], [-8 * HOUR, wire(THIRD, 1012)]]);
    expect(c).toMatchObject({ outcome: "refused", refusedBy: 3, placerDayzId: OTHER.id });
  });

  it("the same wire already tripped at its own spot is not", () => {
    const c = creditOf([[-9 * HOUR, wire(OTHER, 1001)], [-8 * HOUR, wire(THIRD, 1012)], [-7 * HOUR, trip(THIRD, 1013)]]);
    expect(c).toMatchObject({ outcome: "credited", refusedBy: null, placerDayzId: OTHER.id });
    expect(c.flags).toEqual(["neighbour_spent"]);
  });

  it("a neighbour who re-placed after the trip refuses again", () => {
    const c = creditOf([
      [-9 * HOUR, wire(OTHER, 1001)], [-8 * HOUR, wire(THIRD, 1012)], [-7 * HOUR, trip(THIRD, 1013)], [-6 * HOUR, wire(THIRD, 1012.5)],
    ]);
    expect(c).toMatchObject({ outcome: "refused", refusedBy: 3 });
  });

  it("a neighbour's wire 15.1 m away, or a neighbour's mine near a wire, is outside the ring", () => {
    expect(creditOf([[-9 * HOUR, wire(OTHER, 1001)], [-8 * HOUR, wire(THIRD, 1015.1)]])).toMatchObject({ outcome: "credited" });
    expect(creditOf([[-9 * HOUR, wire(OTHER, 1001)], [-8 * HOUR, mine(THIRD, 1008)]])).toMatchObject({ outcome: "credited" });
  });

  it("a trip 6 m from a neighbour's wire does not spend it", () => {
    const c = creditOf([[-9 * HOUR, wire(OTHER, 1001)], [-8 * HOUR, wire(THIRD, 1012)], [-7 * HOUR, trip(THIRD, 1018.5)]]);
    expect(c).toMatchObject({ outcome: "refused", refusedBy: 3 });
  });

  it("three placement lines then a harmless trip by a passer-by is refused by test 5", () => {
    const c = creditOf([
      [-900 * HOUR, wire(OTHER, 1001)], [-900 * HOUR + 60, wire(OTHER, 1001.2)], [-900 * HOUR + 120, wire(OTHER, 1000.8)],
      [-100 * HOUR, trip(THIRD, 1000.5)],
    ]);
    expect(c).toMatchObject({ outcome: "refused", refusedBy: 5, placerDayzId: OTHER.id });
    expect(c.flags).toEqual(["placement_past_lifetime", "repeat_placement_lines"]);
  });

  it("place, trip, place again passes with flag earlier_detonation", () => {
    const c = creditOf([[-9 * HOUR, wire(OTHER, 1001)], [-8 * HOUR, trip(OTHER, 1000.5)], [-7 * HOUR, wire(OTHER, 1002)]]);
    expect(c).toMatchObject({ outcome: "credited", refusedBy: null, placerDayzId: OTHER.id });
    expect(c.flags).toEqual(["earlier_detonation", "repeat_placement_lines"]);
    // the placement named is the live one, not the nearest
    expect(c).toMatchObject({ placement: { admFileId: 7, lineIndex: 2 }, distanceM: 2, ageHours: 7 });
  });

  it("an earlier mine blast written as LandMineExplosion_Ammo on one line counts as a detonation", () => {
    const c = creditOf([[-9 * HOUR, mine(OTHER, 1001)], [-8 * HOUR, mineBlast(THIRD, 1001.5)]], MINE_DEATH);
    expect(c).toMatchObject({ outcome: "refused", refusedBy: 5 });
    const old = creditOf([[-9 * HOUR, mine(OTHER, 1001)], [-8 * HOUR, mineBlast(THIRD, 1001.5, 40, "LandMineExplosion")]], MINE_DEATH);
    expect(old).toMatchObject({ outcome: "refused", refusedBy: 5 });
    // a grenade going off there is not a mine going off
    const frag = creditOf([[-9 * HOUR, mine(OTHER, 1001)], [-8 * HOUR, mineBlast(THIRD, 1001.5, 40, "M67Grenade_Ammo")]], MINE_DEATH);
    expect(frag).toMatchObject({ outcome: "credited" });
  });

  it("a mine blast three seconds before the kill line is an earlier detonation; two seconds before is the death's own", () => {
    const three = creditOf([[-9 * HOUR, mine(OTHER, 1001)], [-3, mineBlast(THIRD, 1002)]], MINE_DEATH);
    expect(three).toMatchObject({ outcome: "refused", refusedBy: 5 });
    const two = creditOf([[-9 * HOUR, mine(OTHER, 1001)], [-2, mineBlast(THIRD, 1002)]], MINE_DEATH);
    expect(two).toMatchObject({ outcome: "credited" });
  });

  it("a detonation from before the placement does not count against it", () => {
    const c = creditOf([[-10 * HOUR, wire(THIRD, 1030)], [-9 * HOUR, trip(THIRD, 1000.5)], [-8 * HOUR, wire(OTHER, 1001)]]);
    expect(c).toMatchObject({ outcome: "credited", flags: [] });
  });
});

describe("scope, wipes and what never changes", () => {
  it("a placement before a recorded wipe is not a candidate", () => {
    const ctx = contextOf(stamped([[-50 * HOUR, wire(OTHER, 1001)], ...TRIP_DEATH]));
    const v = classifyDeath(ctx);
    const wipe = (dtHours: number) => ({ 1: [new Date((T0 + dtHours * HOUR) * 1000).toISOString()] });
    expect(creditEvidence(ctx, v, { wipes: wipe(-40) })).toMatchObject({ outcome: "refused", refusedBy: 2, placement: null });
    expect(creditEvidence(ctx, v, { wipes: wipe(-60) })).toMatchObject({ outcome: "credited" });
    // a wipe of another server, or one after the death, changes nothing
    expect(creditEvidence(ctx, v, { wipes: { 2: wipe(-40)[1] } })).toMatchObject({ outcome: "credited" });
    expect(creditEvidence(ctx, v, { wipes: wipe(1) })).toMatchObject({ outcome: "credited" });
  });

  it("a wiped neighbour no longer refuses", () => {
    const ctx = contextOf(stamped([[-50 * HOUR, wire(THIRD, 1012)], [-9 * HOUR, wire(OTHER, 1001)], ...TRIP_DEATH]));
    const v = classifyDeath(ctx);
    expect(creditEvidence(ctx, v)).toMatchObject({ refusedBy: 3 });
    expect(creditEvidence(ctx, v, { wipes: { 1: [new Date((T0 - 20 * HOUR) * 1000).toISOString()] } })).toMatchObject({ outcome: "credited" });
  });

  it("no anchor is not_applicable", () => {
    // a mine death whose kill line carries no readable position
    const lines = stamped([[-9 * HOUR, mine(OTHER, 1001)], [-300, `${V()} is connected`],
      [0, `Player "${VICTIM.name}" (DEAD) (id=${VICTIM.id} pos=<0, 0>) killed by LandMineTrap`]]);
    const v = classifyDeath(contextOf(lines));
    expect(v.rule).toBe("A09");
    expect(v.evidence.credit).toEqual({
      outcome: "not_applicable", refusedBy: null, placerDayzId: null, placement: null, distanceM: null, ageHours: null, boots: null, flags: [],
    });
  });

  it("a claymore with no trip line and a plastic explosive are not_applicable", () => {
    const clay = contextOf(stamped([[-HOUR, wire(OTHER, 1001)], [-300, `${V()} is connected`], [0, `${D()} killed by Claymore`]]));
    const plastic = contextOf(stamped([[-600, `${who(OTHER, at(1004, 2000))} placed Plastic Explosive<Plastic_Explosive>`], [0, `${D()} killed by Plastic Explosive`]]));
    for (const ctx of [clay, plastic]) {
      const v = classifyDeath(ctx);
      expect(inCreditScope(v)).toBe(false);
      expect(creditEvidence(ctx, v).outcome).toBe("not_applicable");
      expect(v.evidence.credit).toBeNull();
    }
  });

  it("only the three trap rules are in scope, and only at definitive or strong", () => {
    const ctx = contextOf(stamped([[-50 * HOUR, wire(OTHER, 1001)], ...TRIP_DEATH]));
    expect(creditEvidence(ctx, { rule: "A07", cause: "explosive_trap", confidence: "inferred" }).outcome).toBe("not_applicable");
    expect(creditEvidence(ctx, { rule: "A08", cause: "explosive_grenade", confidence: "definitive" }).outcome).toBe("not_applicable");
    expect(creditEvidence(ctx, { rule: "A07", cause: "explosive_grenade", confidence: "definitive" }).outcome).toBe("not_applicable");
    expect(creditEvidence(ctx, { rule: "A07", cause: "explosive_trap", confidence: "strong" }).outcome).toBe("credited");
  });

  it("the result never changes cause, confidence or attribution", () => {
    for (const before of [
      [[-50 * HOUR, wire(OTHER, 1001)]],
      [[-9 * HOUR, wire(OTHER, 1001)], [-8 * HOUR, wire(THIRD, 1003)]],
      [[-9 * HOUR, wire(VICTIM, 1001)]],
      [],
    ] as [number, string][][]) {
      const ctx = contextOf(stamped([...before, ...TRIP_DEATH]));
      const v = classifyDeath(ctx);
      const frozen = JSON.stringify({ ...v, evidence: { ...v.evidence, credit: null } });
      const credit = creditEvidence(ctx, v);
      expect(JSON.stringify({ ...v, evidence: { ...v.evidence, credit: null } })).toBe(frozen);
      expect(credit).toEqual(v.evidence.credit);
      expect(v).toMatchObject({ rule: "A07", cause: "explosive_trap", confidence: "definitive" });
    }
    // refused by two placers: the nearest is still the stored attribution, inferred, for the operator
    const two = verdictOf([[-9 * HOUR, wire(OTHER, 1001)], [-8 * HOUR, wire(THIRD, 1003)], ...TRIP_DEATH]);
    expect(two.attribution).toMatchObject({ role: "trap_owner", basis: "placement", dayzId: OTHER.id, confidence: "inferred" });
    expect(two.evidence.credit).toMatchObject({ refusedBy: 2, placerDayzId: null });
  });

  it("flags: a placement past the device's lifetime and other players present", () => {
    const c = creditOf([[-169 * HOUR, wire(OTHER, 1001)], [-200, who(THIRD, at(1040, 2000))]]);
    expect(c).toMatchObject({ outcome: "credited", ageHours: 169 });
    expect(c.flags).toEqual(["others_present", "placement_past_lifetime"]);
    expect(creditOf([[-168 * HOUR, wire(OTHER, 1001)], [-200, who(THIRD, at(1051, 2000))]]).flags).toEqual([]);
  });
});

describe("boots between the placement and the death", () => {
  const files = [
    logFile(11, "2031-03-08", "10:00:00", [["10:05:00", wire(OTHER, 1001)]]),
    logFile(12, "2031-03-08", "14:00:00", [["14:05:00", who(THIRD, at(5000, 5000))]]),
    logFile(13, "2031-03-09", "09:00:00", [["09:05:00", who(THIRD, at(5000, 5000))]]),
    logFile(14, "2031-03-10", "11:00:00", [
      ["11:55:00", `${V()} is connected`], ["11:59:56", trip(VICTIM, 1000)],
      ["12:00:00", `${D()}[HP: 0] hit by explosion (M67Grenade_Ammo)`], ["12:00:00", `${D()} killed by 6-M7 Frag Grenade`],
    ]),
  ];
  const corpus = { serverId: 3, map: "enoch", files };
  const seed = { admFileId: 14, lineIndex: 5 };

  it("counts the server's restarts, including the files the selection left out", () => {
    const input = selectContextLines(corpus, seed);
    expect(input.files.map((f) => [f.admFileId, f.boot])).toEqual([[11, 0], [14, 3]]);
    const c = classifyDeath(buildDeathContext(input)).evidence.credit!;
    expect(c).toMatchObject({ outcome: "credited", placerDayzId: OTHER.id, boots: 3, placement: { admFileId: 11, lineIndex: 2 } });
  });

  it("uses the caller's numbering when the corpus is only part of the log, and is null when a file has none", () => {
    const numbered = selectContextLines(corpus, seed, [], { bootOrdinals: new Map([[11, 40], [14, 163]]) });
    expect(classifyDeath(buildDeathContext(numbered)).evidence.credit!.boots).toBe(123);
    const partial = selectContextLines(corpus, seed, [], { bootOrdinals: new Map([[14, 163]]) });
    expect(classifyDeath(buildDeathContext(partial)).evidence.credit).toMatchObject({ outcome: "credited", boots: null });
  });
});
