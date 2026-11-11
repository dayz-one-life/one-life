import { describe, it, expect } from "vitest";
import { allClusters, classifyDeath, DeathContext, spawnAt, SPAWN_BASELINES, type InternalVerdict, type StampedLine } from "../src/index.js";
import { at, OTHER, stamped, T0, VICTIM, who } from "./lines.js";

/**
 * The inferred rules (B09 to B23) on hand-built deaths. ⚠️ Every name, id and position here is
 * invented. The real deaths are checked by the private golden suites; these pin the thresholds
 * the design names, so a change to one fails here in public CI.
 */
const V = (x = 1000, z = 2000, alt = 10) => who(VICTIM, at(x, z, alt));
const D = (x = 1000, z = 2000, alt = 10) => who(VICTIM, at(x, z, alt), true);
const STATS = (water = 500, energy = 500, bleed = 0) => `died. Stats> Water: ${water} Energy: ${energy} Bleed sources: ${bleed}`;
/** A 0-damage hit line: it carries an HP reading and takes nothing. */
const READING = (hp: number) => `[HP: ${hp}] hit by Infected into LeftArm(0) for 0 damage (MeleeInfected)`;

function contextOf(lines: StampedLine[], map = "chernarusplus", serverId = 1): DeathContext {
  const clusters = allClusters(lines.filter((l) => l.subject?.id === VICTIM.id));
  return new DeathContext(lines, { serverId, map, cluster: clusters[clusters.length - 1]!, prevDeaths: [] });
}
const verdictOf = (entries: [number, string][], map?: string, serverId?: number): InternalVerdict =>
  classifyDeath(contextOf(stamped(entries), map, serverId));

describe("starvation needs a budget that fits", () => {
  // Energy at 0; HP 80 sixty seconds before death. The stat drain gives at most 0.05 HP/s, so
  // 1.33 HP/s cannot be the stat alone.
  const tooFast: [number, string][] = [
    [-3000, `${V()} is connected`], [-60, `${V()}${READING(80)}`], [0, `${D()} ${STATS(500, 0)}`],
  ];

  it("Energy 0 with a budget that cannot fit is not starvation where a second drain fits", () => {
    // On a cold map the drain covers under half the loss: cold took the larger share.
    expect(verdictOf(tooFast, "sakhal")).toMatchObject({ rule: "B20f", cause: "cold_exposure", confidence: "inferred", coCauses: ["starvation"], mechanismStated: false });
    // With nothing else to name, the stat is all the log offers, and only inferred.
    expect(verdictOf(tooFast)).toMatchObject({ rule: "B09", cause: "starvation", confidence: "inferred" });
  });

  it("Energy 0 with a budget that fits is starvation, strong", () => {
    const v = verdictOf([[-3000, `${V()} is connected`], [-600, `${V()}${READING(25)}`], [0, `${D()} ${STATS(500, 0)}`]]);
    expect(v).toMatchObject({ rule: "B09", cause: "starvation", confidence: "strong", mechanismStated: false, attribution: null });
  });

  it("the budget allows the stat drain 5 % over the engine figure, for one-second timestamps", () => {
    // 0.05 HP/s with the 1.05 tolerance is 0.0525 HP/s: 52 HP in 1000 s fits, 53 does not.
    const at = (hp: number) => verdictOf([[-3000, `${V()} is connected`], [-1000, `${V()}${READING(hp)}`], [0, `${D()} ${STATS(500, 0)}`]]);
    expect(at(52)).toMatchObject({ rule: "B09", confidence: "strong" });
    expect(at(53)).toMatchObject({ rule: "B09", confidence: "inferred" });
  });

  it("both stats low name both drains", () => {
    const v = verdictOf([[-3000, `${V()} is connected`], [-600, `${V()}${READING(25)}`], [0, `${D()} ${STATS(0, 0)}`]]);
    expect(v).toMatchObject({ rule: "B09", cause: "starvation_and_dehydration", confidence: "strong" });
  });
});

