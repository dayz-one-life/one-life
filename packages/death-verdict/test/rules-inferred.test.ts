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
