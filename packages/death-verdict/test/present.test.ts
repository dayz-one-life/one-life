import { describe, it, expect, afterEach } from "vitest";
import {
  CAPTION, CREDIT_DIRECTIVE, INFERRED_CAUSE_DIRECTIVE, INTERNAL_CAUSES, NAMES_NO_PERSON_DIRECTIVE, PUBLIC_INFERRED,
  STRONG_CAUSE_DIRECTIVE, WITHHELD_DIRECTIVE, directivesFor, pendingPublicDeath, promptLine, toPublicDeath,
  type AttributionBasis, type Confidence, type InferredFamily, type LifeDeathFacts, type ObjectKey, type PublicDeath,
  type StoredVerdict, type TrapCredit,
} from "../src/index.js";

// Invented people. Nobody here is a real player.
const KILLER = "Killer One";
const PLACER = "Placer One";

const verdict = (over: Partial<StoredVerdict> & Pick<StoredVerdict, "cause">): StoredVerdict => ({
  confidence: "definitive", mechanismStated: true, objectKey: null, upstream: null, attrBasis: null, conditions: [], ...over,
});
const life = (over: Partial<LifeDeathFacts> = {}): LifeDeathFacts => ({
  deathCause: "died", deathByGamertag: null, deathWeapon: null, deathDistance: null, ...over,
});
const pvpLife = life({ deathCause: "pvp", deathByGamertag: KILLER, deathWeapon: "M4-A1", deathDistance: 211.6 });
const credit: TrapCredit = { gamertag: PLACER, device: "tripwire", byOperator: false };

/** Every string of a public death, for "this name is nowhere in it". */
const textOf = (p: PublicDeath) => JSON.stringify(p);

const saved = { ...PUBLIC_INFERRED };
afterEach(() => { Object.assign(PUBLIC_INFERRED, saved); });