describe("cold", () => {
  it("a healthy player at sea level for 290 s on a cold map is cold_exposure inferred", () => {
    const sea = (dt: number) => [dt, `${V(1000 + (dt + 300) / 10, 2000, 0)}`] as [number, string];
    const entries: [number, string][] = [
      [-3000, `${V()} is connected`], sea(-290), sea(-200), sea(-100), sea(-10), [0, `${D(1029, 2000, 0)} ${STATS(500, 500)}`],
    ];
    expect(verdictOf(entries, "sakhal")).toMatchObject({ rule: "B20a", cause: "cold_exposure", confidence: "inferred", mechanismStated: false, coCauses: [] });
    // 289 s in the sea is not enough: nothing else is logged, so the death stays unknown.
    const shorter = entries.map(([dt, t]) => [dt === -290 ? -289 : dt, t] as [number, string]);
    expect(verdictOf(shorter, "sakhal")).toMatchObject({ rule: "B19", cause: "unknown" });
  });
});

describe("a silent drain with healthy stats", () => {
  // HP readings on 0-damage lines falling 0.05 HP/s for 2000 s: a steady drain no line explains.
  const drain: [number, string][] = [
    [-3000, `${V()} is connected`], [-2000, `${V()}${READING(100)}`], [-1700, `${V()}${READING(85)}`],
    [-1400, `${V()}${READING(70)}`], [0, `${D()} ${STATS(500, 500)}`],
  ];
  it("is cold on a cold map (B20d) and unknown elsewhere", () => {
    expect(verdictOf(drain, "sakhal")).toMatchObject({ rule: "B20d", cause: "cold_exposure", confidence: "inferred", upstream: null });
    expect(verdictOf(drain)).toMatchObject({ rule: "B19", cause: "unknown" });
  });
});

describe("heat", () => {
  const faints = (gap: number): [number, string][] => [
    [-3000, `${V()} is connected`],
    [-66 - gap, `${V()} is unconscious`], [-58 - gap, `${V()} regained consciousness`],
    [-58, `${V()} is unconscious`], [-50, `${V()} regained consciousness`],
    [0, `${D()} ${STATS(500, 500)}`],
  ];

  it("two hit-less faints 55 to 130 s apart after the heat build is heatstroke, heatstroke_or_silicosis on a sand map", () => {
    // the invented day of these lines is after the build that brought heatstroke
    expect(verdictOf(faints(100))).toMatchObject({ rule: "B13", cause: "heatstroke", confidence: "inferred", mechanismStated: false });
    expect(verdictOf(faints(100), "nasdara")).toMatchObject({ rule: "B13", cause: "heatstroke_or_silicosis", confidence: "inferred" });
    expect(verdictOf(faints(55)).cause).toBe("heatstroke");
    expect(verdictOf(faints(130)).cause).toBe("heatstroke");
    expect(verdictOf(faints(54)).cause).not.toBe("heatstroke");
    expect(verdictOf(faints(131)).cause).not.toBe("heatstroke");
  });

  it("three faints in the cycle make it strong; never on a sand map", () => {
    const three: [number, string][] = [
      [-3000, `${V()} is connected`],
      [-300, `${V()} is unconscious`], [-292, `${V()} regained consciousness`],
      [-200, `${V()} is unconscious`], [-192, `${V()} regained consciousness`],
      [-100, `${V()} is unconscious`], [-92, `${V()} regained consciousness`],
      [0, `${D()} ${STATS(500, 500)}`],
    ];
    expect(verdictOf(three)).toMatchObject({ rule: "B13", cause: "heatstroke", confidence: "strong" });
    expect(verdictOf(three, "nasdara")).toMatchObject({ rule: "B13", cause: "heatstroke_or_silicosis", confidence: "inferred" });
  });
});

describe("vehicles", () => {
  it("a co-death within 2 s and 15 m is vehicle_crash_occupant strong", () => {
    const crew = (dx: number, dt: number): [number, string][] => [
      [-3000, `${V()} is connected`], [-1000, `${who(OTHER, at(1000, 2000))} is connected`],
      [dt, `${who(OTHER, at(1000 + dx, 2000), true)} ${STATS(500, 500)}`], [0, `${D()} ${STATS(500, 500)}`],
    ];
    const v = verdictOf(crew(5, 1));
    expect(v).toMatchObject({ rule: "B14", cause: "vehicle_crash_occupant", confidence: "strong", mechanismStated: false, attribution: null });
    // the other occupant is evidence, never a person on the verdict
    expect(v.evidence.contributors).toEqual([]);
    expect(verdictOf(crew(16, 1)).rule).not.toBe("B14");
    expect(verdictOf(crew(5, 3)).rule).not.toBe("B14");
  });
});

