import { describe, it, expect } from "vitest";
import {
  CAPTION, CREDIT_DIRECTIVE, CREDIT_TEXT, INFERRED_CAUSE_DIRECTIVE, INTERNAL_CAUSES, LOGOUT_SENTENCE, NAMES_NO_PERSON_DIRECTIVE,
  NOT_CONFIRMED_HEADING, OBJECT_LABEL, PUBLIC_ROWS, STRONG_CAUSE_DIRECTIVE, TRAP_KILLS_CAVEAT, WITHHELD_DIRECTIVE,
  type Confidence, type InternalCause, type PublicCauseKey,
} from "@onelife/death-verdict";
import { buildObituaryPrompt, composeTags, NO_MECHANISM_DIRECTIVE, type Obituary } from "../src/prompt.js";
import { findPlaceViolations } from "../src/no-place.js";
import { LOGOUT_WORDS } from "../src/cause-check.js";
import type { ObituaryFacts } from "../src/facts.js";
import { factsFor } from "./facts-fixture.js";

/**
 * What the writer is told about the death, for every cause and certainty (death-verdict spec 6.1).
 * ⚠️ Invented names only.
 */

const CONFIDENCES: Confidence[] = ["definitive", "strong", "inferred", "unknown"];
const LOGOUT: InternalCause[] = ["respawn_while_unconscious", "unconscious_logout", "logout_under_attack"];
const UPSTREAMS = ["infected", "fall", "explosion", "vehicle_crash", "starvation_and_dehydration", "player", "mixed", "unknown"];

/** Every stored shape worth printing: each cause at each confidence, and each logout cause over
 *  each upstream at each upstream confidence. */
function allFacts(): { label: string; facts: ObituaryFacts }[] {
  const out: { label: string; facts: ObituaryFacts }[] = [];
  for (const cause of INTERNAL_CAUSES) {
    for (const confidence of CONFIDENCES) {
      if (LOGOUT.includes(cause)) {
        for (const up of UPSTREAMS) for (const uc of CONFIDENCES) {
          out.push({ label: `${cause}/${up}:${uc}`, facts: factsFor({ verdict: { cause, confidence, upstream: { cause: up, confidence: uc } } }) });
        }
        continue;
      }
      out.push({ label: `${cause}:${confidence}`, facts: factsFor({ verdict: { cause, confidence } }) });
    }
  }
  return out;
}
const ALL = allFacts();

/** The prompt split at the NOT CONFIRMED heading: what is above is sent as confirmed. */
function halves(f: ObituaryFacts): { confirmed: string; unconfirmed: string; user: string } {
  const { user } = buildObituaryPrompt(f);
  const i = user.indexOf(NOT_CONFIRMED_HEADING);
  return i < 0 ? { confirmed: user, unconfirmed: "", user } : { confirmed: user.slice(0, i), unconfirmed: user.slice(i), user };
}

const wrap = (text: string): Obituary => ({ headline: "H", lede: text, body: "B", pullQuote: null, tags: [] });

describe("the cause table, for every cause and certainty", () => {
  it.each(ALL.map((a) => [a.label, a.facts] as const))("%s: line, directive tier and tag agree with the death", (_l, f) => {
    const { confirmed, unconfirmed } = halves(f);
    const line = f.brief.line;
    // Tag.
    expect(composeTags(f, [])[2]).toBe(f.death.tag);
    // Line and tier.
    if (f.death.certainty === "definitive" || f.death.certainty === "strong") {
      if (line) expect(confirmed).toContain(`- Cause of death: ${line}.`);
      expect(confirmed.includes(STRONG_CAUSE_DIRECTIVE)).toBe(f.death.certainty === "strong");
      expect(unconfirmed).not.toContain("Cause of death");
      expect(unconfirmed).not.toContain(INFERRED_CAUSE_DIRECTIVE);
    } else if (f.death.certainty === "inferred") {
      expect(line).toMatch(/^most likely /);
      expect(confirmed).not.toContain("Cause of death");
      expect(confirmed).not.toContain(line!);
      expect(unconfirmed).toContain(`- Cause of death (the paper's reading): ${line}\n${INFERRED_CAUSE_DIRECTIVE}`);
    } else {
      expect(line).toBeNull();
      expect(confirmed + unconfirmed).not.toContain("Cause of death");
      expect(f.death.tag).toBe("Unknown");
    }
  });
});

