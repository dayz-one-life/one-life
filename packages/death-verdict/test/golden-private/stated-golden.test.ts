import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { readClassified, refOfUid, type Expected, type Project } from "../../scripts/golden-io.js";
import { buildDeathContext, classifyDeath, SPAWN_BASELINES, spawnAt, wholeCorpusContext } from "../../src/index.js";
import { corpusOf, cwFixtures, failedChecks, goldenReady, isStatedRule, layout, report, selectOptionsOf, withSpawn } from "./golden.js";

/**
 * Every rule against the reference, for EVERY death of both projects — PRIVATE data.
 *
 * The parity gate reads the 280 One Life deaths. Most rules fire on a handful of them, and some
 * on none; Clan Wars has thousands of deaths and nearly every rule. So here every death of both
 * exports is classified from the whole log and must pass the same ten checks, whichever rule the
 * reference decided it by: a kill line, a stated mechanism on a bare death line, or inference.
 * (The file keeps its name from plan step 4, when it covered the stated rules only.)
 *
 * Clan Wars server ids collide with One Life's: a Clan Wars death is classified with its own
 * project's spawn levels (`spawnTableOf`). Its map is not known per date, so no Clan Wars death is
 * on a cold or a sand map — as in the reference, which keys both by One Life server.
 *
 * ⚠️ One deliberate difference. The reference has a last pass over a player's NEXT death: grenade
 * deaths seconds after respawning that follow each other are raised from inferred to strong and
 * flagged `spawn_reset_chain`. The port does not look at the future, so for those deaths the
 * answer is compared with that pass undone. No One Life death has the shape.
 */
const ready = goldenReady("stated-golden.test", layout?.classified, layout?.ol.raw, layout?.cw.raw, layout?.cwFixtures, layout?.spawnBaselines);

/** The reference's answer without its look at the next death. */
function withoutChain(e: Expected): Expected {
  if (!e.flags.includes("spawn_reset_chain")) return e;
  return { ...e, flags: e.flags.filter((f) => f !== "spawn_reset_chain"), attributedTo: e.attributedTo ? { ...e.attributedTo, confidence: "inferred" } : null };
}

describe.skipIf(!ready)("every rule vs the reference, every death (private data)", () => {
  for (const project of ["OL", "CW"] as Project[]) {
    it(`every ${project} death passes the ten checks`, () => {
      const rows = readClassified(layout!.classified, project);
      const failed: { uid: string; why: string }[] = [];
      let inferred = 0, chains = 0;
      for (const row of rows) {
        const v = classifyDeath(wholeCorpusContext(corpusOf(project).get(row.serverId)!, refOfUid(row.uid), [], selectOptionsOf(project, row.serverId)));
        if (!/^(A|B0[1-8])/.test(row.expected.rule)) inferred += 1;
        if (row.expected.flags.includes("spawn_reset_chain")) chains += 1;
        const bad = failedChecks(v, withoutChain(row.expected), row.uid);
        if (bad.length) failed.push({ uid: row.uid, why: `check${bad.join(",")} fails (${row.expected.rule}, answered ${v.rule})` });
      }
      expect(inferred).toBeGreaterThan(0);
      if (project === "OL") expect(chains).toBe(0);
      expect(report(`every rule (${project})`, failed)).toBe("");
    }, 900_000);
  }

  it("the Clan Wars rule fixtures pass, for every rule One Life has not hit", () => {
    const failed: { uid: string; why: string }[] = [];
    const rules = new Set<string>();
    for (const f of cwFixtures()) {
      const v = classifyDeath(buildDeathContext(withSpawn(f)));
      rules.add(f.expected.rule);
      const bad = failedChecks(v, withoutChain(f.expected), f.uid);
      if (bad.length) failed.push({ uid: f.uid, why: `check${bad.join(",")} fails (${f.expected.rule})` });
    }
    // The rules One Life has not hit, as far as either project ever fired them (no death fired A06b or A08x).
    expect([...rules].sort()).toEqual(["A01", "A03", "A05", "A10", "A14", "B07", "B08c", "B09h", "B14", "B16h", "B19", "B21"]);
    expect(report("Clan Wars rule fixtures", failed)).toBe("");
  });

  it("the checked-in spawn levels are the reference's export, dated to the day, for every One Life server", () => {
    const d = JSON.parse(readFileSync(layout!.spawnBaselines, "utf8")) as {
      default: { water: number; energy: number };
      servers: { OL: Record<string, { default: { water: number; energy: number }; baselines: { from: string; from_ts: number; water: number; energy: number }[] }> };
    };
    expect(d.default).toEqual({ water: 600, energy: 600 });
    const listed = new Set<number>();
    for (const [id, s] of Object.entries(d.servers.OL)) {
      // every server's default is the global one, so a server without entries needs no line
      expect(s.default).toEqual(d.default);
      if (!s.baselines.length) continue;
      listed.add(Number(id));
      const mine = SPAWN_BASELINES[Number(id)] ?? [];
      expect(mine.map(({ water, energy }) => [water, energy]), `server ${id}`).toEqual(s.baselines.map(({ water, energy }) => [water, energy]));
      s.baselines.forEach((x, i) => {
        expect(Date.parse(x.from) / 1000).toBe(x.from_ts);
        const at = Date.parse(mine[i]!.from) / 1000;
        // the public instant is the start of the UTC day of the reference's, and still after the step before it
        expect(at % 86400, `server ${id} step ${i}`).toBe(0);
        expect(x.from_ts - at, `server ${id} step ${i}`).toBeGreaterThanOrEqual(0);
        expect(x.from_ts - at, `server ${id} step ${i}`).toBeLessThan(86400);
        if (i > 0) expect(at, `server ${id} step ${i}`).toBeGreaterThan(s.baselines[i - 1]!.from_ts);
      });
    }
    expect(Object.keys(SPAWN_BASELINES).map(Number).sort()).toEqual([...listed].sort());
    // A death the rounding moves onto other levels must be decided by a stated rule, which never
    // reads them; every verdict is compared with the reference by the suites above.
    const ref = (id: number) => d.servers.OL[String(id)]?.baselines.map(({ from, water, energy }) => ({ from, water, energy })) ?? [];
    const moved: string[] = [];
    for (const row of readClassified(layout!.classified, "OL")) {
      const ts = Date.parse(row.expected.utc) / 1000;
      const a = spawnAt(row.serverId, ts), b = spawnAt(row.serverId, ts, ref(row.serverId));
      if ((a.water !== b.water || a.energy !== b.energy) && !isStatedRule(row.expected.rule)) moved.push(row.uid);
    }
    expect(moved).toEqual([]);
  });

  it("EXCEPTIONS.md exists and lists no exception", () => {
    const text = readFileSync(layout!.exceptions, "utf8");
    const entries = text.split("<!-- entries below this line -->")[1] ?? "";
    expect(entries.trim()).toBe("");
  });
});