describe("vehicles, read from a fresh life", () => {
  const respawn: [number, string][] = [[-1000, `${D(900, 2000)} ${STATS(400, 300)}`], [-998, `${D(900, 2000)} is choosing to respawn`]];

  it("a healthy knock-out with no hit lasting 13 to 22 s, then a bare death, is a probable crash (B21)", () => {
    const ko = (dur: number) => verdictOf([
      ...respawn, [-600, `${V()} is connected`], [-300, `${V()} is unconscious`], [-300 + dur, `${V()} regained consciousness`],
      [0, `${D()} ${STATS(500, 500)}`],
    ]);
    expect(ko(13)).toMatchObject({ rule: "B21", cause: "vehicle_crash_occupant", confidence: "inferred", mechanismStated: false });
    expect(ko(22).rule).toBe("B21");
    expect(ko(12).rule).not.toBe("B21");
    expect(ko(23).rule).not.toBe("B21");
  });

  it("a respawn life that used under 0.05 Water/Energy per metre is seated travel (B23)", () => {
    // 500 m of own positions since the respawn, Water and Energy each down by the same amount
    const ride = (stat: number) => verdictOf([
      ...respawn, [-600, `${V(1000)} is connected`], [-500, `${V(1000)}`], [-300, `${V(1250)}`], [-100, `${V(1500)}`], [-10, `${V(1500)}`],
      [0, `${D(1500)} ${STATS(stat, stat)}`],
    ]);
    expect(ride(576)).toMatchObject({ rule: "B23", cause: "vehicle_crash_occupant", confidence: "inferred" });   // 0.048 per metre
    expect(ride(574).rule).not.toBe("B23");                                                                       // 0.052 per metre
  });
});

describe("spawn baselines", () => {
  it("the spawn baseline used is the table entry at or before the death", () => {
    const rows = SPAWN_BASELINES[2]!;
    const second = Date.parse(rows[1]!.from) / 1000;
    expect(spawnAt(2, second)).toEqual({ water: rows[1]!.water, energy: rows[1]!.energy });
    expect(spawnAt(2, second - 1)).toEqual({ water: rows[0]!.water, energy: rows[0]!.energy });
    // before the first entry, and on a server the table does not list: the default
    expect(spawnAt(2, Date.parse(rows[0]!.from) / 1000 - 1)).toEqual({ water: 600, energy: 600 });
    expect(spawnAt(99, T0)).toEqual({ water: 600, energy: 600 });
    // a caller's own table replaces the server's
    expect(spawnAt(2, second, [{ from: "2020-01-01T00:00:00Z", water: 750, energy: 750 }])).toEqual({ water: 750, energy: 750 });
  });

  it("the classifier reads the spawn levels: a fresh life measured against them", () => {
    // A respawn life of 400 online s that burned Energy far faster than Water: the cold signature
    // from known spawn levels (B20c). With levels of 1000, the same stats mean a far faster burn.
    const life = (energy: number): [number, string][] => [
      [-1000, `${D(900, 2000)} ${STATS(400, 300)}`], [-998, `${D(900, 2000)} is choosing to respawn`],
      [-400, `${V()} is connected`], [-200, `${V()}`], [-100, `${V()}`], [0, `${D()} ${STATS(590, energy)}`],
    ];
    const lines = stamped(life(400));
    const ctx = (table?: { from: string; water: number; energy: number }[]) => {
      const clusters = allClusters(lines.filter((l) => l.subject?.id === VICTIM.id));
      return new DeathContext(lines, { serverId: 1, map: "chernarusplus", cluster: clusters[clusters.length - 1]!, prevDeaths: [], spawnBaselines: table });
    };
    expect(ctx().fresh).toBe(true);
    // 600/600: Energy fell 0.5/s, Water 0.025/s
    expect(classifyDeath(ctx())).toMatchObject({ rule: "B20c", cause: "cold_exposure", confidence: "inferred" });
    // 600/450: Energy fell only 0.125/s, no cold signature
    expect(classifyDeath(ctx([{ from: "2020-01-01T00:00:00Z", water: 600, energy: 450 }])).rule).not.toBe("B20c");
  });
});

