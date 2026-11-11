import { describe, it, expect } from "vitest";
import { allClusters, classifyDeath, DeathContext, type InternalVerdict, type StampedLine } from "../src/index.js";
import { at, ID, OTHER, stamped, THIRD, VICTIM, who } from "./lines.js";

/**
 * The stated rules on hand-built deaths. ⚠️ Every name, id and position here is invented.
 * The real deaths are checked by the private golden suites; these pin the edges real data does
 * not reach, and the promises a page relies on (who may ever be named).
 */
const V = (x = 1000, z = 2000) => who(VICTIM, at(x, z));
const D = (x = 1000, z = 2000) => who(VICTIM, at(x, z), true);
const STATS = (water = 500, energy = 500, bleed = 0) => `died. Stats> Water: ${water} Energy: ${energy} Bleed sources: ${bleed}`;
const INFECTED = (hp: number) => `[HP: ${hp}] hit by Infected into Torso(0) for 20 damage (MeleeInfected)`;
const TRIP = "[HP: 100] hit by TripwireTrap into (-1) for 0 damage (TripWireHit)";
const SHOT = (p: typeof OTHER, hp: number) => `[HP: ${hp}] hit by ${who(p, at(1040, 2000))} into Torso(0) for 40 damage (Bullet_556x45) with M4-A1 from 40 meters`;

function contextOf(lines: StampedLine[], map = "chernarusplus"): DeathContext {
  const clusters = allClusters(lines.filter((l) => l.subject?.id === VICTIM.id));
  return new DeathContext(lines, { serverId: 1, map, cluster: clusters[clusters.length - 1]!, prevDeaths: [] });
}
const verdictOf = (entries: [number, string][], map?: string): InternalVerdict => classifyDeath(contextOf(stamped(entries), map));

describe("a stated line wins", () => {
  it("a stated suicide beats infected hits in the last 120 s", () => {
    const v = verdictOf([
      [-600, `${V()} is connected`],
      [-30, `${V()}${INFECTED(60)}`], [-10, `${V()}${INFECTED(20)}`],
      [-3, `${V()} performed EmoteSuicide with SteakKnife`],
      [0, `${D()} ${STATS()}`], [0, `${D()} committed suicide`],
    ]);
    expect(v).toMatchObject({ rule: "B01", cause: "suicide", confidence: "definitive", mechanismStated: true, attribution: null });
    expect(v.object).toEqual({ key: null, className: null, text: "SteakKnife" });
    expect(v.evidence.flags).toEqual(["suicide_under_creature_attack", "method_blade"]);
    expect(v.conditions).toEqual(["hunted"]);
    expect(v.deathLines.map((l) => l.role)).toEqual(["primary", "suicide_after"]);
  });

  it("the firearm order (the living suicide line first) is still keyed on the died line", () => {
    const v = verdictOf([
      [-400, `${V()} is connected`], [-1, `${V()} committed suicide`], [0, `${D()} ${STATS(0.5, 0.2)}`],
    ]);
    expect(v).toMatchObject({ rule: "B01", cause: "suicide", deathRef: { admFileId: 7, lineIndex: 2 } });
    expect(v.evidence.flags).toEqual(["suicide_starving_or_dehydrated", "method_firearm"]);
    expect(v.conditions).toEqual(["starving", "dehydrated"]);
  });

  it("a player who wounded the victim before a suicide is context, never a killer", () => {
    const v = verdictOf([
      [-400, `${V()} is connected`], [-20, `${V()}${SHOT(OTHER, 20)}`],
      [-5, `${V()} performed EmoteSuicide with SteakKnife`], [0, `${D()} ${STATS()}`], [0, `${D()} committed suicide`],
    ]);
    expect(v.cause).toBe("suicide");
    expect(v.attribution).toBeNull();
    expect(v.evidence.contributors).toEqual([{ role: "last_attacker_before_suicide", dayzId: OTHER.id, gamertag: OTHER.name, confidence: "strong" }]);
    expect(v.evidence.flags).toContain("suicide_after_player_damage:downed");
    expect(v.evidence.flags).toContain("attacker_alive_at_suicide");
  });

  it("a death no stated rule claims is unknown, rule B00, with no post-pass", () => {
    const v = verdictOf([[-400, `${V()} is connected`], [-50, `${V()}${INFECTED(3)}`], [0, `${D()} ${STATS(0, 0)}`]]);
    expect(v).toMatchObject({ rule: "B00", cause: "unknown", confidence: "unknown", mechanismStated: false, attribution: null, upstream: null });
    expect(v.evidence.contributors).toEqual([]);
    expect(v.evidence.credit).toBeNull();
  });
});

