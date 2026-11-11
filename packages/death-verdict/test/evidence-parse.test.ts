import { describe, it, expect } from "vitest";
import { isDetonation, isRespawnMarker, parseEvidenceLine, parsePos } from "../src/index.js";
import { at, ID, OTHER, VICTIM, who } from "./lines.js";

const parse = (rest: string) => parseEvidenceLine(7, 3, `12:34:56 | ${rest}`);
const V = who(VICTIM), VDEAD = who(VICTIM, at(1000, 2000), true), K = who(OTHER, at(1010, 2000));

describe("parseEvidenceLine: one invented line per shape", () => {
  it("reads the clock, the subject, every id and every position", () => {
    const l = parse(`${V}[HP: 55.5] hit by ${K} into Torso(0) for 30 damage (Bullet_556x45) with M4-A1 from 35.2 meters`);
    expect(l.clock).toEqual({ h: 12, m: 34, s: 56 });
    expect(l.subject).toEqual({ id: VICTIM.id, name: VICTIM.name, dead: false, pos: [1000, 2000, 10] });
    expect(l.ids).toEqual([VICTIM.id, OTHER.id]);
    expect(l.positions).toEqual([[1000, 2000, 10], [1010, 2000, 10]]);
    expect({ admFileId: l.admFileId, lineIndex: l.lineIndex }).toEqual({ admFileId: 7, lineIndex: 3 });
  });

  it("altitude is the third pos component", () => {
    expect(parse(`${who(VICTIM, "<4500.5, 10200.25, 312.75>")}`).subject!.pos).toEqual([4500.5, 10200.25, 312.75]);
    expect(parsePos("1.0, 2.0")).toBeNull();
    // the sentinel the server prints for a player it cannot place
    expect(parsePos("340282346638528859811704183484516925440.0, 0.0, 0.0")).toBeNull();
    // off the map but finite: kept
    expect(parsePos("-2500.0, 100.0, 3.0")).toEqual([-2500, 100, 3]);
  });

  it("names every kind of line", () => {
    const kinds = (rest: string) => parse(rest).kind;
    expect(kinds(V)).toBe("playerlist");
    expect(kinds(`${VDEAD} died. Stats> Water: 512.5 Energy: 0 Bleed sources: 1`)).toBe("died");
    expect(kinds(`${VDEAD} drowned. Stats> Water: 512.5 Energy: 300 Bleed sources: 0`)).toBe("drowned");
    expect(kinds(`${V} has drowned while unconscious`)).toBe("drowned_uncon");
    expect(kinds(`${VDEAD} bled out`)).toBe("bled_out");
    expect(kinds(`${V} committed suicide`)).toBe("suicide");
    expect(kinds(`${V} is choosing to respawn`)).toBe("respawn");
    expect(kinds(`${V} is disconnecting while being unconscious`)).toBe("disc_uncon");
    expect(kinds(`${V} is disconnecting while being restrained`)).toBe("disc_restrained");
    expect(kinds(`${V} is connected`)).toBe("connected");
    expect(kinds(`${V} is connecting`)).toBe("connecting");
    expect(kinds(`${V} has been disconnected`)).toBe("disconnected");
    expect(kinds(`${V} is unconscious`)).toBe("unconscious");
    expect(kinds(`${V} regained consciousness`)).toBe("regained");
    expect(kinds(`${V} placed Tripwire<TripwireTrap>`)).toBe("placed");
    expect(kinds(`${V} performed EmoteSitA`)).toBe("emote");
    expect(kinds(`${V} was teleported from: <1.0, 2.0, 3.0> to: <4.0, 5.0, 6.0>. Reason: Spawning`)).toBe("teleported");
    expect(kinds(`${V} Built Wall on Fence`)).toBe("other");
    expect(kinds("##### PlayerList log: 3 players")).toBe("structural");
    expect(parseEvidenceLine(7, 0, "AdminLog started on 2031-03-10 at 12:00:00").kind).toBe("nontime");
  });

  it("the server's ERROR id is kept verbatim and names no player", () => {
    const l = parse(`Player "Unknown" (id=ERROR) is connecting`);
    expect(l.subject!.id).toBe("ERROR");
    expect(l.ids).toEqual([]);
  });

  it("reads the stats of a bare death, a placement and an emote", () => {
    expect(parse(`${VDEAD} died. Stats> Water: 512.5 Energy: 0 Bleed sources: 2`).stats).toEqual({ water: 512.5, energy: 0, bleedSources: 2 });
    expect(parse(`${V} placed Land Mine<LandMineTrap>`).placed).toEqual({ display: "Land Mine", className: "LandMineTrap" });
    expect(parse(`${V} performed EmoteSuicide with SteakKnife`).emote).toEqual({ name: "EmoteSuicide", item: "SteakKnife" });
    expect(parse(`${V} performed EmoteSitA`).emote).toEqual({ name: "EmoteSitA", item: null });
  });

  it("the (DEAD) respawn line is not a respawn marker", () => {
    expect(isRespawnMarker(parse(`${V} is choosing to respawn`))).toBe(true);
    const dead = parse(`${VDEAD} is choosing to respawn`);
    expect(dead.kind).toBe("respawn");
    expect(isRespawnMarker(dead)).toBe(false);
  });
});

