import { defineConfig } from "vitest/config";
import { GLOBAL_SETUP_PATH } from "@onelife/test-support/setup-path";

export default defineConfig({
  test: { globalSetup: [GLOBAL_SETUP_PATH], fileParallelism: false },
});