describe("what the writer is told", () => {
  it("unknown and withheld send no cause line", () => {
    const unknown = halves(factsFor({ verdict: { cause: "unknown", confidence: "unknown" } }));
    expect(unknown.user).not.toContain("Cause of death");
    expect(unknown.user).toContain(NO_MECHANISM_DIRECTIVE);
    const withheld = halves(factsFor({ verdict: { cause: "restrained_logout", confidence: "definitive" } }));
    expect(withheld.user).not.toContain("Cause of death");
    expect(withheld.user).toContain(WITHHELD_DIRECTIVE);
    expect(withheld.user).not.toContain(NO_MECHANISM_DIRECTIVE);
  });

  it("an inferred cause sends its \"most likely\" line under the NOT CONFIRMED heading with the directive, and nothing about it under the confirmed header", () => {
    const h = halves(factsFor({ verdict: { cause: "starvation", confidence: "inferred" } }));
    expect(h.unconfirmed).toContain("most likely starved");
    expect(h.unconfirmed).toContain(INFERRED_CAUSE_DIRECTIVE);
    expect(h.confirmed).not.toMatch(/starv/i);
  });

  const credit = { gamertag: "Placer Person", device: "tripwire" as const, byOperator: false };
  const trap = { cause: "explosive_trap" as const, objectKey: "m67_grenade" as const, attrBasis: "placement" as const };

  it("a trap death with a credit sends the credit line and directive and not the names-no-person directive", () => {
    const h = halves(factsFor({ verdict: trap, credit }));
    expect(h.confirmed).toContain("- Cause of death: killed by a tripwire rigged with an M67 frag grenade.");
    expect(h.unconfirmed).toContain(`- ${CREDIT_TEXT.tripwire.writerLine("Placer Person")}`);
    expect(h.unconfirmed).toContain(CREDIT_DIRECTIVE("Placer Person", "tripwire"));
    expect(h.confirmed).not.toContain("Placer Person");
    expect(h.user).not.toContain(NAMES_NO_PERSON_DIRECTIVE);
  });

  it("a trap death without one sends the names-no-person directive", () => {
    const h = halves(factsFor({ verdict: trap }));
    expect(h.user).toContain(NAMES_NO_PERSON_DIRECTIVE);
    expect(h.user).not.toContain(NOT_CONFIRMED_HEADING);
  });

  it("the trap-kill caveat is sent when this-life trap kills are above zero", () => {
    const h = halves(factsFor({ verdict: { cause: "fall" }, kills: [{ distanceMeters: null, basis: "trap_placement" }, { distanceMeters: 30 }] }));
    expect(h.unconfirmed).toContain(TRAP_KILLS_CAVEAT(1, 0));
    expect(h.confirmed).toContain("- Kills this life: 2");
  });

  it("...when only prior trap kills are above zero", () => {
    const h = halves(factsFor({ verdict: { cause: "fall" }, priors: { livesLived: 3, totalKills: 4, trapKills: 2 } }));
    expect(h.unconfirmed).toContain(TRAP_KILLS_CAVEAT(0, 2));
    expect(h.confirmed).toContain("- Kills across all prior lives: 4");
  });

  it("...and not when both are zero", () => {
    const h = halves(factsFor({ verdict: { cause: "fall" }, kills: [{ distanceMeters: 30 }], priors: { livesLived: 3, totalKills: 4 } }));
    expect(h.user).not.toContain("credited from a trap");
    expect(h.user).not.toContain(NOT_CONFIRMED_HEADING);
  });

  it("the prompt never says \"Confirmed kills\"", () => {
    for (const { facts } of ALL) expect(buildObituaryPrompt(facts).user).not.toMatch(/confirmed kills/i);
  });

  it("the credit line contains no word on the no-place list and neither \"spot\" nor \"there\"", () => {
    for (const device of ["tripwire", "land_mine"] as const) {
      const line = CREDIT_TEXT[device].writerLine("Placer Person");
      expect(findPlaceViolations(wrap(line), { exempt: ["Placer Person"] })).toEqual([]);
      expect(line).not.toMatch(/\b(?:spot|there)\b/i);
      const directive = CREDIT_DIRECTIVE("Placer Person", device);
      expect(findPlaceViolations(wrap(directive), { exempt: ["Placer Person"] })).toEqual([]);
    }
  });

  it("every sentence, writer line and directive passes findPlaceViolations when wrapped in an Obituary", () => {
    const texts: string[] = [
      INFERRED_CAUSE_DIRECTIVE, STRONG_CAUSE_DIRECTIVE, WITHHELD_DIRECTIVE, NAMES_NO_PERSON_DIRECTIVE, NO_MECHANISM_DIRECTIVE,
      TRAP_KILLS_CAVEAT(1, 2), ...Object.values(CAPTION).filter((c): c is string => !!c),
    ];
    const objects = [null, ...Object.values(OBJECT_LABEL)];
    for (const key of Object.keys(PUBLIC_ROWS) as PublicCauseKey[]) {
      const row = PUBLIC_ROWS[key];
      for (const object of objects) {
        const w = row.stated({ name: "Killer Two", weapon: "M4", distance: 100, object, conditions: ["starving"] });
        texts.push(w.label, w.sentence, w.promptLine);
      }
    }
    for (const s of Object.values(LOGOUT_SENTENCE)) if (s) texts.push(...Object.values(s));
    for (const { facts } of ALL) {
      texts.push(facts.death.label, facts.death.sentence, ...(facts.brief.line ? [facts.brief.line] : []), ...facts.brief.directives);
    }
    const bad = [...new Set(texts)].map((t) => [t, findPlaceViolations(wrap(t), { exempt: ["Killer Two"] })] as const).filter(([, v]) => v.length);
    expect(bad).toEqual([]);
  });

  it("the names-no-person directive is sent for trap, mine, grenade, explosion, fuel pump, vehicle and fire, and not for suicide, infected or animals", () => {
    const sends = (cause: InternalCause) =>
      buildObituaryPrompt(factsFor({ verdict: { cause } })).user.includes(NAMES_NO_PERSON_DIRECTIVE);
    for (const c of ["explosive_trap", "landmine", "explosive_grenade", "explosive_40mm", "explosive_other", "fuel_explosion", "vehicle_impact", "vehicle_own_crash", "vehicle_crash_occupant", "fire"] as InternalCause[]) {
      expect(sends(c), c).toBe(true);
    }
    for (const c of ["suicide", "infected", "animal_wolf", "animal_bear", "animal_dog"] as InternalCause[]) {
      expect(sends(c), c).toBe(false);
    }
  });

  it("a logout-family death sends only the upstream line and no logout word anywhere in the prompt", () => {
    for (const cause of LOGOUT) {
      const f = factsFor({ verdict: { cause, confidence: "definitive", upstream: { cause: "infected", confidence: "definitive" } } });
      const { system, user } = buildObituaryPrompt(f);
      expect(user).toContain("- Cause of death: died after being attacked by the infected.");
      for (const re of LOGOUT_WORDS) {
        expect(re.test(user), String(re)).toBe(false);
        expect(re.test(system), String(re)).toBe(false);
      }
      expect(user).not.toMatch(/unconscious|knock/i);
    }
  });
});
