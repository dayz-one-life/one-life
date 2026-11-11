import { describe, it, expect } from "vitest";
import { allClusters, DeathContext, dist2d, indexOf, pyHypot, pyRound, pySum, resolveCluster, type StampedLine } from "../src/index.js";
import { at, ID, OTHER, ref, stamped, T0, THIRD, VICTIM, who } from "./lines.js";

const V = (x = 1000, z = 2000) => who(VICTIM, at(x, z));
const D = (x = 1000, z = 2000) => who(VICTIM, at(x, z), true);
const STATS = (water = 500, energy = 500) => `died. Stats> Water: ${water} Energy: ${energy} Bleed sources: 0`;

/** The context of the LAST death in the lines, as the victim's. */
function contextOf(lines: StampedLine[], prevDeaths: { ts: number; pos: [number, number, number] | null }[] = []): DeathContext {
  const own = lines.filter((l) => l.subject?.id === VICTIM.id);
  const clusters = allClusters(own);
  return new DeathContext(lines, { serverId: 1, map: "chernarusplus", cluster: clusters[clusters.length - 1]!, prevDeaths });
}

describe("DeathContext: the life and the death", () => {
  it("the life starts after the previous death's last line and holds nothing older", () => {
    const lines = stamped([
      [-5000, `${V()}[HP: 10] hit by Infected into Torso(0) for 30 damage (MeleeInfected)`],
      [-4000, `${D()} ${STATS()}`], [-3999, `${D()} bled out`],
      [-3990, `${D()} is choosing to respawn`],
      [-3900, `${V()} is connected`], [-100, V()], [0, `${D()} ${STATS()}`], [1, D()], [10, D()],
    ]);
    const c = contextOf(lines);
    expect(c.life.map((l) => l.lineIndex)).toEqual([3, 4, 5]);
    expect(c.lifeStart).toBe(T0 - 3999);
    expect(c.fresh).toBe(true);
    expect(c.hits).toEqual([]);                                   // the old hit belongs to the life before
    expect(c.around.map((l) => l.lineIndex)).toEqual([6, 7]);     // the death second and two seconds after
    expect(c.alive.map((l) => l.lineIndex)).toEqual([4, 5]);
    expect(c.firstAliveTs).toBe(T0 - 3900);
  });

  it("a first life is not fresh: nothing says it began at full health", () => {
    const c = contextOf(stamped([[-100, V()], [0, `${D()} ${STATS()}`]]));
    expect(c.fresh).toBe(false);
    expect(c.lifeStart).toBeNull();
  });

  it("separates living hits, damaging hits, self hits and hits on the corpse", () => {
    const lines = stamped([
      [-60, `${V()}[HP: 80] hit by Infected into Torso(0) for 20 damage (MeleeInfected)`],
      [-50, `${V()}[HP: 80] hit by Infected into Torso(0) for 0 damage (Dummy_Light)`],
      [-40, `${V()}[HP: 70] hit by ${who(VICTIM)} into Torso(0) for 10 damage (MeleeFist)`],
      [-30, `${V()}[HP: 40] hit by ${who(OTHER, at(1002, 2000))} into Torso(0) for 30 damage (Bullet_556x45) with M4-A1 from 2 meters`],
      [0, `${D()}[HP: 0] hit by ${who(OTHER, at(1002, 2000))} into Head(0) for 90 damage (Bullet_556x45) with M4-A1 from 2 meters`],
      [0, `${D()} ${STATS()}`],
    ]);
    const c = contextOf(lines);
    expect(c.hits.map((h) => h.cat)).toEqual(["infected", "infected", "self", "player"]);
    expect(c.dmg.map((h) => h.cat)).toEqual(["infected", "player"]);
    expect(c.hpr).toHaveLength(4);
    expect(c.chits).toHaveLength(1);
    expect(c.fatal.map((h) => h.o.lineIndex)).toEqual([4]);
    expect(c.fatalBefore).toHaveLength(1);
    expect(c.lastDmg(120)?.pid).toBe(OTHER.id);
    expect(c.lastDmg(10)).toBeNull();
    expect([...c.playersIn(c.dmg)]).toEqual([[OTHER.id, OTHER.name]]);
    expect(c.srcLabel(c.dmg)).toBe(`infected + player ${OTHER.name}`);
  });

  it("an HP-0 line further than 0.35 m from the body, or on an older corpse, is not the lethal blow", () => {
    const lines = stamped([
      [-4000, `${D(500, 500)} ${STATS()}`], [-3900, `${V()} is connected`],
      [0, `${D(1000.5, 2000)}[HP: 0] hit by explosion (M67Grenade_Ammo)`],     // 0.5 m off: this body, not the blow
      [0, `${D(500, 500)}[HP: 0] hit by explosion (M67Grenade_Ammo)`],         // the corpse of the life before
      [0, `${D()} ${STATS()}`],
    ]);
    const c = contextOf(lines, [{ ts: T0 - 4000, pos: [500, 500, 10] }]);
    expect(c.corpse.map((l) => l.lineIndex)).toEqual([2, 4]);
    expect(c.fatal).toEqual([]);
    expect(c.bodyBlasts()).toMatchObject({ otherBodies: 1 });
    expect(c.bodyBlasts().mine.map((h) => h.o.lineIndex)).toEqual([2]);
  });

  it("a knock-out is closed by regaining consciousness or by a relog, and is open otherwise", () => {
    const lines = stamped([
      [-300, `${V()} is unconscious`], [-280, `${V()} regained consciousness`],
      [-200, `${V()} is unconscious`], [-150, `${V()} is connected`],
      [-20, `${V()}[HP: 5] hit by Infected into Torso(0) for 30 damage (MeleeInfected)`],
      [-19, `${V()} is unconscious`], [0, `${D()} ${STATS()}`],
    ]);
    const c = contextOf(lines);
    expect(c.eps.map((e) => [e.u.lineIndex, e.r?.lineIndex ?? null])).toEqual([[0, 1], [2, 3], [5, null]]);
    expect(c.openUnc?.u.lineIndex).toBe(5);
    expect(c.koSource(c.openUnc!)).toMatchObject({ label: "infected", confidence: "strong" });
    expect(c.koSource(c.eps[0]!)).toMatchObject({ label: null, confidence: "unknown" });
    expect(c.spontFaints()).toEqual([[T0 - 300, T0 - 280], [T0 - 200, T0 - 150]]);
  });

  it("logged-out time is not lived", () => {
    const lines = stamped([
      [-1000, `${V()} is connected`], [-800, `${V()} has been disconnected`],
      [-310, `${V()} is connecting`], [-300, `${V()} is connected`], [0, `${D()} ${STATS()}`],
    ]);
    const c = contextOf(lines);
    expect(c.offline).toEqual([[T0 - 800, T0 - 300]]);
    expect(c.onlineLife()).toBe(500);
    expect(c.online(T0 - 900, T0 - 700)).toBe(100);
  });
});

