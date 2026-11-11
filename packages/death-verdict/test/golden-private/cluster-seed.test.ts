import { describe, it, expect } from "vitest";
import { indexOf, linesOfInput, refKey, resolveCluster, selectContextLines } from "../../src/index.js";
import { corpusOf, goldenReady, layout, olFixtures, report } from "./golden.js";

/**
 * Seed independence — PRIVATE data.
 *
 * The event parser accepts several lines of one death as "a death" (`committed suicide` and the
 * `died.` after it, for one). Whichever of them a life was folded from, the classifier must land
 * on the same death. For every fixture, every seed line gives the same primary and the same
 * roles — from the fixture's lines, and again through the selection itself.
 */
const ready = goldenReady("cluster-seed.test", layout?.ol.raw, layout?.olFixtures);

describe.skipIf(!ready)("any line of a death is a valid seed (private data)", () => {
  it("every seedRef returns the same primary", () => {
    const failed: { uid: string; why: string }[] = [];
    let seeds = 0, multi = 0;
    for (const f of olFixtures()) {
      const lines = linesOfInput(f);
      const own = indexOf(lines).ownLines(indexOf(lines).line(f.deathRef)!.subject!.id);
      const want = JSON.stringify(f.cluster);
      if (f.seedRefs.length === 0) failed.push({ uid: f.uid, why: "seedless no line of the cluster is a death to the event parser" });
      if (f.seedRefs.length > 1) multi += 1;
      for (const seed of f.seedRefs) {
        seeds += 1;
        if (JSON.stringify(resolveCluster(own, seed)) !== want) failed.push({ uid: f.uid, why: "cluster differs by seed" });
        const again = selectContextLines(corpusOf("OL").get(f.serverId)!, seed);
        if (refKey(again.deathRef) !== refKey(f.deathRef) || JSON.stringify(again.files) !== JSON.stringify(f.files)) {
          failed.push({ uid: f.uid, why: "selection differs by seed" });
        }
      }
    }
    expect(seeds).toBeGreaterThan(280);
    expect(multi).toBeGreaterThan(0);
    expect(report("seeds", failed)).toBe("");
  }, 120_000);
});