describe("unknown stays unknown", () => {
  it("a healthy, conscious player with nothing logged is unknown, B19, and gets the post-pass", () => {
    const v = verdictOf([[-3000, `${V()} is connected`], [-500, `${V()}`], [0, `${D()} ${STATS(500, 500)}`]]);
    expect(v).toMatchObject({ rule: "B19", cause: "unknown", confidence: "unknown", mechanismStated: false, attribution: null, upstream: null });
  });

  it("a creature that left HP 35 or less within 600 s is a lead, never the cause (B18)", () => {
    const v = verdictOf([
      [-3000, `${V()} is connected`], [-500, `${V()}[HP: 30] hit by Infected into Torso(0) for 20 damage (MeleeInfected)`],
      [0, `${D()} ${STATS(500, 500)}`],
    ]);
    expect(v).toMatchObject({ rule: "B18", cause: "unknown", confidence: "unknown", upstream: { cause: "infected", confidence: "inferred" } });
  });
});

describe("a player's last hit on a bare death", () => {
  it("is an inferred killer (B11), basis not_stated, never printable", () => {
    const shot = `[HP: 20] hit by ${who(OTHER, at(1040, 2000))} into Torso(0) for 40 damage (Bullet_556x45) with M4-A1 from 40 meters`;
    const v = verdictOf([[-3000, `${V()} is connected`], [-100, `${V()}${shot}`], [0, `${D()} ${STATS(500, 500)}`]]);
    expect(v).toMatchObject({ rule: "B11", cause: "pvp", confidence: "strong", mechanismStated: false });
    expect(v.attribution).toMatchObject({ role: "killer (inferred)", basis: "not_stated", dayzId: OTHER.id, confidence: "strong" });
  });
});

// ---- Thresholds the real data does not reach (review of step 6). Golden parity checks these rules
// only where a real death sits; each case below is a boundary pair, so changing the constant or the
// comparison moves one side of the pair.
const INF = (hp: number, dmg = 20) => `[HP: ${hp}] hit by Infected into Torso(0) for ${dmg} damage (MeleeInfected)`;
const WOLF = (hp: number, dmg = 20) => `[HP: ${hp}] hit by Wolf into Torso(0) for ${dmg} damage (MeleeWolf)`;
const SHOT = (hp: number, dmg = 40) => `[HP: ${hp}] hit by ${who(OTHER, at(1040, 2000))} into Torso(0) for ${dmg} damage (Bullet_556x45) with M4-A1 from 40 meters`;
const RESPAWN: [number, string][] = [[-6000, `${D(900, 2000)} ${STATS(400, 300)}`], [-5998, `${D(900, 2000)} is choosing to respawn`]];