describe("DeathContext: health bookkeeping", () => {
  it("counts how many stats are low", () => {
    expect(contextOf(stamped([[0, `${D()} ${STATS(300, 0)}`]])).nLow).toBe(2);
    expect(contextOf(stamped([[0, `${D()} ${STATS(301, 0)}`]])).nLow).toBe(1);
    expect(contextOf(stamped([[0, `${D()} killed by LandMineTrap`]])).nLow).toBe(0);
  });

  it("a creature hit removes its printed damage times the zone factor", () => {
    const c = contextOf(stamped([
      [-30, `${V()}[HP: 80] hit by Infected into Torso(0) for 20 damage (MeleeInfected)`],
      [-20, `${V()}[HP: 78] hit by Infected into LeftArm(0) for 12 damage (MeleeInfected)`],
      [-10, `${V()}[HP: 60] hit by Infected into Head(0) for 18 damage (MeleeInfected)`],
      [-5, `${V()}[HP: 20] hit by Wolf into Head(0) for 20 damage (MeleeWolf)`],
      [-4, `${V()}[HP: 20] hit by ${who(OTHER)} into Torso(0) for 30 damage (MeleeFist)`],
      [0, `${D()} ${STATS()}`],
    ]));
    expect(c.hits.map((h) => c.hitLoss(h))).toEqual([20, 12 * 0.10, 18, 40, null]);
  });

  it("splits the final descent into what hits took and what went silently", () => {
    const lines = stamped([
      [-2000, `${D()} ${STATS()}`], [-1000, `${V()} is connected`],
      [-500, `${V()}[HP: 80] hit by Infected into Torso(0) for 20 damage (MeleeInfected)`],
      [-100, `${V()}[HP: 50] hit by Infected into Torso(0) for 0 damage (Dummy_Light)`],
      [0, `${D()} ${STATS(500, 0)}`],
    ]);
    const d = contextOf(lines).descent();
    expect(d.startHp).toBe(100);                       // a fresh life starts at full health
    expect([...d.logged]).toEqual([["infected", 20]]);
    expect(d.segs).toEqual([[30, 400, T0 - 100]]);     // 30 HP went between two readings with no damaging line
    expect(d.finalHp).toBe(50);
    expect(d.finalS).toBe(100);
    expect(d.silent).toBe(80);                         // those 30, and the last 50 no line took
    expect(d.silentS).toBe(500);
    expect(d.total).toBe(100);
  });

  it("the final descent starts at the last local maximum, a fixed window does not", () => {
    const lines = stamped([
      [-900, `${V()}[HP: 30] hit by Infected into Torso(0) for 20 damage (MeleeInfected)`],
      [-700, `${V()}[HP: 90] hit by Infected into Torso(0) for 0 damage (Dummy_Light)`],
      [-100, `${V()}[HP: 60] hit by Infected into Torso(0) for 30 damage (MeleeInfected)`],
      [0, `${D()} ${STATS()}`],
    ]);
    const c = contextOf(lines);
    expect(c.descent().startHp).toBe(90);
    expect(c.descent().gain).toBe(0);
    expect(c.descent(600)).toMatchObject({ startHp: 30, finalHp: 60 });
    // no reading inside the window: nothing can be split
    expect(c.descent(50)).toMatchObject({ silent: null, total: null });
  });

  it("finds the hit that first left the victim at 15 or less with no recovery above 30", () => {
    const lines = stamped([
      [-900, `${V()}[HP: 10] hit by ${who(OTHER)} into Torso(0) for 50 damage (MeleeFist)`],
      [-800, `${V()}[HP: 40] hit by Infected into Torso(0) for 0 damage (Dummy_Light)`],      // recovered
      [-300, `${V()}[HP: 12] hit by Infected into Torso(0) for 25 damage (MeleeInfected)`],
      [-200, `${V()}[HP: 9] hit by Infected into Torso(0) for 3 damage (MeleeInfected)`],
      [0, `${D()} ${STATS()}`],
    ]);
    expect(contextOf(lines).lowOrigin()?.o.lineIndex).toBe(2);
    expect(contextOf(stamped([[0, `${D()} ${STATS()}`]])).lowOrigin()).toBeNull();
  });
});

