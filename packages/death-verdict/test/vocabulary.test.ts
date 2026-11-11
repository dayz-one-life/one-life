import { describe, it, expect } from "vitest";
import {
  ATTRIBUTION_ROLES, CAPTION, CAUSE_VOCAB, CONTRIBUTOR_ROLES, CREDIT_DIRECTIVE, CREDIT_TEXT, FAMILY_TAG,
  INFERRED_CAUSE_DIRECTIVE, INTERNAL_CAUSES, LOGOUT_CAUSES, LOGOUT_SENTENCE, NAMES_NO_PERSON_DIRECTIVE,
  NOT_CONFIRMED_HEADING, OBJECT_KEY_FROM_TEXT, OBJECT_LABEL, PUBLIC_INFERRED, PUBLIC_ROWS, PVP_UNNAMED_VARIANT,
  STATED_COARSE, STRONG_CAUSE_DIRECTIVE, TRAP_KILLS_CAVEAT, TRAP_QUALIFIED_LINE, UPSTREAM_TO_PUBLIC, WITHHELD_DIRECTIVE,
  inferredOf, isInternalCause, objectKeyFromText,
  type InternalCause, type WordingInput,
} from "../src/index.js";

// Invented names. `Placer One` is the player a trap kill is credited to; `Victim One` dies.
const NAME = "Placer One";
const GRADES = ["definitive", "strong", "inferred"] as const;
const full: WordingInput = { name: NAME, weapon: "M4-A1", distance: 212, object: OBJECT_LABEL.m67_grenade, conditions: ["starving"] };
const bare: WordingInput = { name: null, weapon: null, distance: null, object: null, conditions: [] };
const NO_CAUSE_KEYS = new Set(["withheld", "unknown", "awaiting"]);
const causes = Object.keys(CAUSE_VOCAB) as InternalCause[];

/** Every string a cause can print at one grade, with and without the optional inputs. */
function stringsOf(cause: InternalCause, grade: (typeof GRADES)[number]): string[] {
  const e = CAUSE_VOCAB[cause].by[grade];
  return [e.label, e.sentence(bare), e.sentence(full), ...(e.promptLine ? [e.promptLine(bare), e.promptLine(full)] : [])];
}

/** Every public string in the vocabulary, for the checks that hold over all of them. */
function everyPublicString(): string[] {
  const out: string[] = [];
  for (const row of Object.values(PUBLIC_ROWS)) {
    for (const input of [bare, full]) {
      for (const w of [row.stated(input), inferredOf(row, input)]) out.push(w.label, w.sentence, w.promptLine);
    }
  }
  for (const o of Object.values(OBJECT_LABEL)) out.push(o.short, o.withArticle, o.bare);
  for (const w of Object.values(LOGOUT_SENTENCE)) out.push(w!.strong, w!.inferred, w!.promptLine, w!.inferredPromptLine);
  for (const c of Object.values(CREDIT_TEXT)) {
    out.push(c.sentenceSuffix(NAME), c.caption(NAME), c.operatorCaption, c.listLabel, c.listFootnote, c.writerLine(NAME));
  }
  out.push(CAPTION.strong!, CAPTION.inferred!, TRAP_QUALIFIED_LINE, TRAP_KILLS_CAVEAT(1, 2),
    ...Object.values(PVP_UNNAMED_VARIANT).flatMap((w) => [w.sentence, w.promptLine]),
    CREDIT_DIRECTIVE(NAME, "tripwire"), CREDIT_DIRECTIVE(NAME, "land_mine"), INFERRED_CAUSE_DIRECTIVE,
    NOT_CONFIRMED_HEADING, STRONG_CAUSE_DIRECTIVE, WITHHELD_DIRECTIVE, NAMES_NO_PERSON_DIRECTIVE,
    ...Object.values(FAMILY_TAG));
  return out;
}

