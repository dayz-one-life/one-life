import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { readClassified, refOfUid, type Fixture, type Project } from "../../scripts/golden-io.js";
import { selectContextLines } from "../../src/index.js";
import { corpusOf, cwFixtures, goldenReady, layout, olFixtures, report } from "./golden.js";

/**
 * The fixtures ARE the reference's answers — PRIVATE data.
 *
 * Every other suite reads its answers from the fixtures (`expected`), not from the reference's
 * answer file. So a stale or edited fixture directory would silently become the answer key. This
 * suite ties the two together:
 *
 * 1. there is exactly one fixture per One Life death the reference classified, and no other;
 * 2. each fixture's `expected` is the reference's row for that death, field for field;
 * 3. the Clan Wars rule fixtures are exactly the deaths `cw-rules.uids.txt` lists, with the
 *    reference's answers;
 * 4. each fixture's stored selection is what `selectContextLines` gives today.
 */
const ready = goldenReady("fixtures-golden.test", layout?.classified, layout?.olFixtures, layout?.cwFixtures, layout?.cwUids, layout?.ol.raw, layout?.cw.raw);

function againstReference(project: Project, fixtures: Fixture[], wantUids: string[]): { uid: string; why: string }[] {
  const rows = new Map(readClassified(layout!.classified, project).map((r) => [r.uid, r]));
  const failed: { uid: string; why: string }[] = [];
  const have = new Set(fixtures.map((f) => f.uid));
  for (const uid of wantUids) if (!have.has(uid)) failed.push({ uid, why: "missing no fixture for a death that must have one" });
  const want = new Set(wantUids);
  for (const f of fixtures) {
    const row = rows.get(f.uid);
    if (!want.has(f.uid)) failed.push({ uid: f.uid, why: "extra a fixture for a death that is not listed" });
    else if (!row) failed.push({ uid: f.uid, why: "unknown the reference has no such death" });
    else if (f.project !== project || f.serverId !== row.serverId) failed.push({ uid: f.uid, why: "server or project differs" });
    else if (JSON.stringify(f.expected) !== JSON.stringify(row.expected)) failed.push({ uid: f.uid, why: "expected differs from the reference's answer" });
  }
  if (have.size !== fixtures.length) failed.push({ uid: "-", why: "duplicate two fixtures for one death" });
  return failed;
}

function staleSelections(project: Project, fixtures: Fixture[]): { uid: string; why: string }[] {
  const failed: { uid: string; why: string }[] = [];
  for (const f of fixtures) {
    const now = selectContextLines(corpusOf(project).get(f.serverId)!, refOfUid(f.uid));
    const { uid: _u, project: _p, seedRefs: _s, expected: _e, ...stored } = f;
    if (JSON.stringify(stored) !== JSON.stringify(now)) failed.push({ uid: f.uid, why: "stale the stored selection is not today's — rebuild the fixtures" });
  }
  return failed;
}

describe.skipIf(!ready)("the fixtures are the reference's answers (private data)", () => {
  it("one fixture per One Life death of the reference, each with the reference's answer", () => {
    const uids = readClassified(layout!.classified, "OL").map((r) => r.uid);
    expect(uids.length).toBe(280);
    expect(report("One Life fixtures", againstReference("OL", olFixtures(), uids))).toBe("");
  });

  it("the Clan Wars rule fixtures are exactly the listed deaths, each with the reference's answer", () => {
    const uids = readFileSync(layout!.cwUids, "utf8").split(/\s+/).filter(Boolean);
    expect(uids.length).toBeGreaterThan(0);
    expect(new Set(uids).size).toBe(uids.length);
    expect(report("Clan Wars fixtures", againstReference("CW", cwFixtures(), uids))).toBe("");
  });

  it("every stored selection is what the selection gives today", () => {
    expect(report("stored selections", [...staleSelections("OL", olFixtures()), ...staleSelections("CW", cwFixtures())])).toBe("");
  }, 300_000);
});
