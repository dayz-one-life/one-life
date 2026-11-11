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
      outcome: "evidence_passes", refusedBy: null, placerDayzId: OTHER.id, placement: { admFileId: 7, lineIndex: 0 },
      distanceM: 1.5, ageHours: 50, boots: null, flags: [],
    });
  });

  it("a single placement plus only the fatal trip passes", () => {
    // the death's own detonation is not an earlier one
    const c = creditOf([[-2 * HOUR, wire(OTHER, 1001)]]);
    expect(c).toMatchObject({ outcome: "evidence_passes", refusedBy: null, flags: [] });
  });

  it("a mine death whose blast wrote two lines on the victim and one on a bystander passes", () => {
    const c = creditOf([[-20 * HOUR, mine(OTHER, 1001)]], [
      [-300, `${V()} is connected`],
      [-1, mineBlast(VICTIM, 1000, 5, "LandMineExplosion")], [0, `${D()}[HP: 0] hit by explosion (LandMineExplosion)`],
      [0, mineBlast(THIRD, 1003, 60, "LandMineExplosion")], [0, `${D()} killed by LandMineTrap`],
    ]);
    expect(c).toMatchObject({ outcome: "evidence_passes", refusedBy: null, placerDayzId: OTHER.id, distanceM: 1, ageHours: 20 });
    expect(c.flags).toEqual(["others_present"]);
  });

  it("a claymore on a tripped wire is in scope like a frag", () => {
    const c = creditOf([[-HOUR, wire(OTHER, 1002)]], [
      [-300, `${V()} is connected`], [0, trip(VICTIM, 1000)],
      [0, `${D()}[HP: 0] hit by explosion (ClaymoreMine_Ammo)`], [0, `${D()} killed by Claymore`],
    ]);
    expect(c).toMatchObject({ outcome: "evidence_passes", placerDayzId: OTHER.id, distanceM: 2 });
  });

  it("the anchor is where the victim tripped the wire, not where they died", () => {
    // the victim ran 12 m in the four seconds of the fuse: the wire is by the trip line
    const death: [number, string][] = [
      [-300, `${V(1012)} is connected`], [-4, trip(VICTIM, 1000)],
      [0, `${D(1012)}[HP: 0] hit by explosion (M67Grenade_Ammo)`], [0, `${D(1012)} killed by 6-M7 Frag Grenade`],
    ];
    expect(creditOf([[-HOUR, wire(OTHER, 1001)]], death)).toMatchObject({ outcome: "evidence_passes", distanceM: 1 });
    expect(creditOf([[-HOUR, wire(OTHER, 1011)]], death)).toMatchObject({ outcome: "refused", refusedBy: 2, placerDayzId: null });
  });

  it("the anchor is the trip the fuse started at, not a second wire walked into afterwards — and two wires in six seconds is refused", () => {
    const death: [number, string][] = [
      [-300, `${V()} is connected`], [-4, trip(VICTIM, 1000)], [-1, trip(VICTIM, 1030)],
      [0, `${D(1030)}[HP: 0] hit by explosion (M67Grenade_Ammo)`], [0, `${D(1030)} killed by 6-M7 Frag Grenade`],
    ];
    const c = creditOf([[-HOUR, wire(OTHER, 1001)]], death);
    // the placement named is the one by the 4 s trip, 1 m from it
    expect(c).toMatchObject({ outcome: "refused", refusedBy: 2, placerDayzId: null, distanceM: 1 });
    expect(c.flags).toEqual(["ambiguous_trip"]);
  });

  it("exactly 5.0 m is a candidate and 5.1 m is not", () => {
    expect(creditOf([[-HOUR, wire(OTHER, 1005)]])).toMatchObject({ outcome: "evidence_passes", distanceM: 5 });
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
    expect(c).toMatchObject({ outcome: "evidence_passes", refusedBy: null, placerDayzId: OTHER.id });
    expect(c.flags).toEqual(["neighbour_spent"]);
  });

  it("a neighbour who re-placed after the trip refuses again", () => {
    const c = creditOf([
      [-9 * HOUR, wire(OTHER, 1001)], [-8 * HOUR, wire(THIRD, 1012)], [-7 * HOUR, trip(THIRD, 1013)], [-6 * HOUR, wire(THIRD, 1012.5)],
    ]);
    expect(c).toMatchObject({ outcome: "refused", refusedBy: 3 });
  });

  it("a neighbour who re-placed just outside the ring, within 5 m of the tripped wire, refuses again", () => {
    // the spent wire is 13 m from the anchor; its replacement 17 m: outside the ring, but the same spot re-armed
    const before: [number, string][] = [[-9 * HOUR, wire(OTHER, 1001)], [-8 * HOUR, wire(THIRD, 1013)], [-7 * HOUR, trip(THIRD, 1013)]];
    expect(creditOf(before)).toMatchObject({ outcome: "evidence_passes", flags: ["neighbour_spent"] });
    expect(creditOf([...before, [-6 * HOUR, wire(THIRD, 1017)]])).toMatchObject({ outcome: "refused", refusedBy: 3 });
    // 5.1 m from the tripped wire is another spot, and outside the ring: it does not count
    expect(creditOf([...before, [-6 * HOUR, wire(THIRD, 1018.1)]])).toMatchObject({ outcome: "evidence_passes" });
    // a replacement from BEFORE the trip was tripped with it
    expect(creditOf([[-9 * HOUR, wire(OTHER, 1001)], [-8 * HOUR, wire(THIRD, 1013)], [-7.5 * HOUR, wire(THIRD, 1017)], [-7 * HOUR, trip(THIRD, 1013)]]))
      .toMatchObject({ outcome: "evidence_passes" });
  });

  it("a neighbour's wire 15.1 m away, or a neighbour's mine near a wire, is outside the ring", () => {
    expect(creditOf([[-9 * HOUR, wire(OTHER, 1001)], [-8 * HOUR, wire(THIRD, 1015.1)]])).toMatchObject({ outcome: "evidence_passes" });
    expect(creditOf([[-9 * HOUR, wire(OTHER, 1001)], [-8 * HOUR, mine(THIRD, 1008)]])).toMatchObject({ outcome: "evidence_passes" });
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
    expect(c).toMatchObject({ outcome: "evidence_passes", refusedBy: null, placerDayzId: OTHER.id });
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
    expect(frag).toMatchObject({ outcome: "evidence_passes" });
  });

  it("a mine blast on the victim in the two seconds before the kill line is the death's own; three seconds before is not", () => {
    const three = creditOf([[-9 * HOUR, mine(OTHER, 1001)], [-3, mineBlast(VICTIM, 1000)]], MINE_DEATH);
    expect(three).toMatchObject({ outcome: "refused", refusedBy: 5 });
    const two = creditOf([[-9 * HOUR, mine(OTHER, 1001)], [-2, mineBlast(VICTIM, 1000)]], MINE_DEATH);
    expect(two).toMatchObject({ outcome: "evidence_passes" });
  });

  it("a mine blast on someone else in an earlier second is an earlier detonation; in the death second it is the death's own", () => {
    for (const dt of [-2, -1]) {
      const earlier = creditOf([[-9 * HOUR, mine(OTHER, 1001)], [dt, mineBlast(THIRD, 1002)]], MINE_DEATH);
      expect(earlier).toMatchObject({ outcome: "refused", refusedBy: 5 });
    }
    const same = creditOf([[-9 * HOUR, mine(OTHER, 1001)], [0, mineBlast(THIRD, 1002)]], MINE_DEATH);
    expect(same).toMatchObject({ outcome: "evidence_passes" });
  });

  it("another player's mine death at the same spot two seconds earlier: one placement line does not yield two kills", () => {
    const first: [number, string][] = [
      [-2, `${who(THIRD, at(1000.5, 2000), true)}[HP: 0] hit by explosion (LandMineExplosion_Ammo)`],
      [-2, `${who(THIRD, at(1000.5, 2000), true)} killed by LandMineTrap`],
    ];
    const c = creditOf([[-9 * HOUR, mine(OTHER, 1001)], ...first], MINE_DEATH);
    expect(c).toMatchObject({ outcome: "refused", refusedBy: 5, placerDayzId: OTHER.id });
  });

  it("a detonation from before the placement does not count against it", () => {
    const c = creditOf([[-10 * HOUR, wire(THIRD, 1030)], [-9 * HOUR, trip(THIRD, 1000.5)], [-8 * HOUR, wire(OTHER, 1001)]]);
    expect(c).toMatchObject({ outcome: "evidence_passes", flags: [] });
  });
});