describe("explosives on the kill line", () => {
  const FRAG_KILL = `${D()} killed by 6-M7 Frag Grenade`;
  const BLAST = `${D()}[HP: 0] hit by explosion (M67Grenade_Ammo)`;
  const placedBy = (p: typeof OTHER, x = 1001.5) => `${who(p, at(x, 2000))} placed Tripwire<TripwireTrap>`;

  it("a frag kill 4 s after the victim's TripWireHit is explosive_trap definitive", () => {
    const v = verdictOf([[-90000, placedBy(OTHER)], [-300, `${V()} is connected`], [-4, `${V()}${TRIP}`], [0, BLAST], [0, FRAG_KILL]]);
    expect(v).toMatchObject({ rule: "A07", cause: "explosive_trap", confidence: "definitive", mechanismStated: true });
    expect(v.object).toEqual({ key: "m67_grenade", className: "TripwireTrap", text: "Tripwire + M67 frag grenade" });
    expect(v.evidence.flags).toEqual(["fuse_4s"]);
  });

  it("3 s or 5 s after the trip is still the trap, but only strong; 6 s is a plain grenade", () => {
    const at3 = verdictOf([[-300, `${V()} is connected`], [-3, `${V()}${TRIP}`], [0, BLAST], [0, FRAG_KILL]]);
    const at5 = verdictOf([[-300, `${V()} is connected`], [-5, `${V()}${TRIP}`], [0, BLAST], [0, FRAG_KILL]]);
    const at6 = verdictOf([[-300, `${V()} is connected`], [-6, `${V()}${TRIP}`], [0, BLAST], [0, FRAG_KILL]]);
    const at2 = verdictOf([[-300, `${V()} is connected`], [-2, `${V()}${TRIP}`], [0, BLAST], [0, FRAG_KILL]]);
    expect([at3.rule, at3.confidence]).toEqual(["A07", "strong"]);
    expect([at5.rule, at5.confidence]).toEqual(["A07", "strong"]);
    expect(at6.rule).toBe("A08");
    expect(at2.rule).toBe("A08");
  });

  it("the trap owner has basis placement", () => {
    const v = verdictOf([[-90000, placedBy(OTHER)], [-300, `${V()} is connected`], [-4, `${V()}${TRIP}`], [0, BLAST], [0, FRAG_KILL]]);
    expect(v.attribution).toEqual({ role: "trap_owner", basis: "placement", dayzId: OTHER.id, gamertag: OTHER.name, confidence: "strong" });
  });

  it("two placers within 5 m: the nearest is named, inferred; a wire 5.1 m away has no owner", () => {
    const two = verdictOf([[-90000, placedBy(OTHER)], [-80000, placedBy(THIRD, 1003)], [-300, `${V()} is connected`], [-4, `${V()}${TRIP}`], [0, BLAST], [0, FRAG_KILL]]);
    expect(two.attribution).toMatchObject({ role: "trap_owner", dayzId: OTHER.id, confidence: "inferred", basis: "placement" });
    const far = verdictOf([[-90000, placedBy(OTHER, 1005.1)], [-300, `${V()} is connected`], [-4, `${V()}${TRIP}`], [0, BLAST], [0, FRAG_KILL]]);
    expect(far).toMatchObject({ rule: "A07", attribution: null });
  });

  it("the victim's own wire is theirs, and never a placement basis", () => {
    const v = verdictOf([[-900, `${V(1001)} placed Tripwire<TripwireTrap>`], [-4, `${V()}${TRIP}`], [0, BLAST], [0, FRAG_KILL]]);
    expect(v.attribution).toEqual({ role: "self (own device)", basis: "not_stated", dayzId: VICTIM.id, gamertag: VICTIM.name, confidence: "strong" });
  });

  it("a frag kill with no tripwire is explosive_grenade and names nobody", () => {
    const v = verdictOf([
      [-300, `${V()} is connected`], [-100, who(OTHER, at(1010, 2000))], [-30, who(OTHER, at(1010, 2000))], [0, BLAST], [0, FRAG_KILL],
    ]);
    expect(v).toMatchObject({ rule: "A08", cause: "explosive_grenade", confidence: "definitive", attribution: null });
    expect(v.object).toEqual({ key: "m67_grenade", className: "6-M7 Frag Grenade", text: "M67 frag grenade" });
    expect(v.evidence.flags).toEqual(["players_within_50m_60s"]);
    expect(v.evidence.contributors).toEqual([]);
  });

  it("a frag kill with nobody logged for 300 m and five minutes is probably their own, basis not_stated", () => {
    const v = verdictOf([[-3000, `${V()} is connected`], [0, BLAST], [0, FRAG_KILL]]);
    expect(v.attribution).toEqual({ role: "self (probable)", basis: "not_stated", dayzId: VICTIM.id, gamertag: VICTIM.name, confidence: "inferred" });
    expect(v.evidence.flags).toEqual(["isolated_300m_300s"]);
  });

  it("a claymore with the victim's TripWireHit in the same second is the trap; without it the trigger is unknown", () => {
    const CLAY_KILL = `${D()} killed by Claymore`, CLAY_BLAST = `${D()}[HP: 0] hit by explosion (ClaymoreMine_Ammo)`;
    const trap = verdictOf([[-90000, placedBy(OTHER)], [-300, `${V()} is connected`], [0, `${V()}${TRIP}`], [0, CLAY_BLAST], [0, CLAY_KILL]]);
    expect(trap).toMatchObject({ rule: "A06", cause: "explosive_trap", confidence: "definitive" });
    expect(trap.object?.text).toBe("Tripwire + Claymore");
    expect(trap.attribution).toMatchObject({ role: "trap_owner", basis: "placement", dayzId: OTHER.id });
    // a wire tripped two seconds earlier is not what set this claymore off
    expect(verdictOf([[-300, `${V()} is connected`], [-2, `${V()}${TRIP}`], [0, CLAY_BLAST], [0, CLAY_KILL]]).rule).toBe("A06b");
    const bare = verdictOf([[-300, `${V()} is connected`], [0, CLAY_BLAST], [0, CLAY_KILL]]);
    expect(bare).toMatchObject({ rule: "A06b", cause: "explosive_claymore", attribution: null });
    expect(bare.object?.text).toBe("Claymore");
    expect(bare.evidence.credit).toBeNull();
  });

  it("a land mine names the sole placer within 5 m with basis placement", () => {
    const v = verdictOf([
      [-90000, `${who(OTHER, at(1002, 2000))} placed Land Mine<LandMineTrap>`], [-300, `${V()} is connected`],
      [0, `${D()}[HP: 0] hit by explosion (LandMineExplosion_Ammo)`], [0, `${D()} killed by LandMineTrap`],
    ]);
    expect(v).toMatchObject({ rule: "A09", cause: "landmine", confidence: "definitive" });
    expect(v.object).toEqual({ key: "land_mine", className: "LandMineTrap", text: "Land mine" });
    expect(v.attribution).toMatchObject({ role: "trap_owner", basis: "placement", dayzId: OTHER.id, confidence: "strong" });
  });

  it("a plastic charge names its placer as an owner the page may never print", () => {
    const v = verdictOf([
      [-600, `${who(OTHER, at(1010, 2000))} placed Plastic Explosive<Plastic_Explosive>`], [-300, `${V()} is connected`],
      [0, `${D()}[HP: 0] hit by explosion (Plastic_Explosive_Ammo)`], [0, `${D()} killed by Plastic Explosive`],
    ]);
    expect(v).toMatchObject({ rule: "A10", cause: "explosive_charge" });
    expect(v.object?.text).toBe("Plastic explosive");
    expect(v.attribution).toMatchObject({ role: "trap_owner", basis: "not_stated", dayzId: OTHER.id });
    expect(v.evidence.credit).toBeNull();
  });

  it("an explosive on the kill line with no explosion and a fatal punch holding it is a player kill", () => {
    const v = verdictOf([
      [-300, `${V()} is connected`],
      [0, `${D()}[HP: 0] hit by ${who(OTHER, at(1001, 2000))} into Head(0) for 30 damage (MeleeFist) with 6-M7 Frag Grenade`],
      [0, `${D()} killed by 6-M7 Frag Grenade`],
    ]);
    expect(v).toMatchObject({ rule: "A05", cause: "pvp", confidence: "definitive" });
    expect(v.object?.text).toBe("fists holding 6-M7 Frag Grenade");
    expect(v.attribution).toEqual({ role: "killer", basis: "kill_line", dayzId: OTHER.id, gamertag: OTHER.name, confidence: "definitive" });
    expect(v.evidence.flags).toEqual(["pvp_fists_holding_item", "kill_line_drops_killer"]);
  });
});