describe("B10: who took the HP in the last 600 online seconds", () => {
  // HP 100 on a reading, then creature hits that take it to 10.
  const mauled = (age: number, last = INF(10, 40), first = INF(50, 50)): [number, string][] => [
    [-3000, `${V()} is connected`], [-400, `${V()}${READING(100)}`], [-200, `${V()}${first}`], [-age, `${V()}${last}`],
    [0, `${D()} ${STATS(500, 500)}`],
  ];

  it("a creature that left HP 15 or less is the cause: strong within 10 s, inferred to 120 s, not after", () => {
    expect(verdictOf(mauled(10))).toMatchObject({ rule: "B10", cause: "infected", confidence: "strong", mechanismStated: false, attribution: null });
    expect(verdictOf(mauled(11))).toMatchObject({ rule: "B10", cause: "infected", confidence: "inferred" });
    expect(verdictOf(mauled(120))).toMatchObject({ rule: "B10", cause: "infected", confidence: "inferred" });
    expect(verdictOf(mauled(121)).rule).not.toBe("B10");
    expect(verdictOf(mauled(60, INF(15, 35))).rule).toBe("B10");
    expect(verdictOf(mauled(60, INF(16, 34))).rule).not.toBe("B10");
    // the hit and the last reading are tested apart: a 0-damage reading after the hit moves only the second
    const withReading = (hit: number, reading: number): [number, string][] => [
      [-3000, `${V()} is connected`], [-400, `${V()}${READING(100)}`], [-200, `${V()}${INF(50, 50)}`], [-60, `${V()}${INF(hit, 50 - hit)}`],
      [-50, `${V()}${READING(reading)}`], [0, `${D()} ${STATS(500, 500)}`],
    ];
    expect(verdictOf(withReading(15, 15)).rule).toBe("B10");
    expect(verdictOf(withReading(16, 15)).rule).not.toBe("B10");
    expect(verdictOf(withReading(15, 16)).rule).not.toBe("B10");
  });

  it("a wolf is animal_wolf; inferred past 10 s, which presents as not recorded (no family)", () => {
    expect(verdictOf(mauled(60, WOLF(10, 40), WOLF(50, 50)))).toMatchObject({ rule: "B10", cause: "animal_wolf", confidence: "inferred" });
  });

  it("the creature's hits must take at least half the HP lost in the window", () => {
    // From 100 silently to X, one hit to 10, then 10 more silently: X 60 is 50 HP each way.
    const share = (x: number): [number, string][] => [
      [-3000, `${V()} is connected`], [-400, `${V()}${READING(100)}`], [-300, `${V()}${READING(x)}`],
      [-30, `${V()}${INF(10, x - 10)}`], [0, `${D()} ${STATS(500, 500)}`],
    ];
    expect(verdictOf(share(60))).toMatchObject({ rule: "B10", cause: "infected" });
    expect(verdictOf(share(59)).rule).not.toBe("B10");
  });

  it("a player's last hit to HP 5 or less is an inferred killer, basis not_stated: strong within 10 s", () => {
    const shot = (age: number, hp = 5): [number, string][] => [
      [-3000, `${V()} is connected`], [-400, `${V()}${READING(100)}`], [-age, `${V()}${SHOT(hp, 100 - hp)}`], [0, `${D()} ${STATS(500, 500)}`],
    ];
    const near = verdictOf(shot(10));
    expect(near).toMatchObject({ rule: "B10", cause: "pvp", confidence: "strong", mechanismStated: false });
    expect(near.attribution).toMatchObject({ role: "killer (inferred)", basis: "not_stated", dayzId: OTHER.id, confidence: "strong" });
    const far = verdictOf(shot(60));
    expect(far).toMatchObject({ rule: "B10", cause: "pvp", confidence: "inferred" });
    expect(far.attribution).toMatchObject({ basis: "not_stated", confidence: "inferred" });
    expect(verdictOf(shot(120))).toMatchObject({ rule: "B10", cause: "pvp", confidence: "inferred" });
    // HP 6 is not B10 (B11 takes it); 121 s is not B10 either
    expect(verdictOf(shot(60, 6)).rule).toBe("B11");
    expect(verdictOf(shot(121)).rule).toBe("B11");
    // the hit and the last reading are tested apart
    const reading = (hit: number, after: number): [number, string][] => [
      [-3000, `${V()} is connected`], [-400, `${V()}${READING(100)}`], [-60, `${V()}${SHOT(hit, 100 - hit)}`], [-50, `${V()}${READING(after)}`],
      [0, `${D()} ${STATS(500, 500)}`],
    ];
    expect(verdictOf(reading(5, 5)).rule).toBe("B10");
    expect(verdictOf(reading(6, 5)).rule).not.toBe("B10");
    expect(verdictOf(reading(5, 6)).rule).not.toBe("B10");
    // the player's hits must take at least half the HP lost in the window (50 silently, 50 to the shot)
    const share = (x: number): [number, string][] => [
      [-3000, `${V()} is connected`], [-400, `${V()}${READING(100)}`], [-300, `${V()}${READING(x)}`], [-30, `${V()}${SHOT(0.5, x - 0.5)}`],
      [-20, `${V()}${READING(0.5)}`], [0, `${D()} ${STATS(500, 500)}`],
    ];
    expect(verdictOf(share(50.5)).rule).toBe("B10");
    expect(verdictOf(share(50)).rule).not.toBe("B10");
  });

  it("a fall, a vehicle or a fire that left HP 5 or less is the cause, strong", () => {
    const hurt = (line: string): [number, string][] => [
      [-3000, `${V()} is connected`], [-400, `${V()}${READING(100)}`], [-30, `${V()}${line}`], [0, `${D()} ${STATS(500, 500)}`],
    ];
    expect(verdictOf(hurt("[HP: 3] hit by FallDamageHealth"))).toMatchObject({ rule: "B10", cause: "fall", confidence: "strong", attribution: null });
    expect(verdictOf(hurt("[HP: 3] hit by NO DRIVER with TransportHit (Motorbike_02_Yellow)"))).toMatchObject({ rule: "B10", cause: "vehicle_impact", confidence: "strong" });
    // fire hits carry no damage figure: ticks down to HP 3 leave the loss on the fire lines
    const F = (hp: number) => `[HP: ${hp}] hit by Fireplace with FireDamage`;
    expect(verdictOf([[-3000, `${V()} is connected`], [-400, `${V()}${READING(100)}`], [-38, `${V()}${F(80)}`], [-36, `${V()}${F(60)}`],
      [-34, `${V()}${F(40)}`], [-32, `${V()}${F(20)}`], [-30, `${V()}${F(3)}`], [0, `${D()} ${STATS(500, 500)}`]]))
      .toMatchObject({ rule: "B10", cause: "fire", confidence: "strong", attribution: null });
    expect(verdictOf(hurt("[HP: 6] hit by FallDamageHealth")).rule).not.toBe("B10");
  });
});