describe("vocabulary", () => {
  it("every (internal cause, certainty) has a label, sentence, tag", () => {
    for (const cause of causes) {
      for (const grade of GRADES) {
        const e = CAUSE_VOCAB[cause].by[grade];
        expect(e.label, `${cause}/${grade} label`).toMatch(/\S/);
        expect(e.sentence(bare), `${cause}/${grade} sentence`).toMatch(/\S.*\.$/);
        expect(e.sentence(full), `${cause}/${grade} sentence`).toMatch(/\S.*\.$/);
        expect(e.tag, `${cause}/${grade} tag`).toMatch(/\S/);
      }
    }
  });

  it("every cause with something to say gives the writer a line at every certainty", () => {
    for (const cause of causes) {
      if (NO_CAUSE_KEYS.has(CAUSE_VOCAB[cause].key)) continue;
      for (const grade of GRADES) {
        const line = CAUSE_VOCAB[cause].by[grade].promptLine;
        expect(line, `${cause}/${grade}`).not.toBeNull();
        expect(line!(bare)).toMatch(/\S/);
        // The line is dropped into a list of facts; it is not a capitalised sentence.
        expect(line!(bare)).toMatch(/^[a-z]/);
      }
    }
  });

  it("every inferred label and sentence starts with \"Likely\"", () => {
    for (const cause of causes) {
      if (NO_CAUSE_KEYS.has(CAUSE_VOCAB[cause].key)) continue;
      const e = CAUSE_VOCAB[cause].by.inferred;
      for (const s of [e.label, e.sentence(bare), e.sentence(full)]) expect(s, cause).toMatch(/^Likely /);
    }
    for (const w of Object.values(LOGOUT_SENTENCE)) expect(w!.inferred).toMatch(/^Likely /);
  });

  it("every inferred tag is its family tag and every inferred promptLine starts with \"most likely\"", () => {
    for (const cause of causes) {
      const v = CAUSE_VOCAB[cause];
      if (NO_CAUSE_KEYS.has(v.key)) continue;
      const e = v.by.inferred;
      if (v.family) expect(e.tag, cause).toBe(FAMILY_TAG[v.family]);
      // The tag is the one string that does not change with certainty.
      expect(e.tag, cause).toBe(v.by.definitive.tag);
      expect(e.promptLine!(bare), cause).toMatch(/^most likely /);
      expect(e.promptLine!(full), cause).toMatch(/^most likely /);
    }
    for (const w of Object.values(LOGOUT_SENTENCE)) expect(w!.inferredPromptLine).toMatch(/^most likely /);
  });

  it("every cause the classifier infers today has a family, so it can be switched off", () => {
    const inferredToday: InternalCause[] = ["starvation", "dehydration", "starvation_and_dehydration", "cold_exposure",
      "heatstroke", "heatstroke_or_silicosis", "pneumonia", "vehicle_crash_occupant", "vehicle_own_crash", "infected"];
    for (const cause of inferredToday) expect(CAUSE_VOCAB[cause].family, cause).not.toBeNull();
    expect(Object.values(PUBLIC_INFERRED).every((on) => on === true)).toBe(true);
  });

  it("unknown and withheld have no promptLine and tag \"Unknown\"", () => {
    for (const cause of ["unknown", "restrained_logout", ...LOGOUT_CAUSES] as InternalCause[]) {
      for (const grade of GRADES) {
        const e = CAUSE_VOCAB[cause].by[grade];
        expect(e.promptLine, `${cause}/${grade}`).toBeNull();
        expect(e.tag).toBe("Unknown");
      }
    }
    expect(CAUSE_VOCAB.unknown.by.definitive.label).toBe("Not recorded");
    expect(CAUSE_VOCAB.unknown.by.definitive.sentence(bare)).toBe("The log does not say.");
    expect(CAUSE_VOCAB.restrained_logout.by.definitive.label).toBe("No cause given");
    expect(CAUSE_VOCAB.restrained_logout.by.definitive.sentence(bare)).toBe("No cause is given for this death.");
  });

  it("no label and no credit string says \"killed by NAME\", \"NAME's\" or \"confirmed kill\"", () => {
    const credit = Object.values(CREDIT_TEXT).flatMap((c) =>
      [c.sentenceSuffix(NAME), c.caption(NAME), c.operatorCaption, c.listLabel, c.listFootnote, c.writerLine(NAME)]);
    const trapRows = (["explosive_trap", "landmine"] as const).flatMap((c) => GRADES.flatMap((g) => stringsOf(c, g)));
    for (const s of [...credit, ...trapRows, CREDIT_DIRECTIVE(NAME, "tripwire"), CREDIT_DIRECTIVE(NAME, "land_mine"),
      TRAP_QUALIFIED_LINE, TRAP_KILLS_CAVEAT(1, 0)]) {
      expect(s).not.toMatch(new RegExp(`killed by ${NAME}`, "i"));
      expect(s).not.toContain(`${NAME}'s`);
      expect(s).not.toMatch(/confirmed kill/i);
    }
    // The only rows whose label may hold a name are the two the kill line names a killer on.
    for (const [key, row] of Object.entries(PUBLIC_ROWS)) {
      if (key === "pvp" || key === "held_grenade") continue;
      expect(row.stated(full).label, key).not.toContain(NAME);
      expect(inferredOf(row, full).label, key).not.toContain(NAME);
    }
  });

  it("the driver is the only other name a sentence may hold, and never as the killer", () => {
    for (const [key, row] of Object.entries(PUBLIC_ROWS)) {
      if (key === "pvp" || key === "held_grenade") continue;
      const s = row.stated(full);
      if (key === "hit_by_vehicle_driver") {
        expect(s.sentence).toBe(`Hit by a vehicle. The log puts ${NAME} in the driver's seat.`);
      } else {
        expect(s.sentence, key).not.toContain(NAME);
      }
      expect(s.promptLine, key).not.toContain(NAME);
    }
  });

  it("no public string says \"Trap kills\"", () => {
    for (const s of everyPublicString()) expect(s).not.toMatch(/trap kills/i);
  });

  it("no definitive or strong string contains \"Likely\"", () => {
    for (const cause of causes) {
      for (const grade of ["definitive", "strong"] as const) {
        for (const s of stringsOf(cause, grade)) expect(s, `${cause}/${grade}`).not.toMatch(/likely/i);
      }
    }
    for (const w of Object.values(LOGOUT_SENTENCE)) {
      expect(w!.strong).not.toMatch(/likely/i);
      expect(w!.promptLine).not.toMatch(/likely/i);
    }
    expect(CAPTION.strong).not.toMatch(/likely/i);
  });

  it("the words pneumonia, silicosis and heatstroke appear in no public string", () => {
    for (const s of everyPublicString()) expect(s).not.toMatch(/pneumonia|silicosis|heat ?stroke/i);
  });

  it("no public string hints at how a player left the server", () => {
    for (const s of everyPublicString()) {
      expect(s).not.toMatch(/logged (out|off)|log ?out|disconnect|respawn|combat log|gave up|left the server|quit|unconscious|restrain/i);
    }
  });

  it("a death after a knock-out is worded \"died after\", never \"killed\"", () => {
    for (const w of Object.values(LOGOUT_SENTENCE)) {
      for (const s of [w!.strong, w!.inferred, w!.promptLine, w!.inferredPromptLine]) {
        expect(s).toMatch(/died after/i);
        expect(s).not.toMatch(/killed/i);
      }
    }
  });

  it("every upstream word that is published has knock-out wording, and the rest are withheld", () => {
    for (const [word, key] of Object.entries(UPSTREAM_TO_PUBLIC)) {
      if (key) expect(LOGOUT_SENTENCE[key], word).toBeDefined();
    }
    for (const word of ["player", "mixed", "own_bear_trap", "barbed_wire", "vehicle_run_over", "unknown"]) {
      expect(UPSTREAM_TO_PUBLIC[word], word).toBeNull();
    }
    expect(UPSTREAM_TO_PUBLIC.infected).toBe("infected");
    expect(UPSTREAM_TO_PUBLIC.vehicle).toBe("vehicle_crash");
  });

  it("every token in tokens.ts has a vocabulary row", () => {
    // Compile-time through `Record<InternalCause, …>`; the count catches a duplicate or a cast.
    expect(causes.length).toBe(INTERNAL_CAUSES.length);
    expect(new Set(INTERNAL_CAUSES).size).toBe(INTERNAL_CAUSES.length);
    for (const cause of INTERNAL_CAUSES) {
      expect(CAUSE_VOCAB[cause], cause).toBeDefined();
      expect(PUBLIC_ROWS[CAUSE_VOCAB[cause].key], cause).toBeDefined();
    }
    expect(isInternalCause("explosive_trap")).toBe(true);
    expect(isInternalCause("toString")).toBe(false);
    expect(new Set(ATTRIBUTION_ROLES).size).toBe(ATTRIBUTION_ROLES.length);
    expect(new Set(CONTRIBUTOR_ROLES).size).toBe(CONTRIBUTOR_ROLES.length);
    expect(ATTRIBUTION_ROLES.filter((r) => (CONTRIBUTOR_ROLES as readonly string[]).includes(r))).toEqual([]);
  });

  it("the wording of the table", () => {
    const d = (c: InternalCause) => CAUSE_VOCAB[c].by.definitive;
    const i = (c: InternalCause) => CAUSE_VOCAB[c].by.inferred;
    const withObject = (key: keyof typeof OBJECT_LABEL): WordingInput => ({ ...bare, object: OBJECT_LABEL[key] });
    expect(d("explosive_trap").label).toBe("Tripwire");
    expect(d("explosive_trap").sentence(withObject("m67_grenade"))).toBe("Killed by a tripwire rigged with an M67 frag grenade.");
    expect(d("explosive_trap").promptLine!(withObject("claymore"))).toBe("killed by a tripwire rigged with a claymore");
    expect(d("landmine").sentence(bare)).toBe("Killed by a land mine.");
    expect(d("explosive_grenade").sentence(withObject("m67_grenade"))).toBe("Killed by an M67 frag grenade. The log names no thrower.");
    expect(d("explosive_40mm").label).toBe("Explosion");
    expect(d("explosive_40mm").sentence(withObject("round_40mm"))).toBe("Killed by a 40mm explosive round.");
    expect(d("self_inflicted_explosive").label).toBe("Own explosive");
    expect(d("self_inflicted_explosive").sentence(withObject("m79"))).toBe("Killed by their own 40mm round.");
    expect(d("fuel_explosion").label).toBe("Fuel pump explosion");
    expect(d("fire").sentence(bare)).toBe("Died of burns from a fire.");
    expect(d("animal_wolf").label).toBe("Wolf");
    expect(d("animal_dog").sentence(bare)).toBe("Killed by a dog.");
    expect(d("fall").label).toBe("Fell");
    expect(d("vehicle_impact").sentence(bare)).toBe("Hit by a vehicle. The log names no driver.");
    expect(d("vehicle_own_crash").label).toBe("Motorbike crash");
    expect(i("vehicle_own_crash").label).toBe("Likely a motorbike crash");
    expect(i("vehicle_crash_occupant").sentence(bare)).toBe("Likely died in a vehicle crash.");
    expect(d("starvation_and_dehydration").label).toBe("Starvation and thirst");
    expect(i("starvation").promptLine!(bare)).toBe("most likely starved");
    expect(i("dehydration").sentence(bare)).toBe("Likely died of thirst.");
    expect(i("cold_exposure").label).toBe("Likely exposure");
    expect(d("heatstroke_or_silicosis").label).toBe("Exposure");
    expect(i("pneumonia").label).toBe("Likely illness");
    expect(i("pneumonia").promptLine!(bare)).toBe("most likely died of illness");
    expect(i("infected").sentence(bare)).toBe("Likely killed by infected.");
    expect(d("pvp").sentence(full)).toBe("Killed by Placer One with M4-A1 from 212 m.");
    expect(d("pvp").promptLine!(full)).toBe("killed by another player (Placer One), M4-A1, from 212 m");
    expect(d("explosive_held_grenade").sentence(full)).toBe("Killed by Placer One (a grenade).");
    expect(d("suicide").label).toBe("Suicide");
    expect(d("self_inflicted").sentence(bare)).toBe("Died by their own weapon.");
    expect(d("pvp_bleedout").label).toBe("Bled out");
    expect(PUBLIC_ROWS.pvp_unnamed.stated(bare).sentence).toBe("Killed by another player. The log has no kill line, so no name is given.");
    expect(PUBLIC_ROWS.pvp_unnamed.inferred!.label).toBe("Likely killed");
    expect(PUBLIC_ROWS.shot.stated(bare).sentence).toBe("Shot. The log names no shooter.");
    expect(PUBLIC_ROWS.shot.tag).toBe("Gunfire");
    expect(CAPTION).toEqual({ definitive: null, strong: "Worked out from the log", inferred: "Best reading of the log. The server recorded no cause." });
  });

  it("the trap credit wording", () => {
    expect(CREDIT_TEXT.tripwire.sentenceSuffix(NAME)).toBe("Kill credited to Placer One.");
    expect(CREDIT_TEXT.tripwire.caption(NAME)).toBe("The log names no killer. Placer One placed the only tripwire it records at this spot.");
    expect(CREDIT_TEXT.land_mine.caption(NAME)).toBe("The log names no killer. Placer One placed the only land mine it records at this spot.");
    expect(CREDIT_TEXT.land_mine.operatorCaption).toBe("The log names no killer. Credited by the server operator.");
    expect(CREDIT_TEXT.tripwire.listLabel).toBe("by trap");
    expect(CREDIT_TEXT.tripwire.listFootnote).toBe("By trap: credited from where the trap was placed. The log names no killer.");
    expect(CREDIT_TEXT.tripwire.writerLine(NAME)).toBe(
      "The record names no killer. The only tripwire on record that fits was set by Placer One, who is credited with the kill.");
    expect(TRAP_QUALIFIED_LINE).toBe("A trap kill credited. The life counts from here.");
    expect(TRAP_KILLS_CAVEAT(1, 2)).toMatch(/^1 of the kills this life and 2 of the earlier kills are credited from a trap this player set\./);
    expect(CREDIT_DIRECTIVE(NAME, "tripwire")).toMatch(/^You may say Placer One is credited with the kill or that Placer One set a tripwire\. Never write/);
    expect(CREDIT_DIRECTIVE(NAME, "land_mine")).toContain("set a land mine");
    expect(NOT_CONFIRMED_HEADING).toBe("NOT CONFIRMED: the paper's reading");
  });

  it("objects: the classifier's wording to a public key", () => {
    expect(objectKeyFromText("Tripwire + M67 frag grenade")).toBe("m67_grenade");
    expect(objectKeyFromText("fists holding 6-M7 Frag Grenade")).toBe("m67_grenade");
    expect(objectKeyFromText("Tripwire + RGD-5 frag grenade")).toBe("rgd5_grenade");
    expect(objectKeyFromText("Tripwire + Claymore")).toBe("claymore");
    expect(objectKeyFromText("Land mine")).toBe("land_mine");
    expect(objectKeyFromText("40mm explosive round")).toBe("round_40mm");
    expect(objectKeyFromText("M79 (40mm explosive round)")).toBe("m79");
    expect(objectKeyFromText("Plastic explosive")).toBe("plastic_explosive");
    expect(objectKeyFromText("Fireplace")).toBe("fireplace");
    expect(objectKeyFromText("Land_FuelStation_Feed")).toBe("fuel_pump");
    expect(objectKeyFromText("Land_FuelStation_Feed_Enoch")).toBe("fuel_pump");
    expect(objectKeyFromText("Motorbike_02_Red")).toBe("motorbike");
    expect(objectKeyFromText("CivilianSedan")).toBe("car");
    expect(objectKeyFromText("Truck_01_Covered_Blue")).toBe("car");
    expect(objectKeyFromText("Barbed wire (Fence)")).toBe("barbed_wire");
    // Knives, guns, infected and animals have no key: the cause already says what they were.
    for (const t of ["SteakKnife", "M4-A1", "ZmbM_PatrolNormal_Autumn", "Animal_CanisLupus_Grey", "Boat_01_Blue", "", "toString"]) {
      expect(objectKeyFromText(t), t).toBeNull();
    }
    expect(objectKeyFromText(null)).toBeNull();
    for (const key of Object.values(OBJECT_KEY_FROM_TEXT)) expect(OBJECT_LABEL[key]).toBeDefined();
  });

  it("the pending words are the specific ones the death line can state", () => {
    expect(Object.keys(STATED_COARSE).sort()).toEqual(
      ["animal", "bear", "bled_out", "drowned", "explosion", "fall", "infected", "pvp", "suicide", "vehicle", "wolf"]);
    for (const word of ["died", "environment", "unknown"]) expect(STATED_COARSE[word]).toBeUndefined();
  });
});