describe("a player on the kill line", () => {
  const KILL = (p: typeof OTHER, rest: string) => `${D()} killed by ${who(p, at(1040, 2000))} ${rest}`;

  it("names the killer with basis kill_line, and other players of the last 120 s as assists", () => {
    const v = verdictOf([
      [-300, `${V()} is connected`], [-100, `${V()}${SHOT(THIRD, 60)}`], [-130, `${V()}${SHOT({ name: "Fourth Four", id: ID("4") }, 90)}`],
      [0, `${D()}[HP: 0] hit by ${who(OTHER, at(1040, 2000))} into Head(0) for 90 damage (Bullet_556x45) with M4-A1 from 40 meters`],
      [0, KILL(OTHER, "with M4-A1 from 40 meters")],
    ]);
    expect(v).toMatchObject({ rule: "A04", cause: "pvp", confidence: "definitive" });
    expect(v.attribution).toEqual({ role: "killer", basis: "kill_line", dayzId: OTHER.id, gamertag: OTHER.name, confidence: "definitive" });
    expect(v.object).toEqual({ key: null, className: null, text: "M4-A1" });
    expect(v.evidence.flags).toEqual(["headshot", "assist_other_player_hits", "pvp_firearm"]);
    expect(v.evidence.contributors).toEqual([{ role: "assist", dayzId: THIRD.id, gamertag: THIRD.name, confidence: "inferred" }]);
  });

  it("killer id equal to victim id is self_inflicted_explosive, or self_inflicted for a blade", () => {
    const m79 = verdictOf([[-300, `${V()} is connected`], [0, `${D()}[HP: 0] hit by explosion (Explosion_40mm_Ammo)`], [0, `${D()} killed by ${who(VICTIM)} with M79 from 0 meters`]]);
    expect(m79).toMatchObject({ rule: "A02", cause: "self_inflicted_explosive", confidence: "definitive" });
    expect(m79.object).toEqual({ key: "m79", className: null, text: "M79 (40mm explosive round)" });
    expect(m79.attribution).toEqual({ role: "self", basis: "kill_line_self", dayzId: VICTIM.id, gamertag: VICTIM.name, confidence: "definitive" });
    const held = verdictOf([[-300, `${V()} is connected`], [0, `${D()}[HP: 0] hit by explosion (M67Grenade_Ammo)`], [0, `${D()} killed by ${who(VICTIM)} with (MeleeFist)`]]);
    expect(held).toMatchObject({ rule: "A02", cause: "self_inflicted_explosive" });
    expect(held.object?.text).toBe("M67Grenade_Ammo");
    const blade = verdictOf([[-300, `${V()} is connected`], [0, `${D()} killed by ${who(VICTIM)} with SteakKnife`]]);
    expect(blade).toMatchObject({ rule: "A02", cause: "self_inflicted", confidence: "definitive" });
    expect(blade.object?.text).toBe("SteakKnife");
    expect(blade.attribution?.basis).toBe("kill_line_self");
    expect(blade.evidence.flags).toEqual(["self_kill"]);
  });

  it("fists on the kill line with a fatal explosion and no punch is a grenade that went off in the holder's hands", () => {
    const v = verdictOf([[-300, `${V()} is connected`], [0, `${D()}[HP: 0] hit by explosion (M67Grenade_Ammo)`], [0, KILL(OTHER, "with (MeleeFist)")]]);
    expect(v).toMatchObject({ rule: "A03", cause: "explosive_held_grenade", confidence: "strong" });
    expect(v.attribution).toEqual({ role: "grenade_holder", basis: "kill_line", dayzId: OTHER.id, gamertag: OTHER.name, confidence: "definitive" });
  });

  it("a player in the driver's seat is a driver, basis kill_line_driver, never a killer", () => {
    const v = verdictOf([[-300, `${V()} is connected`], [0, `${D()} killed by ${who(OTHER, at(1001, 2000))} (CivilianSedan)`]]);
    expect(v).toMatchObject({ rule: "A01", cause: "vehicle_run_over", confidence: "definitive" });
    expect(v.attribution).toEqual({ role: "driver", basis: "kill_line_driver", dayzId: OTHER.id, gamertag: OTHER.name, confidence: "definitive" });
    expect(v.object).toEqual({ key: "car", className: "CivilianSedan", text: "CivilianSedan" });
  });

  it("a kill by one punch on a victim someone else brought down is flagged as a finishing blow", () => {
    const v = verdictOf([
      [-300, `${V()} is connected`], [-200, `${V()}${SHOT(THIRD, 10)}`],
      [0, `${D()}[HP: 0] hit by ${who(OTHER, at(1001, 2000))} into Torso(0) for 12 damage (MeleeFist)`],
      [0, `${D()} killed by ${who(OTHER, at(1001, 2000))} with (MeleeFist)`],
    ]);
    expect(v.rule).toBe("A04");
    expect(v.evidence.flags).toEqual(["pvp_fists", "earlier_attacker_120_600s", "finishing_blow_only"]);
    expect(v.evidence.contributors).toEqual([{ role: "earlier_attacker", dayzId: THIRD.id, gamertag: THIRD.name, confidence: "inferred" }]);
    expect(v.attribution?.dayzId).toBe(OTHER.id);
  });
});