describe("B11: a player's hit, then nothing but ticks", () => {
  const shot = (age: number, hp: number, ko?: number): [number, string][] => [
    [-3000, `${V()} is connected`], [-age, `${V()}${SHOT(hp)}`],
    ...(ko != null ? [[-age + ko, `${V()} is unconscious`], [-age + ko + 30, `${V()} regained consciousness`]] as [number, string][] : []),
    [0, `${D()} ${STATS(500, 500)}`],
  ];
  it("within 300 s; strong at HP 25 or less or a knock-out within 2 s, else inferred", () => {
    expect(verdictOf(shot(300, 25))).toMatchObject({ rule: "B11", cause: "pvp", confidence: "strong" });
    expect(verdictOf(shot(300, 26))).toMatchObject({ rule: "B11", confidence: "inferred" });
    expect(verdictOf(shot(301, 25)).rule).not.toBe("B11");
    expect(verdictOf(shot(200, 50, 2))).toMatchObject({ rule: "B11", confidence: "strong" });
    expect(verdictOf(shot(200, 50, 3))).toMatchObject({ rule: "B11", confidence: "inferred" });
    expect(verdictOf(shot(200, 50, 0))).toMatchObject({ rule: "B11", confidence: "strong" });
    // a knock-out before the hit is not the hit's
    expect(verdictOf(shot(200, 50, -1))).toMatchObject({ rule: "B11", confidence: "inferred" });
  });
});

describe("B12: died while unconscious after a known knock-out", () => {
  const knocked = (hit: string): [number, string][] => [
    [-3000, `${V()} is connected`], [-20, `${V()}${hit}`], [-18, `${V()} is unconscious`], [0, `${D()} ${STATS(500, 500)}`],
  ];
  it("takes the knock-out's source as the cause, always inferred, never naming anyone printable", () => {
    expect(verdictOf(knocked(INF(30)))).toMatchObject({ rule: "B12", cause: "infected", confidence: "inferred", mechanismStated: false, attribution: null });
    expect(verdictOf(knocked(WOLF(30)))).toMatchObject({ rule: "B12", cause: "animal_wolf", confidence: "inferred" });
    expect(verdictOf(knocked("[HP: 30] hit by FallDamageHealth"))).toMatchObject({ rule: "B12", cause: "fall", confidence: "inferred" });
    // a player's knock-out more than 300 s before death (B11 does not reach it)
    const pvp = verdictOf([[-3000, `${V()} is connected`], [-400, `${V()}${SHOT(30)}`], [-398, `${V()} is unconscious`], [0, `${D()} ${STATS(500, 500)}`]]);
    expect(pvp).toMatchObject({ rule: "B12", cause: "pvp", confidence: "inferred" });
    expect(pvp.attribution).toMatchObject({ role: "knocked_out_by", basis: "not_stated", dayzId: OTHER.id });
    // the evidence is the knock-out's last hit, the knock-out and the death line
    expect(verdictOf(knocked(INF(30))).evidence.refs.map((r) => r.lineIndex)).toEqual([1, 2, 3]);
    expect(verdictOf([[-3000, `${V()} is connected`], [-30, `${V()}${INF(60)}`], [-20, `${V()}${INF(30)}`], [-18, `${V()} is unconscious`],
      [0, `${D()} ${STATS(500, 500)}`]]).evidence.refs.map((r) => r.lineIndex)).toEqual([2, 3, 4]);
  });

  it("a knock-out whose source is not strong falls through to later rules", () => {
    // nothing beside the knock-out: no source at all
    const v = verdictOf([[-3000, `${V()} is connected`], [-500, `${V()}`], [-100, `${V()} is unconscious`], [0, `${D()} ${STATS(500, 500)}`]]);
    expect(v.rule).not.toBe("B12");
  });
});