describe("DeathContext: the edges of the thresholds", () => {
  const INF = (hp: number, dmg: number, shot = "MeleeInfected") => `${V()}[HP: ${hp}] hit by Infected into Torso(0) for ${dmg} damage (${shot})`;

  it("a same-second drop is the hit's own up to 1.3 times its damage plus a half, and split above that", () => {
    const logged = (hp: number) => contextOf(stamped([[-100, INF(100, 0, "Dummy_Light")], [-100, INF(hp, 20)], [0, `${D()} ${STATS()}`]])).descent();
    // 20 damage to the torso removes 20: a drop of up to 26.5 in the same second is all the hit's
    expect(logged(73.6).logged.get("infected")).toBeCloseTo(26.4, 9);
    expect(logged(73.6).segs).toEqual([]);
    // 26.6: something else took the rest
    expect(logged(73.4).logged.get("infected")).toBe(20);
    expect(logged(73.4).segs).toEqual([[6.6, 0, T0 - 100]]);
  });

  it("a reading of exactly 30 does not end the low run, 31 does", () => {
    const run = (hp: number) => contextOf(stamped([
      [-900, `${V()}[HP: 10] hit by ${who(OTHER)} into Torso(0) for 50 damage (MeleeFist)`],
      [-800, INF(hp, 0, "Dummy_Light")],
      [-300, INF(12, 25)],
      [0, `${D()} ${STATS()}`],
    ])).lowOrigin()?.o.lineIndex;
    expect(run(30)).toBe(0);
    expect(run(31)).toBe(2);
  });

  it("a hit that leaves exactly 15 is a low origin, 16 is not", () => {
    const low = (hp: number) => contextOf(stamped([[-300, INF(hp, 25)], [0, `${D()} ${STATS()}`]])).lowOrigin();
    expect(low(15)?.o.lineIndex).toBe(0);
    expect(low(16)).toBeNull();
  });

  const BLAST = (x: number) => `${D(x, 2000)}[HP: 0] hit by explosion (M67Grenade_Ammo)`;
  const blasts = (x: number, prev: { ts: number; pos: [number, number, number] | null }[] = []) =>
    contextOf(stamped([[-50, `${V()} is connected`], [0, BLAST(x)], [0, `${D()} ${STATS()}`]]), prev).bodyBlasts();

  it("a blast line on a body up to 1 m from the death is this body's, further off it is another's", () => {
    expect(blasts(1000.3)).toMatchObject({ otherBodies: 0, mine: [expect.anything()] });
    expect(blasts(1000.9)).toMatchObject({ otherBodies: 0, mine: [expect.anything()] });
    expect(blasts(1001.1)).toMatchObject({ otherBodies: 1, mine: [] });
  });

  it("... unless an earlier death of the same player lies within 1 m of the line, in the last six hours", () => {
    const earlier = (dx: number, ago: number) => [{ ts: T0 - ago, pos: [1000.9 + dx, 2000, 10] as [number, number, number] }];
    expect(blasts(1000.9, earlier(0.9, 3600))).toMatchObject({ otherBodies: 1, mine: [] });     // an older corpse lies there
    expect(blasts(1000.9, earlier(1.1, 3600))).toMatchObject({ otherBodies: 0 });               // 1.1 m: not that corpse
    expect(blasts(1000.9, earlier(0.9, 6 * 3600))).toMatchObject({ otherBodies: 1 });           // six hours to the second
    expect(blasts(1000.9, earlier(0.9, 6 * 3600 + 1))).toMatchObject({ otherBodies: 0 });       // older: the body is gone
    // a line within 0.35 m is this body whatever lies near
    expect(blasts(1000.3, earlier(0, 3600))).toMatchObject({ otherBodies: 0, mine: [expect.anything()] });
  });

  it("a knock-out with no hit in its own seconds is put down to the last hit up to 30 s before it", () => {
    const source = (ago: number) => {
      const c = contextOf(stamped([[-100 - ago, INF(60, 30)], [-100, `${V()} is unconscious`], [0, `${D()} ${STATS()}`]]));
      return c.koSource(c.eps[0]!);
    };
    expect(source(3)).toMatchObject({ label: "infected", confidence: "strong" });       // within 3 s: the hit itself
    expect(source(4)).toMatchObject({ label: "infected", confidence: "inferred" });
    expect(source(30)).toMatchObject({ label: "infected", confidence: "inferred" });
    expect(source(31)).toMatchObject({ label: null, confidence: "unknown" });
  });

  it("a (DEAD) line up to 2 m from the death is this body, further off an older corpse", () => {
    const c = contextOf(stamped([[0, `${D()} ${STATS()}`], [1, D(1002, 2000)], [1, D(1002.1, 2000)]]));
    expect(c.corpse.map((l) => l.lineIndex)).toEqual([0, 1]);
  });

  it("the speed into the death looks back 900 s and no further", () => {
    const speed = (ago: number) => contextOf(stamped([[-ago, V(100, 2000)], [0, `${D()} ${STATS()}`]])).finalSpeed();
    expect(speed(900)).toMatchObject({ speed: 1, secs: 900, dist: 900 });
    expect(speed(901)).toBeNull();
  });

  it("a 2 s jump is replaced by the longer segment only when that is faster and at most 45 m/s", () => {
    const speed = (x: number) => contextOf(stamped([[-10, V(x, 2000)], [-2, V(970, 2000)], [0, `${D()} ${STATS()}`]])).finalSpeed();
    expect(speed(550)).toMatchObject({ speed: 45, secs: 10 });      // 450 m in 10 s: believable, and faster than the jump
    expect(speed(549)).toMatchObject({ speed: 15, secs: 2 });       // 45.1 m/s: no player moves like that, the jump stands
    expect(speed(900)).toMatchObject({ speed: 15, secs: 2 });       // 10 m/s: slower than the jump
  });
});

