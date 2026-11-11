import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { goldenPaths } from "./from-classified.js";
import { ATTRIBUTION_ROLES, CONTRIBUTOR_ROLES, INTERNAL_CAUSES, UPSTREAM_TO_PUBLIC } from "../../src/index.js";

/**
 * `src/tokens.ts` against the token list read out of the reference classifier (private:
 * `$DEATH_GOLDEN_DIR/tokens.json`). Fails when the reference can return a cause or a role the
 * unions lack, or the unions hold one it cannot. Skipped when the golden data is not there.
 */
const GOLD = process.env.DEATH_GOLDEN_DIR;
const file = GOLD ? goldenPaths(GOLD).tokens : null;
const ready = file != null && existsSync(file);
if (!ready) console.warn("[tokens-golden.test] SKIPPED — DEATH_GOLDEN_DIR is unset or holds no tokens.json.");

// `pnpm run golden` sets this: there, a missing input is a failure, not a skip.
if (!ready && process.env.DEATH_GOLDEN_REQUIRED) {
  throw new Error("[tokens-golden.test] DEATH_GOLDEN_REQUIRED is set but the private golden data is not available.");
}

describe.skipIf(!ready)("tokens.ts vs the reference classifier (private data)", () => {
  const t = ready ? JSON.parse(readFileSync(file!, "utf8")) as {
    union: Record<"cause" | "role" | "attribution_role_in_data" | "contributor_role_in_data" | "upstream_cause_in_data", string[]>;
    in_data_not_in_code: { cause: string[]; role: string[] };
  } : null;
  const sorted = (xs: readonly string[]) => [...xs].sort();

  it("the reference's own lists are complete", () => {
    expect(t!.in_data_not_in_code).toEqual({ cause: [], role: [] });
  });
  it("every cause the reference can return is in INTERNAL_CAUSES, and nothing else is", () => {
    expect(sorted(INTERNAL_CAUSES)).toEqual(sorted(t!.union.cause));
  });
  it("every role is in exactly one of the two role lists", () => {
    expect(sorted(ATTRIBUTION_ROLES)).toEqual(sorted(t!.union.attribution_role_in_data));
    expect(sorted(CONTRIBUTOR_ROLES)).toEqual(sorted(t!.union.contributor_role_in_data));
    expect(sorted([...ATTRIBUTION_ROLES, ...CONTRIBUTOR_ROLES])).toEqual(sorted(t!.union.role));
  });
  it("every upstream word in the data is either published or withheld on purpose", () => {
    for (const word of t!.union.upstream_cause_in_data) expect(Object.hasOwn(UPSTREAM_TO_PUBLIC, word), word).toBe(true);
  });
});
