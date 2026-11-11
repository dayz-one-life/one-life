import { describe, it, expect } from "vitest";
import { readClassified, refOfUid, type Project } from "../../scripts/golden-io.js";
import { buildDeathContext, wholeCorpusContext } from "../../src/index.js";
import { contextDigest, corpusOf, cwFixtures, differences, goldenReady, layout, olFixtures, readGz, report } from "./golden.js";

/**
 * The death record and the death context against the reference's — PRIVATE data.
 *
 * `tools/dump_context.py` in the golden repository runs the reference pipeline and writes, per
 * death, the extract record (shape, killer, stats, position, features) and every member and
 * helper result of its `Case` and `Server`: the life, the hits, the knock-outs, the health
 * bookkeeping, speeds, who was near, what was placed near. This suite builds the same digest from
 * each fixture's selected lines and requires it to be equal.
 *
 * So it checks two things at once: that the port computes what the reference computes, and that
 * the selection kept every line those computations read.
 *
 * Then the same digest is built for EVERY death of both projects from the whole logs and compared
 * with nothing left out. The fixtures are a few hundred deaths; the thresholds of the context
 * (how near, how long ago, how fast) are only pinned by many.
 */
const ready = goldenReady("context-golden.test", layout?.contextExpected, layout?.olFixtures, layout?.cwFixtures,
  layout?.classified, layout?.ol.raw, layout?.cw.raw);

/** The corpse's `is choosing to respawn` can come any time before the next connect; the selection
 *  stops five minutes after the death. No rule reads it. */
function withoutLateRespawn(d: Record<string, unknown>): Record<string, unknown> {
  const r = d.record as { shape: string[]; death_lines: [string, string][] };
  return { ...d, record: { ...r, shape: r.shape.filter((s) => s !== "respawn_dead_form"), death_lines: r.death_lines.filter((l) => l[1] !== "respawn_dead") } };
}

describe.skipIf(!ready)("the death context vs the reference (private data)", () => {
  it("record and context equal the reference for all 280, and for the Clan Wars rule fixtures", () => {
    const want = readGz<Record<string, Record<string, unknown>>>(layout!.contextExpected);
    const failed: { uid: string; why: string }[] = [];
    const fixtures = [...olFixtures(), ...cwFixtures()];
    for (const f of fixtures) {
      const expected = want[f.uid];
      if (!expected) { failed.push({ uid: f.uid, why: "missing from context.expected.json.gz — run tools/dump_context.py" }); continue; }
      const diff = differences(withoutLateRespawn(contextDigest(buildDeathContext(f))), withoutLateRespawn(expected));
      if (diff.length) failed.push({ uid: f.uid, why: [...new Set(diff)].slice(0, 6).join(" ") });
    }
    expect(olFixtures().length).toBe(280);
    expect(cwFixtures().length).toBeGreaterThan(0);
    expect(report("context", failed)).toBe("");
  }, 120_000);

  for (const project of ["OL", "CW"] as Project[]) {
    it(`record and context equal the reference for every ${project} death, from the whole log`, () => {
      const want = readGz<Record<string, Record<string, unknown>>>(layout!.contextExpected);
      const rows = readClassified(layout!.classified, project);
      const failed: { uid: string; why: string }[] = [];
      for (const row of rows) {
        const expected = want[row.uid];
        if (!expected) { failed.push({ uid: row.uid, why: "missing from context.expected.json.gz — run tools/dump_context.py" }); continue; }
        const diff = differences(contextDigest(wholeCorpusContext(corpusOf(project).get(row.serverId)!, refOfUid(row.uid))), expected);
        if (diff.length) failed.push({ uid: row.uid, why: [...new Set(diff)].slice(0, 6).join(" ") });
      }
      expect(rows.length).toBeGreaterThan(0);
      expect(Object.keys(want).filter((uid) => uid.startsWith(`${project}-`)).length).toBe(rows.length);
      expect(report(`whole-log context (${project})`, failed)).toBe("");
    }, 600_000);
  }
});