describe("DeathContext: movement", () => {
  it("measures the speed into the death from the last own position at least 3 s earlier", () => {
    const c = contextOf(stamped([[-20, V(800, 2000)], [-10, V(900, 2000)], [-1, V(999, 2000)], [0, `${D()} ${STATS()}`]]));
    expect(c.finalSpeed()).toMatchObject({ speed: 10, secs: 10, dist: 100 });
    expect(c.maxRecentSpeed()).toBe(11);
    expect(c.ownPositions(15).map((p) => p.ts - T0)).toEqual([-10, -1]);
    expect(c.pathLen()).toBe(200);
  });
  it("never measures across a relog or a teleport", () => {
    const c = contextOf(stamped([
      [-20, V(100, 2000)], [-10, `${V(900, 2000)} was teleported from: <1.0, 2.0, 3.0> to: <4.0, 5.0, 6.0>. Reason: Spawning`], [0, `${D()} ${STATS()}`],
    ]));
    expect(c.finalSpeed()).toBeNull();
    expect(c.pathLen()).toBeNull();
    expect(c.speedInto(c.prim)).toBeNull();
  });
});

describe("ServerIndex", () => {
  const lines = stamped([
    [-5000, `${who(OTHER, at(1003, 2000))} placed Tripwire<TripwireTrap>`],
    [-4000, `${who(THIRD, at(1000, 2004))} placed Tripwire<TripwireTrap>`],
    [-3000, `${who(THIRD, at(1000, 2004))} placed Land Mine<LandMineTrap>`],
    [-50, who(OTHER, at(1040, 2000))],
    [-40, `${who(THIRD, at(1010, 2000))}[HP: 50] hit by ${who({ name: "Fourth Four", id: ID("4") }, at(1020, 2000))} into Torso(0) for 30 damage (MeleeFist)`],
    [-30, `${who(THIRD, at(1010, 2000), true)} died. Stats> Water: 500 Energy: 500 Bleed sources: 0`],
    [0, `${D()} ${STATS()}`],
    [5, `${who(OTHER, at(1001, 2000))} placed Tripwire<TripwireTrap>`],
  ]);
  const S = indexOf(lines), pos: [number, number, number] = [1000, 2000, 10];

  it("placedNear: by class and radius, before a point in the log, nearest first", () => {
    const trip = new Set(["TripwireTrap"]);
    expect(S.placedNear(pos, trip, 5, 6).map((p) => [p.line.lineIndex, p.dist])).toEqual([[0, 3], [1, 4]]);
    expect(S.placedNear(pos, trip, 3.5, 6).map((p) => p.line.lineIndex)).toEqual([0]);
    expect(S.placedNear(pos, trip, 5, 6, 4500, T0).map((p) => p.line.lineIndex)).toEqual([1]);       // not older than 4500 s
    expect(S.placedNear(pos, trip, 5, lines.length).map((p) => p.line.lineIndex)).toEqual([7, 0, 1]);  // without the cut, the later one counts
  });

  it("othersNear: everyone logged within the radius, in any identity block", () => {
    const near = S.othersNear(VICTIM.id, pos, T0 - 60, T0, 50);
    expect([...near].map(([id, v]) => [id, v.dist])).toEqual([[OTHER.id, 40], [THIRD.id, 10], [ID("4"), 20]]);
    expect([...S.othersNear(VICTIM.id, pos, T0 - 60, T0, 15).keys()]).toEqual([THIRD.id]);
    // a player who died before the instant asked about was a corpse by then
    expect([...S.othersNear(VICTIM.id, pos, T0 - 60, T0, 15, { livingAt: { ts: T0, seq: 6 } }).keys()]).toEqual([]);
    // (DEAD) blocks count only when asked for
    expect(S.othersNear(VICTIM.id, pos, T0 - 35, T0, 15).size).toBe(0);
    expect(S.othersNear(VICTIM.id, pos, T0 - 35, T0, 15, { aliveOnly: false }).size).toBe(1);
  });

  it("window, diedIn, diedBetween and aliveAgain read the log by time and by order", () => {
    expect(S.window(T0 - 40, T0 - 30).map((l) => l.lineIndex)).toEqual([4, 5]);
    expect(S.diedIn(THIRD.id, T0 - 60, T0, 6)?.lineIndex).toBe(5);
    expect(S.diedIn(THIRD.id, T0 - 60, T0, 5)).toBeNull();
    expect(S.diedBetween(THIRD.id, 4, 6)?.lineIndex).toBe(5);
    expect(S.aliveAgain(THIRD.id, 5, lines.length)).toBe(false);
    expect(resolveCluster(S.ownLines(VICTIM.id), ref(6)).primary).toEqual(ref(6));
  });

  it("adds floats with the reference's compensated sum, and measures a distance to its last bit", () => {
    expect(0.1 + 0.1 + 0.1 + 0.1 + 0.1 + 0.1 + 0.1 + 0.1 + 0.1 + 0.1).toBe(0.9999999999999999);
    expect(pySum(Array.from({ length: 10 }, () => 0.1))).toBe(1);
    expect(pySum([1, 1e100, 1, -1e100])).toBe(2);
    expect(pySum([])).toBe(0);
    // the reference's hypot: exact on a 3-4-5 triangle scaled to a threshold, where Math.hypot is not
    expect(pyHypot(18, 24)).toBe(30);
    expect(pyHypot(0, 0)).toBe(0);
    expect(pyHypot(-3, 4)).toBe(5);
    expect(pyHypot(1036.6 - 1000, 2000 - 2048.8)).toBe(61.00000000000009);   // as Python prints it; Math.hypot gives ...085
    expect(dist2d([1000, 2000, 5], [1003, 2004, 99])).toBe(5);               // altitude is ignored
  });

  it("rounds a tie to the even neighbour, as the reference does", () => {
    expect(pyRound(0.25, 1)).toBe(0.2);
    expect(pyRound(0.35, 1)).toBe(0.3);     // 0.35 is stored just below the half
    expect(pyRound(2.5, 0)).toBe(2);
    expect(pyRound(3.5, 0)).toBe(4);
    expect(pyRound(0.125, 2)).toBe(0.12);
    expect(pyRound(7.6449, 1)).toBe(7.6);
  });
});