describe("the trip the death hangs on", () => {
  const BLAST = `${D()}[HP: 0] hit by explosion (M67Grenade_Ammo)`, KILL = `${D()} killed by 6-M7 Frag Grenade`;
  const fragDeath = (...trips: [number, number][]): [number, string][] => [
    [-300, `${V()} is connected`], ...trips.map(([dt, x]) => [dt, trip(VICTIM, x)] as [number, string]), [0, BLAST], [0, KILL],
  ];

  it("a wire placed after the trip is not a candidate", () => {
    // the only placement within 5 m was written during the fuse: it cannot be the wire that was tripped
    const v = verdictOf([[-2, wire(OTHER, 1001)], ...TRIP_DEATH]);
    expect(v).toMatchObject({ rule: "A07", cause: "explosive_trap", confidence: "definitive", attribution: null });
    expect(v.evidence.credit).toMatchObject({ outcome: "refused", refusedBy: 2, placerDayzId: null, placement: null });
    // in the same second as the trip but written before it, it is one
    const sameSecond = verdictOf([[-300, `${V()} is connected`], [-4, wire(OTHER, 1001)], ...TRIP_DEATH.slice(1)]);
    expect(sameSecond.evidence.credit).toMatchObject({ outcome: "evidence_passes", placerDayzId: OTHER.id, ageHours: 0 });
  });

  it("a wire re-placed after the victim's trip does not make a spent one live", () => {
    const c = creditOf([[-9 * HOUR, wire(OTHER, 1001)], [-8 * HOUR, trip(THIRD, 1000.5)], [-2, wire(OTHER, 1001)]]);
    expect(c).toMatchObject({ outcome: "refused", refusedBy: 5, placerDayzId: OTHER.id });
    expect(c.flags).toEqual(["others_present"]);          // the placer, logged there two seconds before
  });

  it("a neighbour's wire tripped during the fuse was still live when the victim tripped theirs", () => {
    // someone trips the neighbour's wire 12 m off two seconds after the victim's trip: at the
    // moment that matters it was an unspent wire in the ring
    const c = creditOf([[-9 * HOUR, wire(OTHER, 1001)], [-8 * HOUR, wire(THIRD, 1012)], [-2, trip(THIRD, 1012)]]);
    expect(c).toMatchObject({ outcome: "refused", refusedBy: 3, placerDayzId: OTHER.id });
  });

  it("a claymore's wire placed after the trip line is not a candidate either", () => {
    const v = verdictOf([
      [-300, `${V()} is connected`], [0, trip(VICTIM, 1000)], [0, wire(OTHER, 1001)],
      [0, `${D()}[HP: 0] hit by explosion (ClaymoreMine_Ammo)`], [0, `${D()} killed by Claymore`],
    ]);
    expect(v).toMatchObject({ rule: "A06", attribution: null });
    expect(v.evidence.credit).toMatchObject({ outcome: "refused", refusedBy: 2, placement: null });
  });

  it("of two trips in the fuse window the anchor is the one at exactly 4 s", () => {
    // both on the same wire (two lines of one trip, a metre apart): the placement is measured from the 4 s line
    const v = verdictOf([[-HOUR, wire(OTHER, 1002)], ...fragDeath([-4, 1000], [-3, 1001])]);
    expect(v).toMatchObject({ rule: "A07", confidence: "definitive" });
    expect(v.evidence.credit).toMatchObject({ outcome: "evidence_passes", placerDayzId: OTHER.id, distanceM: 2, flags: [] });
    const early = verdictOf([[-HOUR, wire(OTHER, 1002)], ...fragDeath([-5, 1001], [-4, 1000])]);
    expect(early).toMatchObject({ rule: "A07", confidence: "definitive" });
    // the victim's other trip is part of this death, not an earlier detonation
    expect(early.evidence.credit).toMatchObject({ outcome: "evidence_passes", distanceM: 2, flags: [] });
  });

  it("with no trip at 4 s the anchor is the last one in the window, and the reading is only strong", () => {
    const v = verdictOf([[-HOUR, wire(OTHER, 1002)], ...fragDeath([-5, 1001], [-3, 1000])]);
    expect(v).toMatchObject({ rule: "A07", confidence: "strong" });
    expect(v.evidence.credit).toMatchObject({ outcome: "evidence_passes", distanceM: 2, flags: ["fuse_not_4s"] });
  });

  it("two wires tripped in the last six seconds: the device is ambiguous and nobody passes", () => {
    // 4 s before on one player's wire, 3 s before on another's 10 m off
    const near = creditOf([[-9 * HOUR, wire(THIRD, 1010)], [-8 * HOUR, wire(OTHER, 1000)]], fragDeath([-4, 1010], [-3, 1000]));
    expect(near).toMatchObject({ outcome: "refused", refusedBy: 2, placerDayzId: null });
    expect(near.flags).toEqual(["ambiguous_trip"]);                   // and the other trip spent nobody's wire
    // 5 s and 3 s before, 10 m apart
    const edges = creditOf([[-9 * HOUR, wire(THIRD, 1010)], [-8 * HOUR, wire(OTHER, 1000)]], fragDeath([-5, 1010], [-3, 1000]));
    expect(edges).toMatchObject({ outcome: "refused", refusedBy: 2 });
    expect(edges.flags).toEqual(["ambiguous_trip", "fuse_not_4s"]);
    // 30 m apart, one placer each
    const far = creditOf([[-9 * HOUR, wire(THIRD, 1030)], [-8 * HOUR, wire(OTHER, 1000)]], fragDeath([-5, 1030], [-3, 1000]));
    expect(far).toMatchObject({ outcome: "refused", refusedBy: 2, placerDayzId: null });
    expect(far.flags).toEqual(["ambiguous_trip", "fuse_not_4s"]);
    // even when both wires are the same player's: which device fired is still not known
    const same = creditOf([[-9 * HOUR, wire(OTHER, 1030)], [-8 * HOUR, wire(OTHER, 1000)]], fragDeath([-5, 1030], [-3, 1000]));
    expect(same).toMatchObject({ outcome: "refused", refusedBy: 2 });
  });

  it("a claymore death with a second wire tripped seconds before is ambiguous too", () => {
    const c = creditOf([[-HOUR, wire(OTHER, 1001)]], [
      [-300, `${V()} is connected`], [-5, trip(VICTIM, 1030)], [0, trip(VICTIM, 1000)],
      [0, `${D()}[HP: 0] hit by explosion (ClaymoreMine_Ammo)`], [0, `${D()} killed by Claymore`],
    ]);
    expect(c).toMatchObject({ outcome: "refused", refusedBy: 2, distanceM: 1 });
    expect(c.flags).toEqual(["ambiguous_trip"]);
  });

  it("a detonation older than every candidate, with an older neighbour in the ring, is not an earlier detonation", () => {
    // the neighbour's wire 8 m off was tripped 4 m from the anchor before the candidate was placed
    const c = creditOf([[-10 * HOUR, wire(THIRD, 1008)], [-9 * HOUR, trip(THIRD, 1004)], [-8 * HOUR, wire(OTHER, 1001)]]);
    expect(c).toMatchObject({ outcome: "evidence_passes", placerDayzId: OTHER.id });
    expect(c.flags).toEqual(["neighbour_spent"]);
  });
});

