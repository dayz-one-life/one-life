import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { readClassified, refOfUid, type Project } from "../../scripts/golden-io.js";
import { buildDeathContext, classifyDeath, wholeCorpusContext, type CreditEvidence } from "../../src/index.js";
import { corpusOf, goldenReady, layout, olFixtures, report } from "./golden.js";

/**
 * The evidence half of the trap-kill bar on every real trap death — PRIVATE data.
 *
 *   $DEATH_GOLDEN_DIR/credits.expected.json   uid -> the reviewed result of tests 1 to 5
 *
 * Every death the reference put down to a tripwire or a land mine (its rules A06, A07, A09), in
 * both projects, is classified from the whole log and its credit evidence must equal the reviewed
 * answer: the outcome, the placer, the placement line, the distance, the age, how many times the
 * server restarted in between, and the flags. The One Life rows were checked by hand against the
 * design's table of the six cases. The Clan Wars rows are base rates.
 *
 * ⚠️ `evidence_passes` is the evidence only, and the classifier never says more. The kill itself
 * also needs the two tests the database decides, which no golden suite can run. No real trap death
 * carries a flag for a shape the bar was not measured on (two trips, a fuse that is not 4 s, no
 * blast line, several blasts or kill lines, a frag in the victim's hand, someone else's claymore):
 * the reviewed answers hold exactly the flags the code gives.
 */
const ready = goldenReady("credits-golden.test", layout?.classified, layout?.creditsExpected, layout?.olFixtures, layout?.ol.raw, layout?.cw.raw);
const TRAP_RULES = new Set(["A06", "A07", "A09"]);
type Row = CreditEvidence & { rule: string };

describe.skipIf(!ready)("trap-kill evidence on the real trap deaths (private data)", () => {
  const want = () => JSON.parse(readFileSync(layout!.creditsExpected, "utf8")) as { counts: Record<string, number>; deaths: Record<string, Row> };

  it("every trap death of both projects gives the reviewed evidence, and every one passes tests 1 to 5", () => {
    const { deaths } = want();
    const failed: { uid: string; why: string }[] = [];
    const seen = { OL: 0, CW: 0 };
    let neighbourSpent = 0;
    for (const project of ["OL", "CW"] as Project[]) {
      for (const row of readClassified(layout!.classified, project)) {
        if (!TRAP_RULES.has(row.expected.rule)) continue;
        seen[project] += 1;
        const expected = deaths[row.uid];
        if (!expected) { failed.push({ uid: row.uid, why: "missing from credits.expected.json" }); continue; }
        const v = classifyDeath(wholeCorpusContext(corpusOf(project).get(row.serverId)!, refOfUid(row.uid)));
        const got = v.evidence.credit;
        const { rule, ...evidence } = expected;
        if (v.rule !== rule) failed.push({ uid: row.uid, why: "rule differs" });
        else if (JSON.stringify(got) !== JSON.stringify(evidence)) failed.push({ uid: row.uid, why: "evidence differs from the reviewed answer" });
        else if (got!.outcome !== "evidence_passes" || got!.refusedBy != null) failed.push({ uid: row.uid, why: "refused a real trap death does not pass tests 1 to 5" });
        // the placer the bar names is the trap owner the reference names
        else if (got!.placerDayzId !== row.expected.attributedTo?.id || v.attribution?.basis !== "placement") failed.push({ uid: row.uid, why: "placer is not the reference's trap owner, or its basis is not placement" });
        else if (got!.distanceM == null || got!.ageHours == null || got!.boots == null || got!.placement == null) failed.push({ uid: row.uid, why: "figures missing" });
        if (got?.flags.includes("neighbour_spent")) neighbourSpent += 1;
      }
    }
    // Six One Life and twelve Clan Wars trap deaths; two pass only because the neighbour's wire in
    // the ring had already been tripped.
    expect(seen).toEqual({ OL: 6, CW: 12 });
    expect(Object.keys(deaths).length).toBe(18);
    expect(neighbourSpent).toBe(2);
    expect(report("trap-kill evidence", failed)).toBe("");
  }, 300_000);

  it("the lines selected for a death are enough for its credit evidence, and no other death has any", () => {
    const { deaths } = want();
    const failed: { uid: string; why: string }[] = [];
    let trap = 0;
    for (const f of olFixtures()) {
      const credit = classifyDeath(buildDeathContext(f)).evidence.credit;
      if (!TRAP_RULES.has(f.expected.rule)) {
        if (credit != null) failed.push({ uid: f.uid, why: "scope credit evidence on a death that is not a trap death" });
        continue;
      }
      trap += 1;
      const { rule: _rule, ...evidence } = deaths[f.uid] ?? ({} as Row);
      if (JSON.stringify(credit) !== JSON.stringify(evidence)) failed.push({ uid: f.uid, why: "selection gives different evidence than the whole log" });
    }
    expect(trap).toBe(6);
    expect(report("trap-kill evidence from the selection", failed)).toBe("");
  });
});
