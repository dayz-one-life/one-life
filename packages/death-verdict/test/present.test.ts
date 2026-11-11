import { describe, it, expect, afterEach } from "vitest";
import {
  CAPTION, CREDIT_DIRECTIVE, CREDIT_TEXT, INFERRED_CAUSE_DIRECTIVE, INTERNAL_CAUSES, NAMES_NO_PERSON_DIRECTIVE,
  PUBLIC_INFERRED, PUBLIC_ROWS, STRONG_CAUSE_DIRECTIVE, WITHHELD_DIRECTIVE, pendingPublicDeath, objectKeyFromText,
  toPublicDeath as present, writerBrief,
  type AttributionBasis, type Condition, type Confidence, type InferredFamily, type LifeDeathFacts, type ObjectKey, type PublicDeath,
  type StoredVerdict, type TrapCredit,
} from "../src/index.js";

// Invented people. Nobody here is a real player.
const KILLER = "Killer One";
const PLACER = "Placer One";

const verdict = (over: Partial<StoredVerdict> & Pick<StoredVerdict, "cause">): StoredVerdict => ({
  confidence: "definitive", mechanismStated: true, objectKey: null, upstream: null, attrBasis: null, ownerlessFirearm: false,
  conditions: [], ...over,
});

// The writer's brief is built from the verdict, not from the public shape. These three keep the
// tests reading "the death, then what the writer is told about it": each public death remembers
// what it was made from. A pending death was made from no verdict, so it has no brief.
const madeFrom = new WeakMap<PublicDeath, [StoredVerdict, LifeDeathFacts, TrapCredit | null]>();
const toPublicDeath = (v: StoredVerdict, l: LifeDeathFacts, c: TrapCredit | null = null): PublicDeath => {
  const p = present(v, l, c);
  madeFrom.set(p, [v, l, c]);
  return p;
};
const promptLine = (p: PublicDeath): string | null => {
  const m = madeFrom.get(p);
  return m ? writerBrief(...m).line : null;
};
const directivesFor = (p: PublicDeath): string[] => {
  const m = madeFrom.get(p);
  return m ? writerBrief(...m).directives : [];
};
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
    expect(promptLine(p)).toBe("killed by another player (Killer One), M4-A1, from 212 m");
    expect(promptLine(toPublicDeath(verdict({ cause: "pvp", attrBasis: "kill_line" }), { ...pvpLife, deathWeapon: null })))
      .toBe("killed by another player (Killer One)");
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
    expect(promptLine(p)).toBe("struck and killed by a vehicle");
    expect(directivesFor(p)).toEqual([NAMES_NO_PERSON_DIRECTIVE]);
    const unnamed = toPublicDeath(verdict({ cause: "vehicle_run_over", attrBasis: "not_stated" }), pvpLife);
    expect(unnamed).toMatchObject({ driverGamertag: null, sentence: "Hit by a vehicle." });
  });

  it("pvp with no kill line reads \"Killed\" with no name and no weapon", () => {
    const strong = toPublicDeath(verdict({ cause: "pvp", confidence: "strong", mechanismStated: false, attrBasis: "not_stated" }), pvpLife);
    expect(strong).toMatchObject({ key: "pvp_unnamed", label: "Killed", detail: null, caption: CAPTION.strong, killerGamertag: null,
      sentence: "Killed by another player. The log has no kill line, so no name is given.", tag: "PvP", cause: "pvp", confidence: "high" });
    // No kill line and no object does not make it a shooting.
    expect(strong.key).not.toBe("shot");
    expect(promptLine(strong)).toBe("killed by another player; the record names no one");
    const inferred = toPublicDeath(verdict({ cause: "pvp", confidence: "inferred", mechanismStated: false, attrBasis: "not_stated" }), pvpLife);
    expect(inferred).toMatchObject({ label: "Likely killed", sentence: "Likely killed by another player.", detail: null,
      caption: CAPTION.inferred, cause: "unknown", confidence: "low" });
    expect(promptLine(inferred)).toBe("most likely killed by another player; the record names no one");
    for (const p of [strong, inferred]) expect(textOf(p)).not.toMatch(/Killer One|M4-A1/);
  });

  it("an ownerless firearm reads \"Shot\" and names no shooter", () => {
    const p = toPublicDeath(verdict({ cause: "pvp", confidence: "strong", attrBasis: "not_stated", ownerlessFirearm: true }),
      life({ deathCause: "environment", deathWeapon: "M4-A1", deathDistance: 7000 }));
    expect(p).toMatchObject({ key: "shot", label: "Shot", detail: "M4-A1", tag: "Gunfire", killerGamertag: null,
      sentence: "Shot. The log names no shooter.", certainty: "strong", caption: CAPTION.strong });
    expect(promptLine(p)).toBe("shot dead; the record names no shooter");
  });

  it("\"Shot\" is printed only for the ownerless-firearm form, never by elimination", () => {
    // Every unnamed player kill that is not that form: whatever else the verdict and the life hold.
    const lives = [life(), life({ deathCause: "died", deathWeapon: "Kitchen Knife" }), pvpLife, life({ deathCause: "pvp" })];
    for (const attrBasis of ["kill_line", "not_stated", "placement", null] as (AttributionBasis | null)[]) {
      for (const mechanismStated of [true, false]) for (const confidence of ["definitive", "strong", "inferred"] as Confidence[]) {
        for (const objectKey of [null, "m67_grenade"] as (ObjectKey | null)[]) for (const l of lives) {
          const p = toPublicDeath(verdict({ cause: "pvp", attrBasis, mechanismStated, confidence, objectKey }), l);
          const all = `${textOf(p)} ${promptLine(p)}`;
          expect(all, `${attrBasis}/${mechanismStated}/${confidence}`).not.toMatch(/shot|shooter|gunfire/i);
        }
      }
    }
    // The flag without a stated mechanism is a contradiction; it does not print "Shot" either.
    const odd = toPublicDeath(verdict({ cause: "pvp", ownerlessFirearm: true, mechanismStated: false, confidence: "strong" }), life());
    expect(odd.key).toBe("pvp_unnamed");
    // And the flag means nothing on a death that is not a player kill.
    expect(toPublicDeath(verdict({ cause: "fall", ownerlessFirearm: true }), life()).key).toBe("fall");
  });

  it("a punch with an item in hand is a player kill, not a shooting", () => {
    // The reference words the object "fists holding <item>"; only one such item has a public key.
    for (const text of ["fists holding RGD-5 Grenade", "fists holding M67 Grenade", "fists holding Claymore",
      "fists holding Plastic Explosive", "fists holding 6-M7 Frag Grenade"]) {
      const p = toPublicDeath(verdict({ cause: "pvp", attrBasis: "not_stated", objectKey: objectKeyFromText(text) }), life({ deathCause: "explosion" }));
      expect(p, text).toMatchObject({ key: "pvp_unnamed", label: "Killed", tag: "PvP", detail: null, killerGamertag: null,
        sentence: "Killed by another player. The kill line names no one." });
      expect(promptLine(p), text).toBe("killed by another player");
    }
  });

  it("a kill line killer on a life that is not a player kill is withheld, and nothing false is said about the log", () => {
    const p = toPublicDeath(verdict({ cause: "pvp", attrBasis: "kill_line" }),
      life({ deathCause: "died", deathByGamertag: KILLER, deathWeapon: "Kitchen Knife" }));
    expect(p).toMatchObject({ key: "pvp_unnamed", label: "Killed", tag: "PvP", detail: null, killerGamertag: null,
      sentence: "Killed by another player.", caption: null });
    expect(promptLine(p)).toBe("killed by another player");
    expect(textOf(p)).not.toMatch(/Killer One|Knife|names no|no kill line/);
    // The same when the life is a player kill but the verdict's basis is not the kill line.
    const q = toPublicDeath(verdict({ cause: "pvp", attrBasis: null }), pvpLife);
    expect(q).toMatchObject({ key: "pvp_unnamed", killerGamertag: null, detail: null });
    expect(textOf(q)).not.toMatch(/Killer One|M4-A1|Shot/);
  });

  it("an inferred verdict never carries a name, whatever its basis says", () => {
    for (const cause of ["pvp", "explosive_held_grenade"] as const) {
      const p = toPublicDeath(verdict({ cause, confidence: "inferred", attrBasis: "kill_line" }), pvpLife);
      expect(p.killerGamertag, cause).toBeNull();
      expect(p.label, cause).toBe("Likely killed");
      expect(`${textOf(p)} ${promptLine(p)}`, cause).not.toMatch(/Killer One|M4-A1/);
    }
    const driver = toPublicDeath(verdict({ cause: "vehicle_run_over", confidence: "inferred", attrBasis: "kill_line_driver" }), pvpLife);
    expect(driver.driverGamertag).toBeNull();
    expect(textOf(driver)).not.toContain(KILLER);
    const own = toPublicDeath(verdict({ cause: "self_inflicted_explosive", confidence: "inferred", attrBasis: "kill_line_self" }), life());
    expect(own).toMatchObject({ key: "explosion", selfStated: false });
    expect(textOf(own)).not.toMatch(/\bown\b/);
  });

  it("a held grenade names the player the kill line names", () => {
    const p = toPublicDeath(verdict({ cause: "explosive_held_grenade", confidence: "strong", attrBasis: "kill_line" }), pvpLife);
    expect(p).toMatchObject({ key: "held_grenade", label: "Killed by Killer One", detail: "Grenade",
      sentence: "Killed by Killer One (a grenade).", killerGamertag: KILLER, tag: "PvP" });
    expect(promptLine(p)).toBe("killed by another player (Killer One) with a grenade");
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
        expect(promptLine(p)).toBe("bled out");
      }
    }
  });

  it("a bled-out death with an inferred wound source is not hedged: the bleed itself is stated", () => {
    for (const cause of ["bled_out_infected", "bled_out_animal", "bled_out_barbed_wire", "bled_out_other", "pvp_bleedout"] as const) {
      const p = toPublicDeath(verdict({ cause, confidence: "inferred", attrBasis: "not_stated",
        upstream: { cause: "infected", confidence: "inferred" } }), life({ deathCause: "bled_out" }));
      expect(p, cause).toMatchObject({ key: "bled_out", label: "Bled out", sentence: "Bled out.", detail: null, tag: "Blood Loss",
        certainty: "strong", caption: CAPTION.strong, cause: "bled_out", confidence: "high" });
      expect(promptLine(p), cause).toBe("bled out");
      expect(directivesFor(p), cause).toEqual([STRONG_CAUSE_DIRECTIVE]);
      expect(`${textOf(p)} ${promptLine(p)}`, cause).not.toMatch(/likely|recorded no cause/i);
    }
    // Only while the line states the bleed. A bleed that was itself worked out stays hedged.
    const read = toPublicDeath(verdict({ cause: "bled_out_other", confidence: "inferred", mechanismStated: false }), life());
    expect(read).toMatchObject({ label: "Likely bled out", certainty: "inferred", caption: CAPTION.inferred, cause: "unknown", confidence: "low" });
  });

  it("an ownerless firearm with no shooter worked out still reads \"Shot\": the kill line states the shot", () => {
    const p = toPublicDeath(verdict({ cause: "pvp", confidence: "inferred", attrBasis: null, ownerlessFirearm: true }),
      life({ deathCause: "environment", deathWeapon: "M4-A1" }));
    expect(p).toMatchObject({ key: "shot", label: "Shot", sentence: "Shot. The log names no shooter.", detail: "M4-A1",
      certainty: "strong", caption: CAPTION.strong, cause: "pvp", confidence: "high" });
    expect(promptLine(p)).toBe("shot dead; the record names no shooter");
    expect(textOf(p)).not.toMatch(/likely|recorded no cause/i);
  });

  it("a stored value this release does not know reads \"Not recorded\" and never throws", () => {
    const NOT_RECORDED = { status: "final", key: "unknown", label: "Not recorded", sentence: "The log does not say.", tag: "Unknown",
      certainty: "unknown", caption: null, detail: null, killerGamertag: null, cause: "unknown", confidence: "low" };
    // A cause from a newer classifier, read by an older release; and names every object has.
    for (const cause of ["explosive_new_thing", "", "toString", "constructor", "__proto__", null, undefined, 7]) {
      for (const confidence of ["definitive", "strong", "inferred", "unknown"] as Confidence[]) {
        const v = verdict({ cause: cause as never, confidence, attrBasis: "kill_line", objectKey: "m67_grenade",
          upstream: { cause: "infected", confidence: "strong" } });
        const p = toPublicDeath(v, pvpLife, credit);
        expect(p, String(cause)).toMatchObject(NOT_RECORDED);
        expect(textOf(p)).not.toMatch(/Killer One|Placer One/);
        expect(writerBrief(v, pvpLife, credit)).toEqual({ line: null, creditLine: null, directives: [] });
      }
    }
    // A confidence outside the four: never printed as fact.
    for (const confidence of ["probable", "certain", "", "toString", null, undefined, 1]) {
      for (const cause of INTERNAL_CAUSES) {
        const v = verdict({ cause, confidence: confidence as never, attrBasis: "kill_line",
          upstream: { cause: "infected", confidence: confidence as never } });
        const p = toPublicDeath(v, pvpLife, credit);
        expect(["unknown", "withheld"], `${cause}/${confidence}`).toContain(p.key);
        expect(p.certainty).toBe("unknown");
        expect(textOf(p)).not.toMatch(/Killer One|Placer One/);
        expect(writerBrief(v, pvpLife, credit).line).toBeNull();
      }
    }
    // The same for the cause of a knock-out and its grade.
    for (const up of [{ cause: "infected", confidence: "probable" }, { cause: "constructor", confidence: "strong" },
      { cause: "hasOwnProperty", confidence: "strong" }, { cause: null, confidence: "strong" }]) {
      const p = toPublicDeath(verdict({ cause: "unconscious_logout", upstream: up as never }), life());
      expect(p, JSON.stringify(up)).toMatchObject({ key: "withheld", label: "No cause given", certainty: "unknown" });
    }
    // An object key or a basis it does not know prints no detail and no name.
    const odd = toPublicDeath(verdict({ cause: "explosive_grenade", objectKey: "toString" as never, attrBasis: "kill_line_new" as never }), pvpLife);
    expect(odd).toMatchObject({ label: "Grenade", detail: null, killerGamertag: null, selfStated: false });
  });

  it("only the four condition words are printed, and the list is a copy", () => {
    const conditions = ["starving", "logged out while down", "Placer One nearby", "hunted", "starving", 7, null] as never[];
    const v = verdict({ cause: "suicide", conditions });
    const p = toPublicDeath(v, life({ deathCause: "suicide" }));
    expect(p.label).toBe("Suicide (starving, hunted)");
    expect(p.conditions).toEqual(["starving", "hunted"]);
    expect(promptLine(p)).toBe("died by their own hand. At the end they were starving and hunted.");
    expect(`${textOf(p)} ${promptLine(p)}`).not.toMatch(/logged|Placer/);
    conditions.push("healthy" as never);
    expect(p.conditions).toEqual(["starving", "hunted"]);
    expect(p.conditions).not.toBe(v.conditions);
    // After a knock-out too, and a row with no list at all.
    const after = toPublicDeath(verdict({ cause: "unconscious_logout", conditions: ["hunted", "left the server"] as never[],
      upstream: { cause: "infected", confidence: "strong" } }), life());
    expect(after.conditions).toEqual(["hunted"]);
    expect(toPublicDeath(verdict({ cause: "fall", conditions: null as never }), life()).conditions).toEqual([]);
  });

  it("an object is printed only on a death it can belong to", () => {
    const detail = (cause: StoredVerdict["cause"], objectKey: ObjectKey, attrBasis: AttributionBasis | null = null) =>
      toPublicDeath(verdict({ cause, objectKey, attrBasis }), life()).detail;
    expect(detail("vehicle_impact", "m67_grenade")).toBeNull();
    expect(detail("vehicle_impact", "car")).toBe("Car");
    expect(detail("vehicle_run_over", "motorbike")).toBe("Motorbike");
    expect(detail("explosive_grenade", "car")).toBeNull();
    expect(detail("explosive_grenade", "rgd5_grenade")).toBe("RGD-5 frag grenade");
    expect(detail("explosive_trap", "fuel_pump")).toBeNull();
    expect(detail("explosive_trap", "claymore")).toBe("Claymore");
    expect(detail("explosive_40mm", "fireplace")).toBeNull();
    expect(detail("explosive_charge", "plastic_explosive")).toBe("Plastic explosive");
    expect(detail("self_inflicted_explosive", "barbed_wire", "kill_line_self")).toBeNull();
    expect(detail("explosive_held_grenade", "car")).toBe("Grenade");
    // The sentence follows the detail: a mismatched object is not in it either.
    expect(toPublicDeath(verdict({ cause: "explosive_grenade", objectKey: "car" }), life()).sentence)
      .toBe("Killed by a grenade. The log names no thrower.");
    // Every row that prints an object says which.
    for (const [key, row] of Object.entries(PUBLIC_ROWS)) expect(row.detail === "object", key).toBe(row.objects != null);
  });

  it("a credit for the wrong device is not shown", () => {
    const tripwire = verdict({ cause: "explosive_trap", attrBasis: "placement", objectKey: "m67_grenade" });
    const wrong: TrapCredit = { gamertag: PLACER, device: "land_mine", byOperator: false };
    const p = toPublicDeath(tripwire, life(), wrong);
    expect(p.credit).toBeNull();
    expect(p.caption).toBeNull();
    expect(textOf(p)).not.toMatch(/Placer One|land mine/i);
    expect(writerBrief(tripwire, life(), wrong)).toEqual({ line: "killed by a tripwire rigged with an M67 frag grenade",
      creditLine: null, directives: [NAMES_NO_PERSON_DIRECTIVE] });
    const mine = toPublicDeath(verdict({ cause: "landmine", attrBasis: "placement" }), life(), credit);
    expect(mine.credit).toBeNull();
    expect(textOf(mine)).not.toMatch(/Placer One|tripwire/i);
    // A credit with no name is no credit.
    expect(toPublicDeath(tripwire, life(), { gamertag: "", device: "tripwire", byOperator: false }).credit).toBeNull();
  });

  it("selfStated is set only on the two causes whose kill line names the victim", () => {
    for (const cause of INTERNAL_CAUSES) {
      const p = toPublicDeath(verdict({ cause, attrBasis: "kill_line_self", upstream: { cause: "infected", confidence: "strong" } }), life());
      expect(p.selfStated, cause).toBe(cause === "self_inflicted_explosive" || cause === "self_inflicted");
    }
  });

  it("the writer's brief carries the credit line with the credit and at no other time", () => {
    const v = verdict({ cause: "explosive_trap", attrBasis: "placement", objectKey: "rgd5_grenade" });
    expect(writerBrief(v, life(), credit)).toEqual({ line: "killed by a tripwire rigged with an RGD-5 frag grenade",
      creditLine: CREDIT_TEXT.tripwire.writerLine(PLACER), directives: [CREDIT_DIRECTIVE(PLACER, "tripwire")] });
    expect(writerBrief(v, life()).creditLine).toBeNull();
    expect(writerBrief({ ...v, confidence: "inferred" }, life(), credit).creditLine).toBeNull();
    expect(writerBrief(verdict({ cause: "fall" }), life(), credit).creditLine).toBeNull();
  });

  it("a death after a knock-out is told to the writer by its own wording, with the directives of its cause", () => {
    const brief = (up: string, confidence: Confidence) =>
      writerBrief(verdict({ cause: "unconscious_logout", upstream: { cause: up, confidence } }), life());
    expect(brief("infected", "strong")).toEqual({ line: "died after being attacked by the infected", creditLine: null,
      directives: [STRONG_CAUSE_DIRECTIVE] });
    expect(brief("fall", "inferred")).toEqual({ line: "most likely died after a fall", creditLine: null,
      directives: [INFERRED_CAUSE_DIRECTIVE] });
    // An explosion or a crash still names no person, knock-out or not. The directive says nothing
    // about how the player left, so it is no tell; leaving it out would let the writer guess at
    // a thrower in prose that cannot be recalled.
    for (const up of ["explosion", "vehicle", "vehicle_crash"]) {
      expect(brief(up, "strong").directives, up).toEqual([STRONG_CAUSE_DIRECTIVE, NAMES_NO_PERSON_DIRECTIVE]);
      expect(brief(up, "inferred").directives, up).toEqual([INFERRED_CAUSE_DIRECTIVE, NAMES_NO_PERSON_DIRECTIVE]);
    }
    expect(brief("player", "strong")).toEqual({ line: null, creditLine: null, directives: [WITHHELD_DIRECTIVE] });
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
    const label = (conditions: Condition[]) => toPublicDeath(verdict({ cause: "suicide", conditions }), life({ deathCause: "suicide" })).label;
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
    expect(promptLine(p)).toBeNull();
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