describe("the empty-killer forms and the things that are not players", () => {
  it("bullets with no owner name the shooter who had just gone down as an inferred killer, basis not_stated", () => {
    const v = verdictOf([
      [-300, `${V()} is connected`],
      [-20, `${who(THIRD, at(1100, 2000))}[HP: 50] hit by ${who(OTHER, at(1040, 2000))} into Torso(0) for 40 damage (Bullet_556x45) with M4-A1 from 60 meters`],
      [-2, `${who(OTHER, at(1040, 2000), true)} killed by ${who(VICTIM)} with Mosin from 40 meters`],
      [0, `${D()}[HP: 0] hit by M4-A1 into Head(0) for 90 damage (Bullet_556x45)`],
      [0, `${D()} killed by  with M4-A1 from 2236.07 meters`],
    ]);
    expect(v).toMatchObject({ rule: "A14", cause: "pvp", confidence: "strong", mechanismStated: true });
    expect(v.attribution).toEqual({ role: "killer (inferred)", basis: "not_stated", dayzId: OTHER.id, gamertag: OTHER.name, confidence: "strong" });
    expect(v.evidence.flags).toEqual(["ownerless_firearm"]);
  });

  it("with no such shooter the death is pvp, inferred, and names nobody", () => {
    const v = verdictOf([[-300, `${V()} is connected`], [0, `${D()} killed by  with M4-A1 from 2236.07 meters`]]);
    expect(v).toMatchObject({ rule: "A14", cause: "pvp", confidence: "inferred", attribution: null });
  });

  it("an infected or an animal class is the cause; a player who wounded the victim first is an assist", () => {
    const zed = verdictOf([[-300, `${V()} is connected`], [-60, `${V()}${SHOT(OTHER, 30)}`], [0, `${D()} killed by ZmbM_CitizenASkinny`]]);
    expect(zed).toMatchObject({ rule: "A15", cause: "infected", confidence: "definitive", attribution: null });
    expect(zed.object).toEqual({ key: null, className: "ZmbM_CitizenASkinny", text: "ZmbM_CitizenASkinny" });
    expect(zed.evidence.flags).toEqual(["player_damage_before_creature_kill", "assist_other_player_hits"]);
    expect(zed.evidence.contributors.map((x) => [x.role, x.dayzId])).toEqual([["assist", OTHER.id]]);
    for (const [cls, cause] of [["Animal_CanisLupus_Grey", "animal_wolf"], ["Animal_UrsusArctos", "animal_bear"], ["Animal_CanisFamiliaris_Doberman", "animal_dog"], ["Animal_SusScrofa", "animal_other"]]) {
      expect(verdictOf([[-300, `${V()} is connected`], [0, `${D()} killed by ${cls}`]]).cause).toBe(cause);
    }
  });

  it("a riderless motorbike after a knock-out is the victim's own crash; without one it is an impact", () => {
    const hit = `${V()}[HP: 30] hit by NO DRIVER with TransportHit (Motorbike_02_Yellow)`;
    const own = verdictOf([[-300, `${V()} is connected`], [-1, `${V()} is unconscious`], [-1, hit], [0, `${D()} killed by NO DRIVER (Motorbike_02_Yellow)`]]);
    expect(own).toMatchObject({ rule: "A16", cause: "vehicle_own_crash", confidence: "strong" });
    expect(own.object).toEqual({ key: "motorbike", className: "Motorbike_02_Yellow", text: "Motorbike_02_Yellow" });
    const impact = verdictOf([[-300, `${V()} is connected`], [-1, hit], [0, `${D()} killed by NO DRIVER (Motorbike_02_Yellow)`]]);
    expect(impact).toMatchObject({ rule: "A17", cause: "vehicle_impact", confidence: "definitive" });
  });

  it("a fireplace, a fuel pump and a loose 40mm round each have their rule", () => {
    const fire = verdictOf([[-300, `${V(1001)} placed Fireplace<Fireplace>`], [-5, `${V()}[HP: 10] hit by Fireplace with FireDamage`], [0, `${D()} killed by  with Fireplace`]]);
    expect(fire).toMatchObject({ rule: "A13", cause: "fire", confidence: "definitive" });
    expect(fire.attribution).toMatchObject({ role: "self (own fire)", basis: "not_stated", confidence: "inferred" });
    const pump = verdictOf([[-300, `${V()} is connected`], [0, `${D()}[HP: 0] hit by explosion (LandFuelFeed_Ammo)`], [0, `${D()} killed by Land_FuelStation_Feed`]]);
    expect(pump).toMatchObject({ rule: "A11", cause: "fuel_explosion", attribution: null });
    expect(pump.object?.key).toBe("fuel_pump");
    const round = verdictOf([[-3000, `${V()} is connected`], [0, `${D()}[HP: 0] hit by explosion (Explosion_40mm_Ammo)`], [0, `${D()} killed by  with 40mm Explosive Grenade`]]);
    expect(round).toMatchObject({ rule: "A12", cause: "explosive_40mm", confidence: "definitive" });
    expect(round.object).toEqual({ key: "round_40mm", className: null, text: "40mm explosive round" });
    expect(round.evidence.flags).toEqual(["single_round", "isolated_300m_300s"]);
  });
});

