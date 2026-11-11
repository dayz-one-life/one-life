import { defineConfig } from "vitest/config";
import GoldenReporter from "./scripts/golden-reporter.js";

/**
 * The config of `pnpm run golden` only: the private suites, and the reporter that decides whether
 * the run counts (scripts/golden-reporter.ts). The ordinary `vitest run` does not load this file.
 * ⚠️ This file is part of the golden harness hash: changing it needs a fresh golden run.
 */
export default defineConfig({
  test: {
    include: ["test/golden-private/**/*.test.ts"],
    reporters: ["default", new GoldenReporter()],
  },
});
