import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildDeathContext, classifyDeath, CLASSIFIER_VERSION } from "../../src/index.js";
import { failedChecks, goldenReady, layout, olFixtures, report } from "./golden.js";

/**
 * The parity gate — PRIVATE data. The classifier against the reference's answer for every One
 * Life death, on ten checks, with a ratchet.
 *
 *   $DEATH_GOLDEN_DIR/ol/<uid>.json.gz     one fixture per death (scripts/build-golden.ts)
 *   $DEATH_GOLDEN_DIR/known-gaps.json      uid -> why this death does not pass yet
 *   $DEATH_GOLDEN_DIR/parity.expected.json the totals the finished classifier must reach
 *
 * The ratchet: the suite fails when a death listed in `known-gaps.json` passes all ten checks
 * (delete it from the list), and when a death not listed fails any. So the list can only shrink,
 * and it is the honest measure of how much of the classifier is ported. Readers and the newsdesk
 * may not ship while it is not empty.
 *
 * ⚠️ Only the stated rules are ported (a kill line, or a stated mechanism on a bare death line).
 * The deaths the reference decides by inference are the known gaps; `stated-golden` checks they
 * are exactly those, and that every stated death of both projects passes.
 *
 * This suite does not write the attestation and cannot make one happen on its own: it hands its
 * counts to the golden reporter (`scripts/golden-reporter.ts`), which records a run only when
 * EVERY golden suite passed. `fixtures-golden` is what ties each fixture's `expected` to the
 * reference's answer file.
 */
const ready = goldenReady("golden-parity.test", layout?.classified, layout?.olFixtures, layout?.knownGaps, layout?.parityExpected);
describe.skipIf(!ready)("parity with the reference classifier (private data, the gate)", () => {
  it("every death passes the ten checks, except the known gaps — and every known gap still fails", ({ task }) => {
    const gaps = JSON.parse(readFileSync(layout!.knownGaps, "utf8")) as Record<string, string>;
    const fixtures = olFixtures();
    const failed: { uid: string; why: string }[] = [];
    const totals = { definitive: 0, strong: 0, inferred: 0, killLine: 0 };
    let passed = 0, clockOrLines = 0;
    for (const f of fixtures) {
      const v = classifyDeath(buildDeathContext(f));
      const bad = failedChecks(v, f.expected, f.uid);
      if (bad.includes(8) || bad.includes(9)) clockOrLines += 1;
      if (bad.length === 0) {
        passed += 1;
        if (v.confidence !== "unknown") totals[v.confidence] += 1;
        if (v.attribution?.basis === "kill_line") totals.killLine += 1;
        if (f.uid in gaps) failed.push({ uid: f.uid, why: "passes but is still listed in known-gaps.json" });
      } else if (!(f.uid in gaps)) failed.push({ uid: f.uid, why: `check${bad.join(",")} fails and the death is not a known gap` });
    }
    const known = new Set(fixtures.map((f) => f.uid));
    for (const uid of Object.keys(gaps)) if (!known.has(uid)) failed.push({ uid, why: "listed in known-gaps.json but is not a golden death" });

    expect(fixtures.length).toBe(280);
    // The death time and the death lines do not wait for a rule: they hold for every death now.
    expect(clockOrLines).toBe(0);
    expect(report("parity", failed)).toBe("");

    const nGaps = Object.keys(gaps).length;
    expect(passed + nGaps).toBe(fixtures.length);
    if (nGaps === 0) {
      const want = JSON.parse(readFileSync(layout!.parityExpected, "utf8")) as typeof totals & { rows: number };
      expect({ rows: fixtures.length, ...totals }).toEqual(want);
    }
    task.meta.goldenOutcome = { classifierVersion: CLASSIFIER_VERSION, rows: fixtures.length, passed, gaps: nGaps, totals };
  }, 120_000);
});

