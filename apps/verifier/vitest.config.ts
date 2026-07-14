import { defineConfig } from "vitest/config";
import { GLOBAL_SETUP_PATH } from "@onelife/test-support/setup-path";

// fileParallelism: false — DB-backed test files within a package share one Postgres
// database (onelife_test) and can deadlock (FK row-lock ordering) when Vitest's default
// per-file worker parallelism runs them concurrently. Running them sequentially within
// the package is safe and matches the root `turbo run test --concurrency=1` intent.
export default defineConfig({
  test: { globalSetup: [GLOBAL_SETUP_PATH], fileParallelism: false },
});
