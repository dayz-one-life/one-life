import { describe, it, expect } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { keysMatch, signAttestation, verifyAttestation, type Attestation } from "../scripts/attest.js";
import { GOLDEN_SUITES, goldenSuiteFiles, harnessHash, sourceHash } from "../scripts/golden-io.js";
import { CLASSIFIER_VERSION } from "../src/index.js";

/**
 * The public half of the golden gate.
 *
 * The golden data is private, so CI cannot run the classifier against it. `pnpm --filter
 * @onelife/death-verdict run golden` does, on a machine that has the data, and writes
 * `golden-attest.json`: the hashes of the source, of the golden harness and of the golden data it
 * ran against, how many suites and tests ran, the outcome — and a signature. This test checks the
 * hashes against the working tree and the signature against `golden-attest.pub.pem`.
 *
 * ⚠️ If it fails, you changed something under `packages/death-verdict/src/`, `scripts/` or
 * `test/golden-private/` and did not rerun the golden suites. The file cannot be fixed by hand:
 * the signing key lives with the golden data. Run
 * `DEATH_GOLDEN_DIR=/path pnpm --filter @onelife/death-verdict run golden` and commit the file it
 * writes. No access to the golden data? Then the change needs someone who has.
 *
 * ⚠️ `golden-attest.pub.pem` says WHO MAY ATTEST. A pull request that changes it is asking to
 * replace the gate, not to pass it: review it as that.
 *
 * What each step lowers or raises here, in the same commit as its golden run:
 */
/** The most deaths that may still be known gaps. Step 3: 280, `classifyDeath` was a stub. Step 4:
 *  31, the deaths only an inferred rule answers.
 *  ⚠️ Only ever lowered. A regression cannot be hidden by listing a death as a gap again. */
const GAPS_CEILING = 31;
/** The private suites and tests a golden run must have run. */
const SUITES = 11, TESTS = 28;

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const attest = JSON.parse(readFileSync(join(pkgRoot, "golden-attest.json"), "utf8")) as Attestation;
const publicKey = readFileSync(join(pkgRoot, "golden-attest.pub.pem"), "utf8");
const HEX64 = /^[0-9a-f]{64}$/;
const count = (v: unknown): boolean => typeof v === "number" && Number.isInteger(v) && v >= 0;

describe("golden-attest.json", () => {
  it("golden-attest.json sourceHash matches the current source", () => {
    expect(attest.sourceHash).toBe(sourceHash(pkgRoot));
  });

  it("the golden harness is the one the attestation was earned with", () => {
    expect(attest.harnessHash).toBe(harnessHash(pkgRoot));
  });

  it("is signed by the key that lives with the golden data", () => {
    expect(verifyAttestation(attest, publicKey)).toBe(true);
  });

  it("every private suite ran: none deleted, none added without a fresh run", () => {
    expect(goldenSuiteFiles(pkgRoot)).toEqual([...GOLDEN_SUITES].sort());
    expect(GOLDEN_SUITES).toHaveLength(SUITES);
    expect(attest.suites).toBe(SUITES);
    expect(attest.tests).toBe(TESTS);
  });

  it("accounts for every golden death: passed plus known gaps, for this classifier version", () => {
    expect(attest.rows).toBe(280);
    expect(attest.passed + attest.gaps).toBe(attest.rows);
    expect(attest.classifierVersion).toBe(CLASSIFIER_VERSION);
    const t = attest.totals;
    for (const v of [attest.rows, attest.passed, attest.gaps, attest.classifierVersion, attest.suites, attest.tests, t.definitive, t.strong, t.inferred, t.killLine]) {
      expect(count(v)).toBe(true);
    }
    // every passing death has a certainty or is honestly unknown; a kill line is one of the passing
    expect(t.definitive + t.strong + t.inferred).toBeLessThanOrEqual(attest.passed);
    expect(t.killLine).toBeLessThanOrEqual(attest.passed);
  });

  it("the known gaps never grow", () => {
    expect(attest.gaps).toBeLessThanOrEqual(GAPS_CEILING);
  });

  it("holds counts, hashes and a signature only", () => {
    expect(Object.keys(attest).sort()).toEqual([
      "classifierVersion", "corpusSha", "gaps", "harnessHash", "passed", "rows", "signature", "sourceHash", "suites", "tests", "totals",
    ]);
    expect(Object.keys(attest.totals).sort()).toEqual(["definitive", "inferred", "killLine", "strong"]);
    for (const h of [attest.sourceHash, attest.harnessHash, attest.corpusSha]) expect(h).toMatch(HEX64);
    expect(attest.signature).toMatch(/^[A-Za-z0-9+/]{86}==$/);       // 64 bytes, base64: nothing else fits in it
  });
});

describe("the signature", () => {
  // A throwaway key pair: the real private key is not in this repository.
  const pair = generateKeyPairSync("ed25519");
  const pub = pair.publicKey.export({ type: "spki", format: "pem" }) as string;
  const priv = pair.privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  const { signature: _, ...fields } = attest;
  const signed = signAttestation(fields, priv);

  it("verifies what was signed, with the right key only", () => {
    expect(verifyAttestation(signed, pub)).toBe(true);
    expect(verifyAttestation(signed, publicKey)).toBe(false);
    expect(keysMatch(priv, pub)).toBe(true);
    expect(keysMatch(priv, publicKey)).toBe(false);
  });

  it("a recomputed hash or a typed-in count breaks it: every field is signed", () => {
    const forged: Partial<Attestation>[] = [
      { ...signed, sourceHash: "0".repeat(64) }, { ...signed, harnessHash: "0".repeat(64) }, { ...signed, corpusSha: "0".repeat(64) },
      { ...signed, classifierVersion: signed.classifierVersion + 1 }, { ...signed, suites: 1 }, { ...signed, tests: 1 },
      { ...signed, rows: 0 }, { ...signed, passed: 280, gaps: 0 }, { ...signed, gaps: 0 },
      // one more than the run really had: a fixed figure here would stop being a forgery the day a run reaches it
      { ...signed, totals: { ...signed.totals, definitive: signed.totals.definitive + 1 } }, { ...signed, totals: { ...signed.totals, strong: signed.totals.strong + 1 } },
      { ...signed, totals: { ...signed.totals, inferred: signed.totals.inferred + 1 } }, { ...signed, totals: { ...signed.totals, killLine: signed.totals.killLine + 1 } },
      { ...signed, signature: "" }, { ...signed, signature: "AAAA" }, { ...fields },
    ];
    for (const f of forged) expect(verifyAttestation(f, pub)).toBe(false);
    // the same goes for the committed file against the committed key
    expect(verifyAttestation({ ...attest, passed: 280, gaps: 0 }, publicKey)).toBe(false);
  });
});