describe("B18: a creature that weakened the player is a lead, never the cause", () => {
  const weak = (hp: number): [number, string][] => [
    [-3000, `${V()} is connected`], [-300, `${V()}[HP: ${hp}] hit by Infected into Torso(0) for 20 damage (MeleeInfected)`], [0, `${D()} ${STATS(500, 500)}`],
  ];
  it("at HP 35, not at 35.1", () => {
    expect(verdictOf(weak(35))).toMatchObject({ rule: "B18", cause: "unknown", upstream: { cause: "infected" } });
    expect(verdictOf(weak(35.1))).toMatchObject({ rule: "B19", cause: "unknown", upstream: { cause: "infected" } });
  });
});

describe("vehicle speed", () => {
  // own positions 10 s apart, then the death 
  const ride = (metres: number): [number, string][] => [
    [-3000, `${V()} is connected`], [-10, `${V(1000)}`], [0, `${D(1000 + metres)} ${STATS(500, 500)}`],
  ];
  it("B15 at 10 m/s or more over a segment of 3 s or more; B17 from 8 m/s", () => {
    expect(verdictOf(ride(100))).toMatchObject({ rule: "B15", cause: "vehicle_crash_occupant", confidence: "inferred" });
    expect(verdictOf(ride(99))).toMatchObject({ rule: "B17", cause: "vehicle_crash_occupant" });
    expect(verdictOf(ride(80)).rule).toBe("B17");
    expect(verdictOf(ride(79)).rule).not.toBe("B17");
  });
});

describe("B22: pneumonia's silent drain band, 0.068 to 0.097 HP/s", () => {
  // One reading, then a silent fall to death: the final stretch's rate is hp / seconds.
  const drain = (hp: number, secs: number): [number, string][] => [
    [-3000, `${V()} is connected`], [-secs, `${V()}${READING(hp)}`], [0, `${D()} ${STATS(500, 500)}`],
  ];
  it("in the band is pneumonia, inferred; just outside it is not", () => {
    expect(verdictOf(drain(97, 1000))).toMatchObject({ rule: "B22", cause: "pneumonia", confidence: "inferred", mechanismStated: false });
    expect(verdictOf(drain(98, 1000)).rule).not.toBe("B22");
    expect(verdictOf(drain(68, 1000)).rule).toBe("B22");
    expect(verdictOf(drain(67, 1000)).rule).not.toBe("B22");
  });
  it("an earlier stretch faster than the band rules it out", () => {
    // 30 HP in 300 s (0.1 HP/s), then the last 70 in 1000 s (0.07 HP/s, in the band)
    const v = (first: number) => verdictOf([
      [-3000, `${V()} is connected`], [-1300, `${V()}${READING(100)}`], [-1000, `${V()}${READING(100 - first)}`],
      [0, `${D()} ${STATS(500, 500)}`],
    ]);
    expect(v(29).rule).toBe("B22");
    expect(v(30).rule).not.toBe("B22");
  });
  it("needs a stretch of 20 HP over 240 s", () => {
    expect(verdictOf(drain(20, 240)).rule).toBe("B22");
    expect(verdictOf(drain(19, 240)).rule).not.toBe("B22");
    expect(verdictOf(drain(20, 239)).rule).not.toBe("B22");
  });
});

