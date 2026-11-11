import { describe, it, expect } from "vitest";
import { buildDeathContext, classifyDeath, wholeCorpusContext } from "../../src/index.js";
import { contextDigest, corpusOf, cwFixtures, differences, goldenReady, layout, olFixtures, report, selectionProbe } from "./golden.js";

/**
 * Sufficiency of the selection — PRIVATE data.
 *
 * Every golden death is read twice: from the lines `selectContextLines` kept for it (the
 * fixture), and from the whole server log with nothing left out. The verdicts must be deep-equal,
 * evidence and contributors included. A difference means a rule read a line the selection drops.
 *
 * ⚠️ UNPROVEN until step 4. `classifyDeath` is a stub, so the verdicts are equal whatever the
 * selection drops. What stands in for them until the rules exist:
 * - the whole context digest (everything the context computes — all of it within five minutes and
 *   150 m of the death), and
 * - `selectionProbe`: the life-long lines the later rules will read — company along the whole
 *   life, mentions for twenty minutes, placements near every hit, the credit ring — found
 *   independently in the whole log with the design's numbers and required to be in the selection.
 * The probe proves the windows are as wide as the design says. Only ported rules can prove the
 * design's windows are wide ENOUGH; from step 4 the verdict comparison is the real test.
 *
 * ⚠️ What real data does NOT pin, measured by changing one constant at a time and rebuilding the
 * fixtures: the credit ring (no golden trap death has an earlier detonation at its spot) and the
 * cluster windows (every real cluster spans under a second). Those rest on the invented-data
 * tests in `test/select.test.ts` and `test/cluster.test.ts`. Do not delete those as redundant.
 *
 * Only two things are allowed to differ in the digest, and no rule reads either: the corpse's
 * late `is choosing to respawn` line, and the line directly above the death when that is what
 * the digest probes (it is always inside the server window).
 */
const ready = goldenReady("select-sufficiency.test", layout?.ol.raw, layout?.cw.raw, layout?.olFixtures, layout?.cwFixtures);

function comparable(d: Record<string, unknown>): Record<string, unknown> {
  const r = d.record as { shape: string[]; death_lines: [string, string][] };
  return { ...d, record: { ...r, shape: r.shape.filter((s) => s !== "respawn_dead_form"), death_lines: r.death_lines.filter((l) => l[1] !== "respawn_dead") } };
}

describe.skipIf(!ready)("the selection is sufficient (private data)", () => {
  it("trimmed and whole-corpus contexts give deep-equal verdicts", () => {
    const failed: { uid: string; why: string }[] = [];
    for (const f of [...olFixtures(), ...cwFixtures()]) {
      const trimmed = buildDeathContext(f);
      const whole = wholeCorpusContext(corpusOf(f.project).get(f.serverId)!, f.deathRef);
      const verdicts = differences(classifyDeath(trimmed), classifyDeath(whole));
      const contexts = differences(comparable(contextDigest(trimmed)), comparable(contextDigest(whole)));
      const probes = differences(selectionProbe(trimmed), selectionProbe(whole));
      if (verdicts.length) failed.push({ uid: f.uid, why: `verdict.${verdicts[0]}` });
      else if (contexts.length) failed.push({ uid: f.uid, why: [...new Set(contexts)].slice(0, 6).join(" ") });
      else if (probes.length) failed.push({ uid: f.uid, why: `probe.${[...new Set(probes)].slice(0, 6).join(" probe.")}` });
    }
    expect(olFixtures().length).toBe(280);
    expect(report("sufficiency", failed)).toBe("");
  }, 300_000);
});