describe("toPublicDeath: deaths after a knock-out", () => {
  const LOGOUT = ["respawn_while_unconscious", "unconscious_logout", "logout_under_attack"] as const;

  it("a logout death presents its upstream cause capped at strong, worded \"Died after\"", () => {
    for (const cause of LOGOUT) {
      for (const confidence of ["definitive", "strong"] as Confidence[]) {
        const p = toPublicDeath(verdict({ cause, upstream: { cause: "infected", confidence } }), life());
        expect(p).toMatchObject({ status: "final", key: "infected", tag: "Infected", certainty: "strong", label: "Infected",
          detail: null, sentence: "Died after an infected attack.", caption: CAPTION.strong,
          killerGamertag: null, driverGamertag: null, credit: null, trap: false, selfStated: false,
          cause: "infected", confidence: "high" });
        expect(promptLine(p)).toBe("died after being attacked by the infected");
      }
    }
    const fall = toPublicDeath(verdict({ cause: "respawn_while_unconscious", upstream: { cause: "fall", confidence: "strong" } }), life());
    expect(fall).toMatchObject({ key: "fall", label: "Fell", sentence: "Died after a fall.", tag: "Fall" });
    const boom = toPublicDeath(verdict({ cause: "respawn_while_unconscious", objectKey: "m67_grenade",
      upstream: { cause: "explosion", confidence: "strong" } }), life());
    expect(boom).toMatchObject({ key: "explosion", label: "Explosion", detail: null, sentence: "Died after an explosion.", tag: "Explosion" });
  });

  it("an inferred upstream reads \"Likely infected\"", () => {
    const p = toPublicDeath(verdict({ cause: "respawn_while_unconscious", upstream: { cause: "infected", confidence: "inferred" } }), life());
    expect(p).toMatchObject({ key: "infected", certainty: "inferred", label: "Likely infected",
      sentence: "Likely died after an infected attack.", caption: CAPTION.inferred, tag: "Infected",
      cause: "unknown", confidence: "low" });
    expect(promptLine(p)).toBe("most likely died after an infected attack");
    expect(directivesFor(p)).toEqual([INFERRED_CAUSE_DIRECTIVE]);
  });

  it("restrained logout reads \"No cause given\"", () => {
    for (const upstream of [null, { cause: "infected", confidence: "strong" as Confidence }]) {
      const p = toPublicDeath(verdict({ cause: "restrained_logout", upstream }), life());
      expect(p).toMatchObject({ key: "withheld", label: "No cause given", sentence: "No cause is given for this death.",
        tag: "Unknown", caption: null, detail: null, cause: "unknown", confidence: "low" });
      expect(promptLine(p)).toBeNull();
      expect(directivesFor(p)).toEqual([WITHHELD_DIRECTIVE]);
    }
  });

  it("own bear trap, player and mixed upstream read \"No cause given\"", () => {
    for (const cause of LOGOUT) {
      for (const up of ["own_bear_trap", "player", "mixed", "barbed_wire", "vehicle_run_over", "unknown", "something_new", "toString"]) {
        const p = toPublicDeath(verdict({ cause, upstream: { cause: up, confidence: "strong" } }), life());
        expect(p.label, `${cause}/${up}`).toBe("No cause given");
        expect(p.key).toBe("withheld");
      }
      expect(toPublicDeath(verdict({ cause, upstream: null }), life()).label).toBe("No cause given");
      expect(toPublicDeath(verdict({ cause, upstream: { cause: "infected", confidence: "unknown" } }), life()).label).toBe("No cause given");
    }
  });

  it("nothing about a logout death says how the player left, whatever the verdict holds", () => {
    for (const cause of [...LOGOUT, "restrained_logout"] as const) {
      for (const up of ["infected", "fall", "explosion", "vehicle", "vehicle_crash", "starvation_and_dehydration", "player", null]) {
        for (const confidence of ["strong", "inferred"] as Confidence[]) {
          const p = toPublicDeath(verdict({ cause, upstream: up ? { cause: up, confidence } : null }), life());
          const all = [textOf(p), promptLine(p) ?? "", ...directivesFor(p)].join("\n");
          expect(all).not.toMatch(/logout|logged|respawn|unconscious|restrain|disconnect|gave up|left the server|combat/i);
        }
      }
    }
  });
});