describe("B20c: the cold burn from a known spawn", () => {
  // A respawn life of 400 online s: Water 600 untouched, Energy burned to `energy`.
  const life = (energy: number, water = 600, endX = 1000): [number, string][] => [
    ...RESPAWN, [-400, `${V()} is connected`], [-200, `${V()}`], [-100, `${V()}`], [0, `${D(endX)} ${STATS(water, energy)}`],
  ];
  it("Energy burned 0.2 to 0.6 per second faster than Water", () => {
    expect(verdictOf(life(520))).toMatchObject({ rule: "B20c", cause: "cold_exposure", confidence: "inferred" });   // 0.2
    expect(verdictOf(life(521)).rule).not.toBe("B20c");                                                             // 0.1975
    expect(verdictOf(life(360)).rule).toBe("B20c");                                                                 // 0.6
    expect(verdictOf(life(359)).rule).not.toBe("B20c");                                                             // 0.6025
  });
  it("needs 300 online seconds of life", () => {
    const short = (secs: number) => verdictOf([
      ...RESPAWN, [-secs, `${V()} is connected`], [-100, `${V()}`], [-50, `${V()}`], [0, `${D()} ${STATS(600, 600 - secs / 2)}`],
    ]);
    expect(short(300).rule).toBe("B20c");
    expect(short(299).rule).not.toBe("B20c");
  });
  it("strong on a cold map when the player stayed within 3 m", () => {
    expect(verdictOf(life(400, 600, 1003), "sakhal")).toMatchObject({ rule: "B20c", confidence: "strong" });
    expect(verdictOf(life(400, 600, 1003.5), "sakhal")).toMatchObject({ rule: "B20c", confidence: "inferred" });
  });
  it("stats above the table's levels on a fresh life mean the higher spawn set, 750/1000", () => {
    // Water 740, Energy 800 after 400 s: against 750/1000 a cold burn; against 600/600 Water rose.
    expect(verdictOf(life(800, 740))).toMatchObject({ rule: "B20c", cause: "cold_exposure" });
    const table = [{ from: "2020-01-01T00:00:00Z", water: 600, energy: 600 }];
    const lines = stamped(life(800, 740));
    const clusters = allClusters(lines.filter((l) => l.subject?.id === VICTIM.id));
    const ctx = new DeathContext(lines, { serverId: 1, map: "chernarusplus", cluster: clusters[clusters.length - 1]!, prevDeaths: [], spawnBaselines: table });
    expect(classifyDeath(ctx).rule).toBe("B20c");
    // stats at the levels (no override): Water rose from 600, so no cold burn
    expect(verdictOf(life(500, 601)).rule).not.toBe("B20c");
  });
});

describe("the stat-drain budget", () => {
  it("two drains give twice the cap: 63 HP in 600 s fits, 64 does not", () => {
    const at = (hp: number) => verdictOf([[-3000, `${V()} is connected`], [-600, `${V()}${READING(hp)}`], [0, `${D()} ${STATS(0, 0)}`]]);
    expect(at(63)).toMatchObject({ rule: "B09", cause: "starvation_and_dehydration", confidence: "strong" });
    expect(at(64)).toMatchObject({ rule: "B09", confidence: "inferred" });
  });
  it("a respawn life with no reading must fit 100 HP in its share of the life below 300", () => {
    // Energy 0 from 600: half the life below 300, at 0.05 HP/s: 4000 online s give exactly 100 HP.
    const life = (secs: number) => verdictOf([
      [-6000, `${D(900, 2000)} ${STATS(400, 300)}`], [-5998, `${D(900, 2000)} is choosing to respawn`],
      [-secs, `${V()} is connected`], [0, `${D()} ${STATS(500, 0)}`],
    ]);
    expect(life(4000)).toMatchObject({ rule: "B09", cause: "starvation", confidence: "strong" });
    expect(life(3990)).toMatchObject({ rule: "B09", confidence: "inferred" });
  });
});

describe("B21: a crash knock-out", () => {
  it("needs the player healthy before it: HP 80, not 79", () => {
    const ko = (hp: number) => verdictOf([
      [-3000, `${V()} is connected`], [-400, `${V()}${READING(hp)}`], [-300, `${V()} is unconscious`], [-285, `${V()} regained consciousness`],
      [0, `${D()} ${STATS(500, 500)}`],
    ]);
    expect(ko(80)).toMatchObject({ rule: "B21", cause: "vehicle_crash_occupant", confidence: "inferred" });
    expect(ko(79).rule).not.toBe("B21");
  });
  it("dead with no hit line after it, faster than 0.35 HP/s from a healthy reading", () => {
    const open = (secs: number) => verdictOf([
      [-3000, `${V()} is connected`], [-secs - 10, `${V()}${READING(100)}`], [-secs, `${V()} is unconscious`], [-secs + 30, `${V()} regained consciousness`],
      [0, `${D()} ${STATS(500, 500)}`],
    ]);
    expect(open(285).rule).toBe("B21");
    expect(open(286).rule).not.toBe("B21");
  });
});
