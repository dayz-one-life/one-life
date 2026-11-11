import { describe, it, expect } from "vitest";
import { buildDeathContext, classifyDeath, wholeCorpusContext } from "../../src/index.js";
import { contextDigest, corpusOf, cwFixtures, differences, goldenReady, layout, olFixtures, report } from "./golden.js";

/**
 * Sufficiency of the selection — PRIVATE data.
 *
 * Every golden death is read twice: from the lines `selectContextLines` kept for it (the
 * fixture), and from the whole server log with nothing left out. The verdicts must be deep-equal,
 * evidence and contributors included. A difference means a rule read a line the selection drops.
 *
 * Until the rules are ported the verdict says little, so the whole context digest is compared
 * too. Only two things are allowed to differ, and no rule reads either: the corpse's late
 * `is choosing to respawn` line, and the line directly above the death when that is what the
 * digest probes (it is always inside the server window).
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
      if (verdicts.length) failed.push({ uid: f.uid, why: `verdict.${verdicts[0]}` });
      else if (contexts.length) failed.push({ uid: f.uid, why: [...new Set(contexts)].slice(0, 6).join(" ") });
    }
    expect(olFixtures().length).toBe(280);
    expect(report("sufficiency", failed)).toBe("");
  }, 300_000);
});