describe("parseEvidenceLine: hits", () => {
  const hit = (rest: string, subject = V) => parse(`${subject}[HP: ${rest}`).hit!;

  it("a hit by another player names the attacker, the ammo, the weapon, the range and the zone", () => {
    const h = hit(`55.5] hit by ${K} into Torso(0) for 30 damage (Bullet_556x45) with M4-A1 from 35.2 meters`);
    expect(h).toMatchObject({
      hp: 55.5, damage: 30, damaging: true, label: "player", category: "player", ammo: "Bullet_556x45",
      weapon: "M4-A1", distance: 35.2, zone: "Torso", attacker: { id: OTHER.id, name: OTHER.name, dead: false },
    });
  });
  it("a hit by the victim's own id is self, whatever the name says", () => {
    expect(hit(`10] hit by ${who({ name: "Renamed", id: VICTIM.id })} into Head(0) for 90 damage (MeleeFist)`).category).toBe("self");
  });
  it("a hit with a driver named is a vehicle hit by that driver", () => {
    const h = hit(`20] hit by ${K} with TransportHit (Sedan_02)`);
    expect(h).toMatchObject({ category: "vehicle_driver", weapon: "vehicle:Sedan_02", ammo: "TransportHit", damage: null, damaging: true });
  });
  it("creatures, traps, falls, explosions, vehicles and objects each have their label", () => {
    expect(hit("80] hit by Infected into LeftArm(13) for 12 damage (MeleeInfected)")).toMatchObject({ category: "infected", source: "Infected", zone: "LeftArm", damage: 12 });
    expect(hit("70] hit by Wolf into RightLeg(4) for 20 damage (MeleeWolf)").category).toBe("animal");
    expect(hit("70] hit by Brown Bear into Torso(4) for 60 damage (MeleeBear)").category).toBe("animal");
    expect(hit("60] hit by BearTrap into LeftLeg(2) for 25 damage (BearTrapHit)")).toMatchObject({ category: "trap", source: "BearTrap" });
    expect(hit("0] hit by FallDamageHealth")).toMatchObject({ category: "fall", ammo: "FallDamageHealth", damaging: true });
    expect(hit("0] hit by explosion (M67Grenade_Ammo)")).toMatchObject({ category: "explosion", ammo: "M67Grenade_Ammo" });
    expect(hit("30] hit by NO DRIVER with TransportHit (Motorbike_02_Yellow)")).toMatchObject({ category: "vehicle_no_driver", source: "Motorbike_02_Yellow" });
    expect(hit("30] hit by Sedan_02 with TransportHit")).toMatchObject({ category: "vehicle", source: "Sedan_02" });
    expect(hit("90] hit by Fireplace with FireDamage").category).toBe("fire");
    expect(hit("90] hit by Fence with BarbedWireHit").category).toBe("barbed_wire");
    expect(hit("90] hit by M16A2 into Torso(0) for 30 damage (Bullet_556x45)").category).toBe("ownerless_weapon");
    expect(hit("90] hit by something nobody has seen").category).toBe("unparsed");
  });
  it("Dummy_Light and TripWireHit are HP readings, not damage", () => {
    const dummy = hit("42] hit by Infected into Torso(0) for 0 damage (Dummy_Light)");
    expect(dummy).toMatchObject({ hp: 42, damage: 0, damaging: false });
    const trip = hit("100] hit by TripwireTrap into (0) for 0 damage (TripWireHit)");
    expect(trip).toMatchObject({ hp: 100, damaging: false, category: "trap", source: "TripwireTrap", ammo: "TripWireHit" });
    // and a 0-damage line of any ammo takes nothing either
    expect(hit("42] hit by Infected into Torso(0) for 0 damage (MeleeInfected)").damaging).toBe(false);
  });
  it("a tripwire's own line is a detonation of a tripwire and of nothing else", () => {
    const trip = parse(`${V}[HP: 100] hit by TripwireTrap into (0) for 0 damage (TripWireHit)`);
    expect(isDetonation(trip, "TripwireTrap")).toBe(true);
    expect(isDetonation(trip, "LandMineTrap")).toBe(false);
  });
  it("a mine blast written as LandMineExplosion_Ammo is a detonation line", () => {
    expect(isDetonation(parse(`${V}[HP: 0] hit by explosion (LandMineExplosion_Ammo)`), "LandMineTrap")).toBe(true);
    expect(isDetonation(parse(`${V}[HP: 0] hit by explosion (LandMineExplosion)`), "LandMineTrap")).toBe(true);
    expect(isDetonation(parse(`${V}[HP: 0] hit by explosion (M67Grenade_Ammo)`), "LandMineTrap")).toBe(false);
    expect(isDetonation(parse(`${V} placed Land Mine<LandMineTrap>`), "LandMineTrap")).toBe(false);
  });
});

