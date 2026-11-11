import { describe, it, expect } from "vitest";
import { readClassified, refOfUid, type Expected, type Project } from "../../scripts/golden-io.js";
import { buildDeathContext, classifyDeath, wholeCorpusContext } from "../../src/index.js";
import { corpusOf, cwFixtures, failedChecks, goldenReady, isStatedRule, layout, report } from "./golden.js";

/**
 * The stated rules against the reference, for EVERY death of both projects — PRIVATE data.
 *
 * The parity gate reads the 280 One Life deaths. Most rules fire on a handful of them, and some
 * on none; Clan Wars has thousands of kill-line deaths and every stated rule but two. So here
 * every death the reference decided by a stated rule (a kill line, or a stated mechanism on a bare
 * death line) is classified from the whole log and must pass the same ten checks. And every death
 * the reference decided by inference must come back as rule `B00`, unknown: a stated rule that
 * claims one of those is as wrong as one that misses.
 *
 * ⚠️ One deliberate difference. The reference has a last pass over a player's NEXT death: grenade
 * deaths seconds after respawning that follow each other are raised from inferred to strong and
 * flagged `spawn_reset_chain`. The port does not look at the future, so for those deaths the
 * answer is compared with that pass undone. No One Life death has the shape.
 */
const ready = goldenReady("stated-golden.test", layout?.classified, layout?.ol.raw, layout?.cw.raw, layout?.cwFixtures);

/** The reference's answer without its look at the next death. */
function withoutChain(e: Expected): Expected {
  if (!e.flags.includes("spawn_reset_chain")) return e;
  return { ...e, flags: e.flags.filter((f) => f !== "spawn_reset_chain"), attributedTo: e.attributedTo ? { ...e.attributedTo, confidence: "inferred" } : null };
}

describe.skipIf(!ready)("the stated rules vs the reference, every death (private data)", () => {
  for (const project of ["OL", "CW"] as Project[]) {
    it(`every ${project} death a stated rule decides passes the ten checks, and no other death is claimed`, () => {
      const rows = readClassified(layout!.classified, project);
      const failed: { uid: string; why: string }[] = [];
      let stated = 0, chains = 0;
      for (const row of rows) {
        const v = classifyDeath(wholeCorpusContext(corpusOf(project).get(row.serverId)!, refOfUid(row.uid)));
        if (!isStatedRule(row.expected.rule)) {
          if (v.rule !== "B00" || v.cause !== "unknown") failed.push({ uid: row.uid, why: `claimed an inferred death (${row.expected.rule}) was answered by ${v.rule}` });
          continue;
        }
        stated += 1;
        if (row.expected.flags.includes("spawn_reset_chain")) chains += 1;
        const bad = failedChecks(v, withoutChain(row.expected), row.uid);
        if (bad.length) failed.push({ uid: row.uid, why: `check${bad.join(",")} fails (${row.expected.rule}, answered ${v.rule})` });
      }
      expect(stated).toBeGreaterThan(0);
      if (project === "OL") expect(chains).toBe(0);
      expect(report(`stated rules (${project})`, failed)).toBe("");
    }, 900_000);
  }

  it("the Clan Wars rule fixtures: the stated ones pass, the inferred ones are not claimed", () => {
    const failed: { uid: string; why: string }[] = [];
    const rules = new Set<string>();
    for (const f of cwFixtures()) {
      const v = classifyDeath(buildDeathContext(f));
      if (!isStatedRule(f.expected.rule)) {
        if (v.rule !== "B00") failed.push({ uid: f.uid, why: `claimed an inferred death (${f.expected.rule}) was answered by ${v.rule}` });
        continue;
      }
      rules.add(f.expected.rule);
      const bad = failedChecks(v, withoutChain(f.expected), f.uid);
      if (bad.length) failed.push({ uid: f.uid, why: `check${bad.join(",")} fails (${f.expected.rule})` });
    }
    // The stated rules One Life has not hit, as far as either project ever fired them.
    expect([...rules].sort()).toEqual(["A01", "A03", "A05", "A10", "A14", "B07", "B08c"]);
    expect(report("Clan Wars rule fixtures", failed)).toBe("");
  });
});