describe("shapes the measurements never covered are flagged for the operator", () => {
  const WIRE: [number, string] = [-HOUR, wire(OTHER, 1001)];
  const BLAST = (ammo = "M67Grenade_Ammo") => `${D()}[HP: 0] hit by explosion (${ammo})`;
  const KILL = `${D()} killed by 6-M7 Frag Grenade`;

  it("the plain shape carries none of them", () => {
    expect(creditOf([WIRE]).flags).toEqual([]);
  });

  it("a fuse of 3 s or 5 s", () => {
    for (const dt of [-3, -5]) {
      const c = creditOf([WIRE], [[-300, `${V()} is connected`], [dt, trip(VICTIM, 1000)], [0, BLAST()], [0, KILL]]);
      expect(c).toMatchObject({ outcome: "evidence_passes", flags: ["fuse_not_4s"] });
    }
  });

  it("no explosion line at all", () => {
    const frag = creditOf([WIRE], [[-300, `${V()} is connected`], [-4, trip(VICTIM, 1000)], [0, KILL]]);
    expect(frag).toMatchObject({ outcome: "evidence_passes", flags: ["no_explosion_line"] });
    const clay = creditOf([WIRE], [[-300, `${V()} is connected`], [-1, trip(VICTIM, 1000)], [0, `${D()} killed by Claymore`]]);
    expect(clay).toMatchObject({ outcome: "evidence_passes", flags: ["no_explosion_line"] });
    const landMine = creditOf([[-HOUR, mine(OTHER, 1001)]], [[-300, `${V()} is connected`], [0, `${D()} killed by LandMineTrap`]]);
    expect(landMine).toMatchObject({ outcome: "evidence_passes", flags: ["no_explosion_line"] });
  });

  it("several blasts on the body and several kill lines", () => {
    const c = creditOf([WIRE], [
      [-300, `${V()} is connected`], [-4, trip(VICTIM, 1000)],
      [0, BLAST()], [0, BLAST("RGD5Grenade_Ammo")], [0, BLAST("Explosion_40mm_Ammo")], [0, KILL], [0, KILL],
    ]);
    expect(c).toMatchObject({ outcome: "evidence_passes", placerDayzId: OTHER.id });
    expect(c.flags).toEqual(["kill_lines_x2", "multi_blast"]);
    // two blast lines are already more than one device's
    const two = creditOf([WIRE], [[-300, `${V()} is connected`], [-4, trip(VICTIM, 1000)], [0, BLAST()], [0, BLAST()], [0, KILL]]);
    expect(two.flags).toEqual(["multi_blast"]);
  });

  it("the victim logged with a frag in hand shortly before", () => {
    const c = creditOf([WIRE, [-10, `${V()} performed EmoteGreeting with 6-M7 Frag Grenade`]]);
    expect(c).toMatchObject({ outcome: "evidence_passes", flags: ["held_frag_before_blast"] });
  });

  it("a claymore beside the wire that someone other than the wire's placer placed", () => {
    const death: [number, string][] = [
      [-300, `${V()} is connected`], [0, trip(VICTIM, 1000)],
      [0, `${D()}[HP: 0] hit by explosion (ClaymoreMine_Ammo)`], [0, `${D()} killed by Claymore`],
    ];
    const clay = (p: Who, x: number) => `${who(p, at(x, 2000))} placed Claymore<ClaymoreMine>`;
    const other = verdictOf([[-HOUR, wire(OTHER, 1004)], [-HOUR + 60, clay(THIRD, 1001)], ...death]);
    expect(other.evidence.credit).toMatchObject({ outcome: "evidence_passes", placerDayzId: OTHER.id, flags: ["claymore_by_other_player"] });
    expect(other.evidence.notes.join(" ")).toContain(THIRD.name);
    const own = verdictOf([[-HOUR, wire(OTHER, 1004)], [-HOUR + 60, clay(OTHER, 1001)], ...death]);
    expect(own.evidence.credit).toMatchObject({ outcome: "evidence_passes", flags: [] });
    // 10.1 m away is not beside the wire
    const far = verdictOf([[-HOUR, wire(OTHER, 1004)], [-HOUR + 60, clay(THIRD, 1010.1)], ...death]);
    expect(far.evidence.credit!.flags).toEqual([]);
  });
});