describe("parseEvidenceLine: the kill line", () => {
  const killer = (rest: string) => parse(`${VDEAD} killed by ${rest}`).killer!;

  it("a player with a weapon and a range", () => {
    expect(killer(`${K} with M4-A1 from 35.2 meters`)).toMatchObject({
      form: "player", kind: "player", id: OTHER.id, name: OTHER.name, weapon: "M4-A1", distance: 35.2, self: false, dead: false,
    });
  });
  it("a player who was dead by then keeps the flag", () => {
    expect(killer(`${who(OTHER, at(1010, 2000), true)} with M4-A1 from 35.2 meters`).dead).toBe(true);
  });
  it("the victim's own id is a self kill", () => {
    expect(killer(`${who({ name: "Renamed", id: VICTIM.id })} with M79 from 0 meters`)).toMatchObject({ self: true, weapon: "M79", distance: 0 });
  });
  it("a player in a driver's seat", () => {
    expect(killer(`${K} (Sedan_02)`)).toMatchObject({ form: "player", kind: "vehicle_driver", vehicleClass: "Sedan_02", weapon: "Sedan_02" });
  });
  it("the empty-killer form is three different things", () => {
    expect(killer(" with 40mm Explosive Grenade")).toMatchObject({ form: "empty", kind: "unnamed", subkind: "explosive_item", id: null });
    expect(killer(" with Fireplace")).toMatchObject({ subkind: "fire" });
    // ⚠️ the "range" of an ownerless firearm is the distance to the map origin: never a range
    expect(killer(" with KA-74 from 5123.4 meters")).toMatchObject({ subkind: "ownerless_firearm", distance: null, distanceRaw: 5123.4 });
  });
  it("no driver, and the classes that stand where a player would", () => {
    expect(killer("NO DRIVER (Motorbike_02_Yellow)")).toMatchObject({ form: "no_driver", kind: "vehicle_no_driver", vehicleClass: "Motorbike_02_Yellow" });
    expect(killer("ZmbM_PatrolNormal_Autumn")).toMatchObject({ form: "entity", kind: "infected", entity: "ZmbM_PatrolNormal_Autumn" });
    expect(killer("Animal_CanisLupus_Grey").kind).toBe("animal");
    expect(killer("LandMineTrap")).toMatchObject({ kind: "explosive", weapon: "LandMineTrap" });
    expect(killer("6-M7 Frag Grenade").kind).toBe("explosive");
    expect(killer("CivilianSedan").kind).toBe("vehicle");
    expect(killer("Something_Else").kind).toBe("entity_other");
  });
  it("ids are told apart by the 40-hex id, never by the name", () => {
    expect(killer(`${who({ name: VICTIM.name, id: ID("9") })} with Fists`).self).toBe(false);
  });
});
