import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { Fixture } from "../../scripts/golden-io.js";
import { buildDeathContext, classifyDeath, CLASSIFIER_VERSION, objectKeyFromText, refKey, type InternalVerdict } from "../../src/index.js";
import { goldenReady, layout, olFixtures, report } from "./golden.js";

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
 * ⚠️ `classifyDeath` is a stub in this step: every death is a known gap. Two of the ten checks
 * already bite — the death time and the death lines come from the context, not from a rule.
 *
 * This suite does not write the attestation and cannot make one happen on its own: it hands its
 * counts to the golden reporter (`scripts/golden-reporter.ts`), which records a run only when
 * EVERY golden suite passed. `fixtures-golden` is what ties each fixture's `expected` to the
 * reference's answer file.
 */
const ready = goldenReady("golden-parity.test", layout?.classified, layout?.olFixtures, layout?.knownGaps, layout?.parityExpected);
const sameSet = (a: readonly string[], b: readonly string[]) => JSON.stringify([...new Set(a)].sort()) === JSON.stringify([...new Set(b)].sort());

/** The numbers of the checks a verdict fails, 1 to 10 as the design numbers them. */
function failedChecks(v: InternalVerdict, f: Fixture): number[] {
  const e = f.expected, bad: number[] = [];
  if (v.cause !== e.cause) bad.push(1);
  if (v.confidence !== e.confidence || v.mechanismStated !== e.mechanismStated) bad.push(2);
  if (v.rule !== e.rule) bad.push(3);
  if ((v.upstream?.cause ?? null) !== e.upstreamCause || (v.upstream?.confidence ?? null) !== e.upstreamConfidence) bad.push(4);
  if (!sameSet(v.coCauses, e.coCauses)) bad.push(5);
  const text = v.object?.text ?? null;
  if (text !== e.weaponOrObject || (v.object?.key ?? null) !== (text == null ? null : objectKeyFromText(text))) bad.push(6);
  const a = v.attribution, ea = e.attributedTo;
  if ((a == null) !== (ea == null) || (a && ea && (a.role !== ea.role || a.dayzId !== ea.id || a.confidence !== ea.confidence))) bad.push(7);
  if (v.deathAt !== e.utc) bad.push(8);
  const lines = (xs: { admFileId: number; lineIndex: number; role: string }[]) => xs.map((l) => `${refKey(l)}=${l.role}`).join(" ");
  if (lines(v.deathLines) !== lines(e.deathLines.map((l) => ({ ...l.ref, role: l.role }))) || `${f.project}-${f.serverId}-${v.deathRef.admFileId}-${v.deathRef.lineIndex}` !== f.uid) bad.push(9);
  if (!sameSet(v.evidence.flags, e.flags) || !sameSet(v.evidence.contributors.map((c) => c.dayzId), e.contributorIds)) bad.push(10);
  return bad;
}

describe.skipIf(!ready)("parity with the reference classifier (private data, the gate)", () => {
  it("every death passes the ten checks, except the known gaps — and every known gap still fails", ({ task }) => {
    const gaps = JSON.parse(readFileSync(layout!.knownGaps, "utf8")) as Record<string, string>;
    const fixtures = olFixtures();
    const failed: { uid: string; why: string }[] = [];
    const totals = { definitive: 0, strong: 0, inferred: 0, killLine: 0 };
    let passed = 0, clockOrLines = 0;
    for (const f of fixtures) {
      const v = classifyDeath(buildDeathContext(f));
      const bad = failedChecks(v, f);
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

