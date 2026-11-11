import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sourceHash } from "../scripts/golden-io.js";

/**
 * The public half of the golden gate.
 *
 * The golden data is private, so CI cannot run the classifier against it. `pnpm --filter
 * @onelife/death-verdict run golden` does, on a machine that has the data, and writes
 * `golden-attest.json` with the hash of the source it ran against. This test recomputes that hash.
 *
 * ⚠️ If it fails, you changed something under `packages/death-verdict/src/` and did not rerun the
 * golden suites. Do not edit the hash by hand: run
 * `DEATH_GOLDEN_DIR=/path pnpm --filter @onelife/death-verdict run golden` and commit the file it
 * writes. No access to the golden data? Then the change needs someone who has.
 */
const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const attest = JSON.parse(readFileSync(join(pkgRoot, "golden-attest.json"), "utf8")) as Record<string, unknown>;

describe("golden-attest.json", () => {
  it("golden-attest.json sourceHash matches the current source", () => {
    expect(attest.sourceHash).toBe(sourceHash(pkgRoot));
  });
  it("accounts for every golden death: passed plus known gaps", () => {
    expect((attest.passed as number) + (attest.gaps as number)).toBe(attest.rows);
  });
  it("holds counts and hashes only", () => {
    expect(Object.keys(attest).sort()).toEqual(["classifierVersion", "corpusSha", "gaps", "passed", "rows", "sourceHash", "totals"]);
    expect(JSON.stringify(attest)).not.toMatch(/OL-|CW-|[0-9A-F]{40}|pos=/);
  });
});
