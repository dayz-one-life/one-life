import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { keysMatch, signAttestation, verifyAttestation, type UnsignedAttestation } from "./attest.js";
import { corpusHash, goldenLayout, harnessHash, sourceHash } from "./golden-io.js";

/**
 * Writes `golden-attest.json`: the signed public record that the private golden suites passed
 * against exactly this source, this harness and this golden data. `pnpm run golden` calls it
 * after a counted run; see `scripts/attest.ts` for what the file means and `golden-reporter.ts`
 * for what counts as a run.
 *
 * It refuses when there is no run file (the reporter writes one only for a whole passing run, and
 * deletes the old one when a run starts), when the source, the harness or the golden data changed
 * since that run, and when the signing key is not the one this repository trusts.
 *
 * ⚠️ The file holds counts, hashes and a signature only. Never a uid, a name or a position.
 */
const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const fail = (why: string, code = 1): never => { console.error(`write-attest: ${why}`); process.exit(code); };

const gold = process.env.DEATH_GOLDEN_DIR;
if (!gold) fail("DEATH_GOLDEN_DIR is not set", 2);
const layout = goldenLayout(gold!);
if (!existsSync(layout.lastRun)) fail("no counted golden run found — run `pnpm run golden`; the reporter says why a run did not count");
const run = JSON.parse(readFileSync(layout.lastRun, "utf8")) as UnsignedAttestation;
rmSync(layout.lastRun);

if (run.sourceHash !== sourceHash(pkgRoot)) fail("src/ changed after the golden run; run it again");
if (run.harnessHash !== harnessHash(pkgRoot)) fail("the golden harness changed after the golden run; run it again");
if (run.corpusSha !== corpusHash(gold!)) fail("the golden data changed after the golden run; run it again");

if (!existsSync(layout.attestKey)) fail("the signing key is missing from the golden directory (attest-key/ed25519-private.pem)");
const privateKey = readFileSync(layout.attestKey, "utf8");
const publicKey = readFileSync(join(pkgRoot, "golden-attest.pub.pem"), "utf8");
if (!keysMatch(privateKey, publicKey)) fail("the signing key in the golden directory is not the one golden-attest.pub.pem trusts");

const attest = signAttestation({
  sourceHash: run.sourceHash, harnessHash: run.harnessHash, corpusSha: run.corpusSha, classifierVersion: run.classifierVersion,
  suites: run.suites, tests: run.tests, rows: run.rows, passed: run.passed, gaps: run.gaps, totals: run.totals,
}, privateKey);
if (!verifyAttestation(attest, publicKey)) fail("the signature does not verify");
writeFileSync(join(pkgRoot, "golden-attest.json"), JSON.stringify(attest, null, 2) + "\n");
console.log(`golden-attest.json: ${attest.suites} suites, ${attest.tests} tests; ${attest.rows} rows, ${attest.passed} passed, ${attest.gaps} known gaps`);