describe("toPublicDeath: names", () => {
  it("a kill line killer is named, with weapon and distance", () => {
    const p = toPublicDeath(verdict({ cause: "pvp", attrBasis: "kill_line" }), pvpLife);
    expect(p).toMatchObject({ key: "pvp", tag: "PvP", certainty: "definitive", label: "Killed by Killer One",
      detail: "M4-A1 · 212 m", sentence: "Killed by Killer One with M4-A1 from 212 m.", caption: null,
      killerGamertag: KILLER, driverGamertag: null, cause: "pvp", confidence: "high" });
    expect(promptLine(p, pvpLife)).toBe("killed by another player (Killer One), M4-A1, from 212 m");
    expect(promptLine(p)).toBe("killed by another player (Killer One)");
    expect(directivesFor(p)).toEqual([]);
    const melee = toPublicDeath(verdict({ cause: "pvp", attrBasis: "kill_line" }), { ...pvpLife, deathWeapon: "Hatchet", deathDistance: null });
    expect(melee).toMatchObject({ detail: "Hatchet", sentence: "Killed by Killer One with Hatchet." });
  });

  it("a trap owner never reaches killerGamertag", () => {
    // Even if the life row wrongly carried a name, a placement basis publishes none of it.
    for (const cause of ["explosive_trap", "landmine"] as const) {
      const p = toPublicDeath(verdict({ cause, attrBasis: "placement", objectKey: "m67_grenade" }),
        life({ deathCause: "pvp", deathByGamertag: PLACER }));
      expect(p.killerGamertag).toBeNull();
      expect(p.driverGamertag).toBeNull();
      expect(textOf(p)).not.toContain(PLACER);
      expect(p.trap).toBe(true);
    }
  });

  it("a placement basis with no credit argument yields credit null", () => {
    const p = toPublicDeath(verdict({ cause: "explosive_trap", attrBasis: "placement", objectKey: "m67_grenade" }),
      life({ deathCause: "explosion" }));
    expect(p).toMatchObject({ key: "tripwire", label: "Tripwire", detail: "M67 frag grenade", tag: "Trap", credit: null,
      sentence: "Killed by a tripwire rigged with an M67 frag grenade.", caption: null, trap: true, cause: "explosion", confidence: "high" });
    expect(promptLine(p)).toBe("killed by a tripwire rigged with an M67 frag grenade");
    expect(directivesFor(p)).toEqual([NAMES_NO_PERSON_DIRECTIVE]);
  });

  it("a credit adds \"Kill credited to NAME.\" and the caption, and leaves the label and detail unchanged", () => {
    const v = verdict({ cause: "explosive_trap", attrBasis: "placement", objectKey: "rgd5_grenade" });
    const without = toPublicDeath(v, life({ deathCause: "explosion" }));
    const p = toPublicDeath(v, life({ deathCause: "explosion" }), credit);
    expect(p.label).toBe(without.label);
    expect(p.detail).toBe(without.detail);
    expect(p.tag).toBe(without.tag);
    expect(p.sentence).toBe("Killed by a tripwire rigged with an RGD-5 frag grenade. Kill credited to Placer One.");
    expect(p.caption).toBe("The log names no killer. Placer One placed the only tripwire it records at this spot.");
    expect(p.credit).toEqual({ gamertag: PLACER, basis: "trap_placement", device: "tripwire", byOperator: false });
    // Credited, never the killer: the name is in `credit` and its two strings and nowhere else.
    expect(p.killerGamertag).toBeNull();
    expect(p.label).not.toContain(PLACER);
    expect(textOf(p)).not.toMatch(/killed by Placer One|Placer One's|confirmed kill/i);
    // The writer's cause line stays among the confirmed facts and holds no name.
    expect(promptLine(p)).toBe("killed by a tripwire rigged with an RGD-5 frag grenade");
    expect(directivesFor(p)).toEqual([CREDIT_DIRECTIVE(PLACER, "tripwire")]);

    const mine = toPublicDeath(verdict({ cause: "landmine", attrBasis: "placement", objectKey: "land_mine" }),
      life({ deathCause: "explosion" }), { gamertag: PLACER, device: "land_mine", byOperator: false });
    expect(mine).toMatchObject({ label: "Land mine", detail: null, sentence: "Killed by a land mine. Kill credited to Placer One.",
      caption: "The log names no killer. Placer One placed the only land mine it records at this spot." });
  });

  it("an operator grant uses the operator caption", () => {
    const p = toPublicDeath(verdict({ cause: "landmine", attrBasis: "placement" }), life({ deathCause: "explosion" }),
      { gamertag: PLACER, device: "land_mine", byOperator: true });
    expect(p.caption).toBe("The log names no killer. Credited by the server operator.");
    expect(p.sentence).toBe("Killed by a land mine. Kill credited to Placer One.");
    expect(p.credit?.byOperator).toBe(true);
  });

  it("a credit is shown only on a trap death", () => {
    for (const cause of INTERNAL_CAUSES) {
      if (cause === "explosive_trap" || cause === "landmine") continue;
      const p = toPublicDeath(verdict({ cause, upstream: { cause: "infected", confidence: "strong" } }), life(), credit);
      expect(p.credit, cause).toBeNull();
      expect(textOf(p), cause).not.toContain(PLACER);
    }
    const inferred = toPublicDeath(verdict({ cause: "explosive_trap", confidence: "inferred" }), life(), credit);
    expect(inferred.credit).toBeNull();
    expect(textOf(inferred)).not.toContain(PLACER);
  });

  it("killer (inferred) never reaches killerGamertag", () => {
    // Every basis but the kill line itself, over every cause, with a name sitting on the life row.
    const bases: (AttributionBasis | null)[] = ["placement", "not_stated", "kill_line_self", "kill_line_driver", null];
    for (const cause of INTERNAL_CAUSES) for (const attrBasis of bases) for (const confidence of ["definitive", "strong", "inferred"] as Confidence[]) {
      const p = toPublicDeath(verdict({ cause, attrBasis, confidence, upstream: { cause: "player", confidence: "strong" } }), pvpLife);
      expect(p.killerGamertag, `${cause}/${attrBasis}`).toBeNull();
      expect(p.label, `${cause}/${attrBasis}`).not.toContain(KILLER);
      if (!(cause === "vehicle_run_over" && attrBasis === "kill_line_driver")) expect(textOf(p), `${cause}/${attrBasis}`).not.toContain(KILLER);
    }
    // A kill line basis is not enough either: the life itself must be a recorded player kill.
    const p = toPublicDeath(verdict({ cause: "pvp", attrBasis: "kill_line" }), life({ deathCause: "environment", deathByGamertag: KILLER }));
    expect(p.killerGamertag).toBeNull();
    expect(textOf(p)).not.toContain(KILLER);
  });

  it("a kill line basis names nobody on a cause that is not a player kill", () => {
    for (const cause of INTERNAL_CAUSES) {
      if (cause === "pvp" || cause === "explosive_held_grenade") continue;
      const p = toPublicDeath(verdict({ cause, attrBasis: "kill_line", upstream: { cause: "infected", confidence: "strong" } }), pvpLife);
      expect(p.killerGamertag, cause).toBeNull();
      expect(textOf(p), cause).not.toContain(KILLER);
    }
  });

  it("own is printed only for kill_line_self", () => {
    const own = toPublicDeath(verdict({ cause: "self_inflicted_explosive", attrBasis: "kill_line_self", objectKey: "m79" }), life({ deathCause: "explosion" }));
    expect(own).toMatchObject({ key: "own_explosive", label: "Own explosive", detail: "40mm round",
      sentence: "Killed by their own 40mm round.", selfStated: true, tag: "Explosion" });
    expect(directivesFor(own)).toEqual([]);
    expect(toPublicDeath(verdict({ cause: "self_inflicted", attrBasis: "kill_line_self" }), life()))
      .toMatchObject({ label: "Self-inflicted", sentence: "Died by their own weapon.", selfStated: true, cause: "suicide" });

    const bases: (AttributionBasis | null)[] = ["placement", "not_stated", "kill_line", "kill_line_driver", null];
    for (const cause of INTERNAL_CAUSES) for (const attrBasis of bases) for (const objectKey of ["round_40mm", "m67_grenade", "fireplace", null] as (ObjectKey | null)[]) {
      // A suicide is stated by its own line ("their own hand"); it is pinned in the next test.
      if (cause === "suicide") continue;
      const p = toPublicDeath(verdict({ cause, attrBasis, objectKey, upstream: { cause: "explosion", confidence: "strong" } }), life());
      expect(p.selfStated).toBe(false);
      expect(`${p.label} ${p.sentence} ${p.detail} ${promptLine(p)}`, `${cause}/${attrBasis}`).not.toMatch(/\bown\b|themsel/i);
    }
    // The 40mm rows where "own" is only a reading print what the kill line states.
    expect(toPublicDeath(verdict({ cause: "explosive_40mm", attrBasis: "not_stated", objectKey: "round_40mm" }), life()))
      .toMatchObject({ label: "Explosion", detail: "40mm round", sentence: "Killed by a 40mm explosive round." });
    expect(toPublicDeath(verdict({ cause: "self_inflicted_explosive", attrBasis: "not_stated", objectKey: "round_40mm" }), life()))
      .toMatchObject({ key: "explosion", label: "Explosion", sentence: "Killed by a 40mm explosive round." });
    expect(toPublicDeath(verdict({ cause: "self_inflicted", attrBasis: null }), life())).toMatchObject({ key: "unknown", label: "Not recorded" });
  });

  it("suicide is the one cause that says \"their own hand\", and it names nobody", () => {
    const p = toPublicDeath(verdict({ cause: "suicide", conditions: ["healthy"] }), pvpLife);
    expect(p.sentence).toBe("Died by their own hand.");
    expect(textOf(p)).not.toContain(KILLER);
  });

  it("a named driver is in driverGamertag and never killerGamertag", () => {
    const p = toPublicDeath(verdict({ cause: "vehicle_run_over", attrBasis: "kill_line_driver", objectKey: "car" }), pvpLife);
    expect(p).toMatchObject({ key: "hit_by_vehicle_driver", label: "Hit by a vehicle", detail: "Car", tag: "Vehicle",
      sentence: "Hit by a vehicle. The log puts Killer One in the driver's seat.",
      driverGamertag: KILLER, killerGamertag: null, cause: "vehicle", confidence: "high" });
    // The writer is not given the driver.
    expect(promptLine(p, pvpLife)).toBe("struck and killed by a vehicle");
    expect(directivesFor(p)).toEqual([NAMES_NO_PERSON_DIRECTIVE]);
    const unnamed = toPublicDeath(verdict({ cause: "vehicle_run_over", attrBasis: "not_stated" }), pvpLife);
    expect(unnamed).toMatchObject({ driverGamertag: null, sentence: "Hit by a vehicle." });
  });

  it("pvp with no kill line reads \"Killed\" with no name and no weapon", () => {
    const strong = toPublicDeath(verdict({ cause: "pvp", confidence: "strong", mechanismStated: false, attrBasis: "not_stated" }), pvpLife);
    expect(strong).toMatchObject({ key: "pvp_unnamed", label: "Killed", detail: null, caption: CAPTION.strong, killerGamertag: null,
      sentence: "Killed by another player. The log has no kill line, so no name is given.", tag: "PvP", cause: "pvp", confidence: "high" });
    expect(promptLine(strong, pvpLife)).toBe("killed by another player; the record names no one");
    const inferred = toPublicDeath(verdict({ cause: "pvp", confidence: "inferred", mechanismStated: false, attrBasis: "not_stated" }), pvpLife);
    expect(inferred).toMatchObject({ label: "Likely killed", sentence: "Likely killed by another player.", detail: null,
      caption: CAPTION.inferred, cause: "unknown", confidence: "low" });
    expect(promptLine(inferred, pvpLife)).toBe("most likely killed by another player; the record names no one");
    for (const p of [strong, inferred]) expect(textOf(p)).not.toMatch(/Killer One|M4-A1/);
  });

  it("an ownerless firearm reads \"Shot\" and names no shooter", () => {
    const p = toPublicDeath(verdict({ cause: "pvp", confidence: "strong", attrBasis: "not_stated" }),
      life({ deathCause: "environment", deathWeapon: "M4-A1", deathDistance: 7000 }));
    expect(p).toMatchObject({ key: "shot", label: "Shot", detail: "M4-A1", tag: "Gunfire", killerGamertag: null,
      sentence: "Shot. The log names no shooter." });
    expect(promptLine(p)).toBe("shot dead; the record names no shooter");
  });

  it("a kill line that names a thing and no person does not claim there is no kill line", () => {
    const p = toPublicDeath(verdict({ cause: "pvp", attrBasis: "not_stated", objectKey: "m67_grenade" }), life({ deathCause: "explosion" }));
    expect(p).toMatchObject({ key: "pvp_unnamed", label: "Killed", detail: null, sentence: "Killed by another player. The log names no one." });
  });

  it("a held grenade names the player the kill line names", () => {
    const p = toPublicDeath(verdict({ cause: "explosive_held_grenade", confidence: "strong", attrBasis: "kill_line" }), pvpLife);
    expect(p).toMatchObject({ key: "held_grenade", label: "Killed by Killer One", detail: "Grenade",
      sentence: "Killed by Killer One (a grenade).", killerGamertag: KILLER, tag: "PvP" });
    expect(promptLine(p, pvpLife)).toBe("killed by another player (Killer One) with a grenade");
  });
});

describe("toPublicDeath: wording by cause and certainty", () => {
  it("a switched-off inferred family reads \"Not recorded\"", () => {
    const cases: [InferredFamily, StoredVerdict][] = [
      ["exposure", verdict({ cause: "cold_exposure", confidence: "inferred", mechanismStated: false })],
      ["illness", verdict({ cause: "pneumonia", confidence: "inferred", mechanismStated: false })],
      ["vehicle_crash", verdict({ cause: "vehicle_crash_occupant", confidence: "inferred", mechanismStated: false })],
      ["hunger_thirst", verdict({ cause: "starvation", confidence: "inferred", mechanismStated: false })],
      ["infected", verdict({ cause: "infected", confidence: "inferred", mechanismStated: false })],
      ["infected", verdict({ cause: "unconscious_logout", upstream: { cause: "infected", confidence: "inferred" } })],
      ["pvp", verdict({ cause: "pvp", confidence: "inferred", mechanismStated: false })],
    ];
    for (const [family, v] of cases) {
      expect(toPublicDeath(v, life()).label, family).toMatch(/^Likely /);
      PUBLIC_INFERRED[family] = false;
      const p = toPublicDeath(v, life());
      expect(p, family).toMatchObject({ key: "unknown", label: "Not recorded", sentence: "The log does not say.", caption: null,
        tag: "Unknown", certainty: "unknown", detail: null, cause: "unknown", confidence: "low" });
      expect(promptLine(p)).toBeNull();
      // The switch retracts the inferred grade only.
      const strong = toPublicDeath({ ...v, confidence: "strong", upstream: v.upstream ? { ...v.upstream, confidence: "strong" } : null }, life());
      expect(strong.label, family).not.toBe("Not recorded");
      PUBLIC_INFERRED[family] = true;
    }
  });

  it("every bled-out cause reads \"Bled out\" with no detail and no name", () => {
    for (const cause of ["bled_out_infected", "bled_out_barbed_wire", "bled_out_animal", "bled_out_other", "pvp_bleedout"] as const) {
      for (const confidence of ["definitive", "strong"] as Confidence[]) {
        const p = toPublicDeath(verdict({ cause, confidence, objectKey: "barbed_wire", attrBasis: "not_stated",
          upstream: { cause: "player", confidence: "strong" } }), pvpLife);
        expect(p, cause).toMatchObject({ key: "bled_out", label: "Bled out", detail: null, sentence: "Bled out.", tag: "Blood Loss",
          killerGamertag: null, cause: "bled_out", confidence: "high" });
        expect(textOf(p)).not.toContain(KILLER);
        expect(promptLine(p, pvpLife)).toBe("bled out");
      }
    }
  });

  it("fire reads \"Burned\" with no detail", () => {
    const p = toPublicDeath(verdict({ cause: "fire", objectKey: "fireplace" }), life({ deathCause: "environment" }));
    expect(p).toMatchObject({ key: "burned", label: "Burned", detail: null, sentence: "Died of burns from a fire.", tag: "Fire",
      cause: "environmental", confidence: "high" });
    expect(textOf(p)).not.toMatch(/fireplace/i);
    expect(directivesFor(p)).toEqual([NAMES_NO_PERSON_DIRECTIVE]);
  });

  it("strong cold reads \"Exposure\" and \"Died of exposure.\"", () => {
    const p = toPublicDeath(verdict({ cause: "cold_exposure", confidence: "strong", mechanismStated: false }), life());
    expect(p).toMatchObject({ key: "exposure", label: "Exposure", sentence: "Died of exposure.", caption: CAPTION.strong,
      tag: "Exposure", certainty: "strong", cause: "environmental", confidence: "high" });
    expect(directivesFor(p)).toEqual([STRONG_CAUSE_DIRECTIVE]);
    const inferred = toPublicDeath(verdict({ cause: "heatstroke_or_silicosis", confidence: "inferred", mechanismStated: false }), life());
    expect(inferred).toMatchObject({ label: "Likely exposure", sentence: "Likely died of exposure.", caption: CAPTION.inferred,
      tag: "Exposure", cause: "unknown", confidence: "low" });
    expect(promptLine(inferred)).toBe("most likely died of exposure");
  });

  it("strong vehicle_crash_occupant reads \"Vehicle crash\"", () => {
    expect(toPublicDeath(verdict({ cause: "vehicle_crash_occupant", confidence: "strong", mechanismStated: false }), life()))
      .toMatchObject({ label: "Vehicle crash", sentence: "Died in a vehicle crash.", caption: CAPTION.strong, tag: "Vehicle" });
    expect(toPublicDeath(verdict({ cause: "vehicle_own_crash", confidence: "strong", objectKey: "motorbike" }), life({ deathCause: "vehicle" })))
      .toMatchObject({ label: "Motorbike crash", detail: null, sentence: "Died in a motorbike crash." });
  });

  it("the detail is printed only when the certainty is definitive or strong", () => {
    for (const cause of INTERNAL_CAUSES) {
      const p = toPublicDeath(verdict({ cause, confidence: "inferred", objectKey: "m67_grenade", attrBasis: "kill_line",
        upstream: { cause: "explosion", confidence: "inferred" } }), pvpLife);
      expect(p.detail, cause).toBeNull();
      expect(`${p.label} ${p.sentence}`, cause).not.toMatch(/M67|M4-A1/);
    }
  });

  it("the caption follows the certainty", () => {
    expect(toPublicDeath(verdict({ cause: "fall" }), life()).caption).toBeNull();
    expect(toPublicDeath(verdict({ cause: "fall", confidence: "strong" }), life()).caption).toBe(CAPTION.strong);
    expect(toPublicDeath(verdict({ cause: "starvation", confidence: "inferred" }), life()).caption).toBe(CAPTION.inferred);
    expect(toPublicDeath(verdict({ cause: "unknown", confidence: "unknown" }), life()).caption).toBeNull();
  });

  it("an unknown verdict reads \"Not recorded\"", () => {
    for (const cause of ["unknown", "fall"] as const) {
      const p = toPublicDeath(verdict({ cause, confidence: "unknown" }), life());
      expect(p).toMatchObject({ key: "unknown", label: "Not recorded", sentence: "The log does not say.", tag: "Unknown" });
      expect(directivesFor(p)).toEqual([]);
    }
  });

  it("the tag is \"Unknown\" exactly when no cause is given", () => {
    for (const cause of INTERNAL_CAUSES) for (const confidence of ["definitive", "strong", "inferred", "unknown"] as Confidence[]) {
      const p = toPublicDeath(verdict({ cause, confidence, upstream: { cause: "infected", confidence } }), life());
      expect(p.tag === "Unknown", `${cause}/${confidence}`).toBe(p.key === "unknown" || p.key === "withheld");
      expect(p.tag === "Unknown").toBe(p.certainty === "unknown");
      expect(promptLine(p) === null).toBe(p.tag === "Unknown");
    }
  });

  it("suicide conditions print as today", () => {
    const label = (conditions: string[]) => toPublicDeath(verdict({ cause: "suicide", conditions }), life({ deathCause: "suicide" })).label;
    expect(label(["starving", "hunted"])).toBe("Suicide (starving, hunted)");
    expect(label(["dehydrated"])).toBe("Suicide (dehydrated)");
    expect(label(["healthy"])).toBe("Suicide (in good health)");
    expect(label([])).toBe("Suicide");
    const p = toPublicDeath(verdict({ cause: "suicide", conditions: ["starving", "hunted"] }), life({ deathCause: "suicide" }));
    expect(p).toMatchObject({ key: "suicide", tag: "Self-Inflicted", detail: null, conditions: ["starving", "hunted"], cause: "suicide", confidence: "high" });
    expect(promptLine(p)).toBe("died by their own hand. At the end they were starving and hunted.");
    expect(promptLine(toPublicDeath(verdict({ cause: "suicide", conditions: ["healthy"] }), life())))
      .toBe("died by their own hand. They were in good health at the end.");
    expect(directivesFor(p)).toEqual([]);
  });

  it("the writer is told who is not named only where the log names an object and no person", () => {
    const d = (v: StoredVerdict) => directivesFor(toPublicDeath(v, life()));
    for (const cause of ["explosive_trap", "landmine", "explosive_grenade", "explosive_40mm", "fuel_explosion", "fire",
      "vehicle_impact", "vehicle_own_crash"] as const) {
      expect(d(verdict({ cause })), cause).toContain(NAMES_NO_PERSON_DIRECTIVE);
    }
    for (const cause of ["suicide", "infected", "animal_wolf", "fall", "drowned", "starvation", "bled_out_other"] as const) {
      expect(d(verdict({ cause })), cause).not.toContain(NAMES_NO_PERSON_DIRECTIVE);
    }
  });
});

describe("pendingPublicDeath", () => {
  it("pending pvp carries the killer from the life", () => {
    const p = pendingPublicDeath(pvpLife);
    expect(p).toMatchObject({ status: "pending", key: "pvp", tag: null, label: "Killed by Killer One", detail: null,
      sentence: "Killed by Killer One.", caption: null, killerGamertag: KILLER, cause: "pvp", confidence: "high" });
    expect(promptLine(p, pvpLife)).toBeNull();
    expect(directivesFor(p)).toEqual([]);
    expect(pendingPublicDeath(life({ deathCause: "pvp" }))).toMatchObject({ label: "Killed", killerGamertag: null });
  });

  it("pending prints \"Awaiting the record\" for died and environment", () => {
    for (const deathCause of ["died", "environment", "unknown", null, "something_new", "toString"]) {
      const p = pendingPublicDeath(life({ deathCause, deathByGamertag: KILLER }));
      expect(p, String(deathCause)).toMatchObject({ status: "pending", key: "awaiting", label: "Awaiting the record", tag: null,
        detail: null, caption: null, killerGamertag: null, certainty: "unknown" });
      expect(p.label).not.toMatch(/unknown/i);
      expect(textOf(p)).not.toContain(KILLER);
    }
    // The legacy fields keep today's words: a stated environment death is not "unknown" to an old reader.
    expect(pendingPublicDeath(life({ deathCause: "environment" }))).toMatchObject({ cause: "environmental", confidence: "high" });
    expect(pendingPublicDeath(life({ deathCause: "died" }))).toMatchObject({ cause: "unknown", confidence: "low" });
  });

  it("a specific stated word prints its family with no detail", () => {
    const label = (deathCause: string) => pendingPublicDeath(life({ deathCause, deathWeapon: "M4-A1", deathDistance: 10 }));
    expect(label("suicide")).toMatchObject({ label: "Suicide", cause: "suicide" });
    expect(label("infected")).toMatchObject({ label: "Infected", cause: "infected" });
    expect(label("wolf")).toMatchObject({ label: "Wolf", cause: "wolf" });
    expect(label("bear")).toMatchObject({ label: "Bear", cause: "bear" });
    expect(label("animal")).toMatchObject({ label: "Animal", cause: "animal" });
    expect(label("drowned")).toMatchObject({ label: "Drowned", cause: "environmental" });
    expect(label("bled_out")).toMatchObject({ label: "Bled out", cause: "bled_out" });
    expect(label("explosion")).toMatchObject({ label: "Explosion", cause: "explosion" });
    expect(label("vehicle")).toMatchObject({ label: "Vehicle", cause: "vehicle" });
    expect(label("fall")).toMatchObject({ label: "Fell", cause: "fall" });
    for (const w of ["suicide", "infected", "explosion", "vehicle", "fall"]) {
      expect(label(w)).toMatchObject({ status: "pending", detail: null, tag: null, credit: null, trap: false, confidence: "high" });
    }
  });
});