describe("a bare death line with a stated mechanism", () => {
  it("drowned is drowned; a fall just before the knock-out is upstream", () => {
    const v = verdictOf([
      [-300, `${V()} is connected`], [-20, `${V()}[HP: 30] hit by FallDamageHealth`], [-18, `${V()} is unconscious`],
      [0, `${D()} drowned. Stats> Water: 500 Energy: 500 Bleed sources: 0`],
    ]);
    expect(v).toMatchObject({ rule: "B02", cause: "drowned", confidence: "definitive", upstream: { cause: "fall", confidence: "strong" } });
  });

  it("an HP-0 fall line before the death line is a fall, definitive; after it, only strong", () => {
    const before = verdictOf([[-300, `${V()} is connected`], [0, `${D()}[HP: 0] hit by FallDamageHealth`], [0, `${D()} ${STATS()}`]]);
    expect(before).toMatchObject({ rule: "B03", cause: "fall", confidence: "definitive", upstream: null });
    const after = verdictOf([[-300, `${V()} is connected`], [0, `${D()} ${STATS()}`], [0, `${D()}[HP: 0] hit by FallDamageHealth`]]);
    expect(after).toMatchObject({ rule: "B03", cause: "fall", confidence: "strong" });
    expect(after.evidence.flags).toEqual(["fall_line_after_death"]);
  });

  it("a fall at vehicle speed has a vehicle upstream", () => {
    const v = verdictOf([
      [-300, `${V(700, 2000)} is connected`], [-10, V(850, 2000)],
      [0, `${D()}[HP: 0] hit by FallDamageHealth`], [0, `${D()} ${STATS()}`],
    ]);
    expect(v).toMatchObject({ rule: "B03", cause: "fall", upstream: { cause: "vehicle", confidence: "inferred" } });
    expect(v.evidence.flags).toEqual(["fall_at_vehicle_speed", "vehicle_death_inventory"]);
  });

  it("a restrained logout is stated; whoever stood beside the victim is a lead only", () => {
    const v = verdictOf([
      [-900, `${V()} is connected`], [-400, V()], [-390, who(OTHER, at(1003, 2000))], [-100, V()],
      [0, `${V()} is disconnecting while being restrained`], [0, `${D()} ${STATS()}`],
    ]);
    expect(v).toMatchObject({ rule: "B04", cause: "restrained_logout", confidence: "definitive", attribution: null, upstream: null });
    expect(v.evidence.contributors).toEqual([{ role: "possible_restrainer", dayzId: OTHER.id, gamertag: OTHER.name, confidence: "inferred" }]);
  });

  it("a logout while unconscious keeps the logout as the cause and the knock-out source upstream", () => {
    const v = verdictOf([
      [-300, `${V()} is connected`], [-40, `${V()}${INFECTED(40)}`], [-39, `${V()} is unconscious`],
      [0, `${V()} is disconnecting while being unconscious`], [0, `${D()} ${STATS()}`],
    ]);
    expect(v).toMatchObject({ rule: "B05", cause: "unconscious_logout", confidence: "definitive", upstream: { cause: "infected", confidence: "strong" }, attribution: null });
  });

  it("a player who knocked the victim out before the logout is knocked_out_by, basis not_stated", () => {
    const v = verdictOf([
      [-300, `${V()} is connected`], [-40, `${V()}${SHOT(OTHER, 20)}`], [-39, `${V()} is unconscious`],
      [0, `${V()} is disconnecting while being unconscious`], [0, `${D()} ${STATS()}`],
    ]);
    expect(v).toMatchObject({ rule: "B05", upstream: { cause: "player", confidence: "strong" } });
    expect(v.attribution).toEqual({ role: "knocked_out_by", basis: "not_stated", dayzId: OTHER.id, gamertag: OTHER.name, confidence: "strong" });
  });

  it("EmoteSitA 15 s before the marker is logout_under_attack strong", () => {
    const v = verdictOf([
      [-300, `${V()} is connected`], [-15, `${V()} performed EmoteSitA`], [-8, `${V()}${INFECTED(40)}`], [-7, `${V()} is unconscious`],
      [0, `${V()} is disconnecting while being unconscious`], [0, `${D()} ${STATS()}`],
    ]);
    expect(v).toMatchObject({ rule: "B05c", cause: "logout_under_attack", confidence: "strong", upstream: { cause: "infected", confidence: "strong" } });
    expect(v.evidence.flags).toEqual(["attacked_after_logout_started", "logout_sit_before_knockout"]);
  });

  it("a sit 12 s or 18 s before the marker is not the logout sit", () => {
    for (const dt of [-12, -18]) {
      const v = verdictOf([
        [-300, `${V()} is connected`], [dt, `${V()} performed EmoteSitA`], [-8, `${V()}${INFECTED(40)}`], [-7, `${V()} is unconscious`],
        [0, `${V()} is disconnecting while being unconscious`], [0, `${D()} ${STATS()}`],
      ]);
      expect(v.rule).toBe("B05");
    }
  });

  it("disconnected under creature attack with no open knock-out is logout_under_attack", () => {
    const v = verdictOf([
      [-300, `${V()} is connected`], [-20, `${V()}${INFECTED(60)}`], [-15, `${V()} has been disconnected`], [-10, `${V()}${INFECTED(30)}`],
      [0, `${V()} is disconnecting while being unconscious`], [0, `${D()} ${STATS()}`],
    ]);
    expect(v).toMatchObject({ rule: "B05b", cause: "logout_under_attack", confidence: "strong", upstream: { cause: "infected", confidence: "strong" } });
    expect(v.evidence.flags).toEqual(["logged_out_under_attack"]);
  });

  it("the alive-form respawn line is B06", () => {
    const v = verdictOf([
      [-300, `${V()} is connected`], [-40, `${V()}${INFECTED(40)}`], [-39, `${V()} is unconscious`],
      [-1, `${V()} is choosing to respawn`], [0, `${D()} ${STATS()}`],
    ]);
    expect(v).toMatchObject({ rule: "B06", cause: "respawn_while_unconscious", confidence: "definitive", upstream: { cause: "infected", confidence: "strong" } });
  });

  it("the (DEAD) respawn form is not B06", () => {
    const v = verdictOf([
      [-300, `${V()} is connected`], [-40, `${V()}${INFECTED(40)}`], [-39, `${V()} is unconscious`],
      [0, `${D()} ${STATS()}`], [1, `${D()} is choosing to respawn`],
    ]);
    expect(v.rule).not.toBe("B06");
    expect(v.cause).not.toBe("respawn_while_unconscious");
    expect(v.rule).toBe("B00");
  });

  it("an HP-0 blow before a bare died line is pvp with killer (inferred) and basis not_stated", () => {
    const v = verdictOf([
      [-300, `${V()} is connected`], [-5, `${V()}${SHOT(OTHER, 30)}`],
      [0, `${D()}[HP: 0] hit by ${who(OTHER, at(1040, 2000))} into Torso(0) for 40 damage (Bullet_556x45) with M4-A1 from 40 meters`],
      [0, `${D()} ${STATS()}`],
    ]);
    expect(v).toMatchObject({ rule: "B07", cause: "pvp", confidence: "strong", mechanismStated: false });
    expect(v.attribution).toEqual({ role: "killer (inferred)", basis: "not_stated", dayzId: OTHER.id, gamertag: OTHER.name, confidence: "strong" });
    expect(v.object?.text).toBe("M4-A1");
    expect(v.evidence.flags).toEqual(["no_kill_line"]);
  });

  it("the same blow written after the died line is a hit on a corpse, not B07", () => {
    const v = verdictOf([
      [-300, `${V()} is connected`], [0, `${D()} ${STATS()}`],
      [0, `${D()}[HP: 0] hit by ${who(OTHER, at(1040, 2000))} into Torso(0) for 40 damage (Bullet_556x45) with M4-A1 from 40 meters`],
    ]);
    expect(v.rule).toBe("B00");
    expect(v.attribution).toBeNull();
  });

  it("a bleed-out after one player's hits is pvp_bleedout, and that player is not a kill-line killer", () => {
    const v = verdictOf([
      [-600, `${V()} is connected`], [-100, `${V()}${SHOT(OTHER, 30)}`], [0, `${D()} ${STATS(500, 500, 2)}`], [0, `${D()} bled out`],
    ]);
    expect(v).toMatchObject({ rule: "B08a", cause: "pvp_bleedout", confidence: "strong", upstream: { cause: "player", confidence: "strong" } });
    expect(v.attribution).toEqual({ role: "killer (inferred, bleed-out)", basis: "not_stated", dayzId: OTHER.id, gamertag: OTHER.name, confidence: "strong" });
  });

  it("a bleed-out after infected wounds, after wire, and with nothing open", () => {
    const infected = verdictOf([[-600, `${V()} is connected`], [-100, `${V()}${INFECTED(30)}`], [0, `${D()} ${STATS(500, 500, 1)}`], [0, `${D()} bled out`]]);
    expect(infected).toMatchObject({ rule: "B08b", cause: "bled_out_infected", confidence: "strong", upstream: { cause: "infected", confidence: "strong" } });
    const wire = verdictOf([[-600, `${V()} is connected`], [-100, `${V()}[HP: 30] hit by Fence with BarbedWireHit`], [0, `${D()} ${STATS(500, 500, 1)}`], [0, `${D()} bled out`]]);
    expect(wire).toMatchObject({ rule: "B08c", cause: "bled_out_barbed_wire", confidence: "strong" });
    expect(wire.object).toEqual({ key: "barbed_wire", className: "Fence", text: "Barbed wire (Fence)" });
    const none = verdictOf([[-600, `${V()} is connected`], [0, `${D()} ${STATS(0, 500, 0)}`], [0, `${D()} bled out`]]);
    expect(none).toMatchObject({ rule: "B08d", cause: "bled_out_other", confidence: "definitive", upstream: { cause: "unknown", confidence: "unknown" }, coCauses: ["dehydration"] });
  });
});

