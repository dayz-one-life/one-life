import { describe, it, expect } from "vitest";
import { readClassified, refOfUid, type Project } from "../../scripts/golden-io.js";
import { allClusters, indexOf, linesOfInput, refKey, resolveCluster, stampCorpus } from "../../src/index.js";
import { corpusOf, cwFixtures, goldenReady, layout, olFixtures, report } from "./golden.js";

/**
 * The death cluster against the reference's grouping — PRIVATE data.
 *
 * 1. From each fixture's selected lines, the roles of the cluster equal the reference's
 *    `death_lines`, line for line and in order, and the primary is the line the uid names.
 * 2. Over each whole corpus, the deaths the port finds are exactly the deaths the reference
 *    classified: none missing, none extra, the same roles. This is what says the grouping can be
 *    trusted on lines no fixture holds.
 */
const ready = goldenReady("cluster-golden.test", layout?.classified, layout?.ol.raw, layout?.cw.raw, layout?.olFixtures);
const rolesOf = (lines: { ref: { admFileId: number; lineIndex: number }; role: string }[]) => lines.map((l) => `${refKey(l.ref)}=${l.role}`).join(" ");

describe.skipIf(!ready)("the death cluster vs the reference (private data)", () => {
  it("role sequence equals golden death_lines for all 280", () => {
    const failed: { uid: string; why: string }[] = [];
    for (const f of [...olFixtures(), ...cwFixtures()]) {
      const lines = linesOfInput(f);
      const victim = indexOf(lines).line(f.deathRef)!.subject!.id;
      const c = resolveCluster(indexOf(lines).ownLines(victim), f.deathRef);
      if (refKey(c.primary) !== refKey(refOfUid(f.uid))) failed.push({ uid: f.uid, why: "primary is not the line the uid names" });
      else if (rolesOf(c.lines) !== rolesOf(f.expected.deathLines)) failed.push({ uid: f.uid, why: "roles differ" });
      else if (rolesOf(f.cluster.lines) !== rolesOf(c.lines)) failed.push({ uid: f.uid, why: "stored the cluster in the fixture is stale" });
    }
    expect(olFixtures().length).toBe(280);
    expect(report("cluster roles", failed)).toBe("");
  });

  for (const project of ["OL", "CW"] as Project[]) {
    it(`the deaths found in the whole ${project} corpus are exactly the reference's`, () => {
      const want = new Map(readClassified(layout!.classified, project).map((r) => [r.uid, rolesOf(r.expected.deathLines)]));
      const got = new Map<string, string>();
      for (const [serverId, corpus] of corpusOf(project)) {
        const S = indexOf(stampCorpus(corpus));
        for (const id of S.own.keys()) {
          for (const c of allClusters(S.ownLines(id))) got.set(`${project}-${serverId}-${c.primary.admFileId}-${c.primary.lineIndex}`, rolesOf(c.lines));
        }
      }
      const failed: { uid: string; why: string }[] = [];
      for (const [uid, roles] of want) {
        if (!got.has(uid)) failed.push({ uid, why: "missing from the port" });
        else if (got.get(uid) !== roles) failed.push({ uid, why: "roles differ" });
      }
      for (const uid of got.keys()) if (!want.has(uid)) failed.push({ uid, why: "extra in the port" });
      expect(want.size).toBeGreaterThan(0);
      expect(report("corpus grouping", failed)).toBe("");
    }, 120_000);
  }
});
