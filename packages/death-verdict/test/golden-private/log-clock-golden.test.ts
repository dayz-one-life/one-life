import { describe, it, expect } from "vitest";
import { readClassified, refOfUid, type Project } from "../../scripts/golden-io.js";
import { indexOf, isoSeconds, linesOfInput, stampCorpus } from "../../src/index.js";
import { corpusOf, goldenReady, layout, olFixtures, report } from "./golden.js";

/**
 * The log clock against the reference's — PRIVATE data.
 *
 * Every death the reference classified (both projects) is stamped from its whole file and the
 * UTC second of its primary line is compared with the reference's `utc`. Then the times stored
 * in the One Life fixtures are checked the same way, since the classifier reads those.
 */
const ready = goldenReady("log-clock-golden.test", layout?.classified, layout?.ol.raw, layout?.cw.raw, layout?.olFixtures);

describe.skipIf(!ready)("the log clock vs the reference (private data)", () => {
  for (const project of ["OL", "CW"] as Project[]) {
    it(`deathAt equals golden utc for every ${project} death`, () => {
      const rows = readClassified(layout!.classified, project);
      const failed: { uid: string; why: string }[] = [];
      for (const row of rows) {
        const line = indexOf(stampCorpus(corpusOf(project).get(row.serverId)!)).line(refOfUid(row.uid));
        if (!line) failed.push({ uid: row.uid, why: "missing the primary line is not in the export" });
        else if (isoSeconds(line.ts) !== row.expected.utc) failed.push({ uid: row.uid, why: `utc off by ${line.ts - Date.parse(row.expected.utc) / 1000} s` });
      }
      expect(rows.length).toBeGreaterThan(0);
      expect(report("log clock", failed)).toBe("");
    }, 120_000);
  }

  it("deathAt equals golden utc for all 280, read from the fixtures", () => {
    const failed: { uid: string; why: string }[] = [];
    for (const f of olFixtures()) {
      const line = indexOf(linesOfInput(f)).line(f.deathRef);
      if (!line || isoSeconds(line.ts) !== f.expected.utc) failed.push({ uid: f.uid, why: "utc differs" });
    }
    expect(olFixtures().length).toBe(280);
    expect(report("fixture clock", failed)).toBe("");
  });
});