describe("scope, wipes and what never changes", () => {
  it("a placement before a recorded wipe is not a candidate", () => {
    const ctx = contextOf(stamped([[-50 * HOUR, wire(OTHER, 1001)], ...TRIP_DEATH]));
    const v = classifyDeath(ctx);
    const wipe = (dtHours: number) => ({ 1: [new Date((T0 + dtHours * HOUR) * 1000).toISOString()] });
    expect(creditEvidence(ctx, v, { wipes: wipe(-40) })).toMatchObject({ outcome: "refused", refusedBy: 2, placement: null });
    expect(creditEvidence(ctx, v, { wipes: wipe(-60) })).toMatchObject({ outcome: "evidence_passes" });
    // a wipe of another server, or one after the death, changes nothing
    expect(creditEvidence(ctx, v, { wipes: { 2: wipe(-40)[1] } })).toMatchObject({ outcome: "evidence_passes" });
    expect(creditEvidence(ctx, v, { wipes: wipe(1) })).toMatchObject({ outcome: "evidence_passes" });
  });

  it("a wiped neighbour no longer refuses", () => {
    const ctx = contextOf(stamped([[-50 * HOUR, wire(THIRD, 1012)], [-9 * HOUR, wire(OTHER, 1001)], ...TRIP_DEATH]));
    const v = classifyDeath(ctx);
    expect(creditEvidence(ctx, v)).toMatchObject({ refusedBy: 3 });
    expect(creditEvidence(ctx, v, { wipes: { 1: [new Date((T0 - 20 * HOUR) * 1000).toISOString()] } })).toMatchObject({ outcome: "evidence_passes" });
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
    expect(creditEvidence(ctx, { rule: "A07", cause: "explosive_trap", confidence: "strong" }).outcome).toBe("evidence_passes");
  });

  it("the classifier never says credited: that word is the sweep's, after the two tests the database decides", () => {
    const outcomes = [
      creditOf([[-50 * HOUR, wire(OTHER, 1001)]]), creditOf([[-9 * HOUR, wire(VICTIM, 1001)]]), creditOf([]),
      creditOf([[-20 * HOUR, mine(OTHER, 1001)]], MINE_DEATH),
    ].map((c) => c.outcome);
    expect(outcomes).toEqual(["evidence_passes", "refused", "refused", "evidence_passes"]);
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
    expect(c).toMatchObject({ outcome: "evidence_passes", ageHours: 169 });
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
    expect(c).toMatchObject({ outcome: "evidence_passes", placerDayzId: OTHER.id, boots: 3, placement: { admFileId: 11, lineIndex: 2 } });
  });

  it("uses the caller's numbering when the corpus is only part of the log, and is null when a file has none", () => {
    const numbered = selectContextLines(corpus, seed, [], { bootOrdinals: new Map([[11, 40], [14, 163]]) });
    expect(classifyDeath(buildDeathContext(numbered)).evidence.credit!.boots).toBe(123);
    const partial = selectContextLines(corpus, seed, [], { bootOrdinals: new Map([[14, 163]]) });
    expect(classifyDeath(buildDeathContext(partial)).evidence.credit).toMatchObject({ outcome: "evidence_passes", boots: null });
  });

  it("with two trip lines, the selection holds the ring of the one the bar anchors on", () => {
    // Trips 4 s and 3 s before, 3 m apart: the anchor is the first. A neighbour's wire 14 m from
    // it (17 m from the second) was tripped a day earlier; that old trip line is what spends it.
    const twoTrips = {
      serverId: 3, map: "enoch", files: [
        logFile(21, "2031-03-08", "10:00:00", [["10:05:00", wire(OTHER, 1001)], ["10:06:00", wire(THIRD, 986)]]),
        logFile(22, "2031-03-09", "09:00:00", [["09:05:00", trip(THIRD, 985)]]),
        logFile(23, "2031-03-10", "11:00:00", [
          ["11:55:00", `${V()} is connected`], ["11:59:56", trip(VICTIM, 1000)], ["11:59:57", trip(VICTIM, 1003)],
          ["12:00:00", `${D()}[HP: 0] hit by explosion (M67Grenade_Ammo)`], ["12:00:00", `${D()} killed by 6-M7 Frag Grenade`],
        ]),
      ],
    };
    const c = classifyDeath(buildDeathContext(selectContextLines(twoTrips, { admFileId: 23, lineIndex: 6 }))).evidence.credit!;
    expect(c).toMatchObject({ outcome: "evidence_passes", placerDayzId: OTHER.id, distanceM: 1 });
    expect(c.flags).toEqual(["neighbour_spent"]);
  });
});
