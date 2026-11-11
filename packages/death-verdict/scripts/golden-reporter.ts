import { existsSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { corpusHash, goldenLayout, GOLDEN_SUITES, harnessHash, sourceHash } from "./golden-io.js";

/**
 * The reporter of `pnpm run golden`. It alone decides whether a golden run counts, and writes the
 * run file `write-attest.ts` turns into the attestation.
 *
 * A run counts when ALL of this holds:
 * - `DEATH_GOLDEN_REQUIRED` and `DEATH_GOLDEN_DIR` are set (so a missing input fails, not skips);
 * - every suite of `GOLDEN_SUITES` ran, and no other; each has at least one test;
 * - no test failed, none was skipped, no error outside a test;
 * - the source, the harness and the golden data hash the same after the run as before it.
 *
 * The run file is deleted when the run STARTS. So a failed run, a single-suite run or a plain
 * `pnpm test` can never leave one behind for `write-attest.ts` to pick up.
 *
 * ⚠️ PRIVATE DATA is near: this prints counts and suite file names, never a uid, a name or a line.
 */
const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export interface GoldenOutcome {
  classifierVersion: number; rows: number; passed: number; gaps: number;
  totals: { definitive: number; strong: number; inferred: number; killLine: number };
}
// The few fields of vitest's task tree this reads. `goldenOutcome` is set by the parity test.
interface Task { type: string; result?: { state?: string }; meta?: { goldenOutcome?: GoldenOutcome }; tasks?: Task[] }
interface TestFile extends Task { filepath: string }

function tally(task: Task, into: { tests: number; passed: number; outcome: GoldenOutcome | null }): void {
  for (const t of task.tasks ?? []) {
    if (t.type === "suite") { tally(t, into); continue; }
    into.tests += 1;
    if (t.result?.state === "pass") into.passed += 1;
    if (t.meta?.goldenOutcome) into.outcome = t.meta.goldenOutcome;
  }
}

export default class GoldenReporter {
  private before: { source: string; harness: string; corpus: string } | null = null;
  private readonly gold = process.env.DEATH_GOLDEN_DIR ?? null;

  private hashes() {
    return { source: sourceHash(pkgRoot), harness: harnessHash(pkgRoot), corpus: corpusHash(this.gold!) };
  }

  onInit(): void {
    if (!this.gold) return;
    rmSync(goldenLayout(this.gold).lastRun, { force: true });
    if (existsSync(this.gold)) this.before = this.hashes();
  }

  onFinished(files: TestFile[] = [], errors: unknown[] = []): void {
    const refuse = (why: string): void => { console.error(`\n[golden] NOT a counted run: ${why}. No run file was written.`); };
    if (!this.gold || !process.env.DEATH_GOLDEN_REQUIRED) return refuse("DEATH_GOLDEN_DIR and DEATH_GOLDEN_REQUIRED must both be set (use `pnpm run golden`)");
    if (!this.before) return refuse("the golden directory does not exist");
    if (errors.length) return refuse(`${errors.length} error(s) outside a test`);

    const ran = files.map((f) => basename(f.filepath)).sort();
    const missing = GOLDEN_SUITES.filter((s) => !ran.includes(s)), extra = ran.filter((s) => !GOLDEN_SUITES.includes(s));
    if (missing.length) return refuse(`${missing.length} suite(s) did not run (${missing.join(", ")})`);
    if (extra.length || ran.length !== GOLDEN_SUITES.length) return refuse(`suite(s) not in GOLDEN_SUITES ran (${extra.join(", ")})`);

    let tests = 0;
    let outcome: GoldenOutcome | null = null;
    for (const f of files) {
      const t = { tests: 0, passed: 0, outcome: null as GoldenOutcome | null };
      tally(f, t);
      const name = basename(f.filepath);
      if (f.result?.state !== "pass") return refuse(`${name} did not pass`);
      if (t.tests === 0) return refuse(`${name} ran no test`);
      if (t.passed !== t.tests) return refuse(`${name}: ${t.tests - t.passed} of ${t.tests} test(s) failed or were skipped`);
      tests += t.tests;
      if (t.outcome) outcome = t.outcome;
    }
    if (!outcome) return refuse("the parity suite reported no outcome");

    const after = this.hashes();
    if (after.source !== this.before.source) return refuse("src/ changed while the suites ran");
    if (after.harness !== this.before.harness) return refuse("the golden harness changed while the suites ran");
    if (after.corpus !== this.before.corpus) return refuse("the golden data changed while the suites ran");

    const run = { sourceHash: after.source, harnessHash: after.harness, corpusSha: after.corpus, suites: ran.length, tests, ...outcome };
    writeFileSync(goldenLayout(this.gold).lastRun, JSON.stringify(run) + "\n");
    console.log(`\n[golden] counted run: ${ran.length} suites, ${tests} tests, all passed.`);
  }
}
