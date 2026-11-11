import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { goldenLayout, sourceHash } from "./golden-io.js";

/**
 * Writes `golden-attest.json`: the public record that the private golden suites were run against
 * exactly this source. `pnpm run golden` calls it after every golden suite has passed.
 *
 * The golden data cannot enter this repository, so public CI cannot run the gate. Instead a
 * public test (`test/attest.test.ts`) recomputes the hash of `src/` and fails when it differs
 * from this file: a change to the classifier cannot merge without a fresh golden run.
 *
 * ⚠️ The file holds counts and hashes only. Never a uid, a name or a position.
 */
const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const gold = process.env.DEATH_GOLDEN_DIR;
if (!gold) { console.error("write-attest: DEATH_GOLDEN_DIR is not set"); process.exit(2); }
const runFile = goldenLayout(gold).lastRun;
if (!existsSync(runFile)) { console.error("write-attest: no golden run found — the parity suite writes it when it passes"); process.exit(1); }
const run = JSON.parse(readFileSync(runFile, "utf8")) as {
  sourceHash: string; corpusSha: string; classifierVersion: number; rows: number; passed: number; gaps: number;
  totals: { definitive: number; strong: number; inferred: number; killLine: number };
};
rmSync(runFile);
const now = sourceHash(pkgRoot);
if (run.sourceHash !== now) { console.error("write-attest: the source changed after the golden run; run it again"); process.exit(1); }
const attest = {
  sourceHash: now, corpusSha: run.corpusSha, classifierVersion: run.classifierVersion,
  rows: run.rows, passed: run.passed, gaps: run.gaps, totals: run.totals,
};
writeFileSync(join(pkgRoot, "golden-attest.json"), JSON.stringify(attest, null, 2) + "\n");
console.log(`golden-attest.json: ${attest.rows} rows, ${attest.passed} passed, ${attest.gaps} known gaps`);