describe("the post-pass", () => {
  it("a trap that wounded the victim before a kill is a co-cause, and its sole placer a contributor", () => {
    const v = verdictOf([
      [-9000, `${who(THIRD, at(1001, 2000))} placed Bear Trap<BearTrap>`], [-300, `${V()} is connected`],
      [-60, `${V()}[HP: 20] hit by BearTrap into LeftLeg(0) for 60 damage (BearTrapHit)`],
      [0, `${D()} killed by ${who(OTHER, at(1040, 2000))} with M4-A1 from 40 meters`],
    ]);
    expect(v.rule).toBe("A04");
    expect(v.coCauses).toEqual(["bear_trap"]);
    expect(v.evidence.flags).toEqual(["pvp_firearm", "non_player_damage_before_kill"]);
    expect(v.evidence.contributors).toEqual([{ role: "trap_owner (co-cause)", dayzId: THIRD.id, gamertag: THIRD.name, confidence: "inferred" }]);
    expect(v.attribution?.dayzId).toBe(OTHER.id);
  });

  it("a kill on an unconscious victim, or seconds after they connected, is flagged", () => {
    const v = verdictOf([
      [-8, `${V()} is connected`], [-3, `${V()} is unconscious`], [0, `${D()} killed by ${who(OTHER, at(1040, 2000))} with M4-A1 from 40 meters`],
    ]);
    expect(v.evidence.flags).toEqual(["pvp_firearm", "victim_unconscious_before_kill", "killed_within_10s_of_spawn_in"]);
  });

  it("the heat faint cycle is a co-cause of any stated death; on a sand map it cannot be told from silicosis", () => {
    const faints: [number, string][] = [
      [-3000, `${V()} is connected`],
      [-200, `${V()} is unconscious`], [-190, `${V()} regained consciousness`],
      [-100, `${V()} is unconscious`], [-90, `${V()} regained consciousness`],
      [0, `${D()}[HP: 0] hit by FallDamageHealth`], [0, `${D()} ${STATS()}`],
    ];
    // the invented day of these lines is after the build that brought heatstroke
    expect(verdictOf(faints)).toMatchObject({ rule: "B03", cause: "fall", coCauses: ["heatstroke"] });
    expect(verdictOf(faints, "nasdara")).toMatchObject({ rule: "B03", coCauses: ["heatstroke_or_silicosis"] });
    expect(verdictOf(faints).evidence.flags).toContain("heat_faint_cycle");
    const one = faints.filter(([dt]) => dt !== -200 && dt !== -190);
    expect(verdictOf(one).coCauses).toEqual([]);
    // a death no rule has answered yet gets no post-pass: nothing is added to an unknown
    const unknown = verdictOf(faints.filter(([, text]) => !text.includes("FallDamageHealth")));
    expect(unknown).toMatchObject({ rule: "B00", coCauses: [] });
    expect(unknown.evidence.flags).toEqual([]);
  });

  it("evidence lines carry their role in the death, or the kind of line they are", () => {
    const v = verdictOf([[-300, `${V()} is connected`], [0, `${D()}[HP: 0] hit by FallDamageHealth`], [0, `${D()} ${STATS()}`]]);
    expect(v.evidence.refs).toEqual([{ admFileId: 7, lineIndex: 1, role: "hit" }, { admFileId: 7, lineIndex: 2, role: "primary" }]);
    expect(v.deathAt).toBe("2031-03-10T12:00:00Z");
  });
});

describe("only a kill line makes a name printable", () => {
  it("across every hand-built death here, a kill_line basis only ever comes from rules A03, A04 and A05", () => {
    const deaths: [number, string][][] = [
      [[-300, `${V()} is connected`], [0, `${D()} killed by ${who(OTHER)} with M4-A1 from 40 meters`]],
      [[-300, `${V()} is connected`], [0, `${D()} killed by ${who(OTHER)} (CivilianSedan)`]],
      [[-300, `${V()} is connected`], [0, `${D()} killed by ${who(VICTIM)} with SteakKnife`]],
      [[-900, `${who(OTHER, at(1001, 2000))} placed Land Mine<LandMineTrap>`], [0, `${D()} killed by LandMineTrap`]],
      [[-300, `${V()} is connected`], [-5, `${V()}${SHOT(OTHER, 30)}`], [0, `${D()} ${STATS(500, 500, 2)}`], [0, `${D()} bled out`]],
    ];
    const seen = deaths.map((d) => { const v = verdictOf(d); return `${v.rule}:${v.attribution?.basis}`; });
    expect(seen).toEqual(["A04:kill_line", "A01:kill_line_driver", "A02:kill_line_self", "A09:placement", "B08a:not_stated"]);
  });
});
