import { getDb } from "@onelife/db";
import { assertTestDatabase, testDatabaseUrl } from "./guard.js";

export { assertTestDatabase, testDatabaseUrl, DEFAULT_TEST_DATABASE_URL } from "./guard.js";
// Re-exported for convenience for any consumer running inside vite-node (e.g. test files).
// vitest.config.ts files must NOT import this via the barrel — see setup-path.ts's doc comment
// for why; they should import from the "@onelife/test-support/setup-path" subpath instead.
export { GLOBAL_SETUP_PATH } from "./setup-path.js";

/** Guarded test DB connection. Throws unless the target DB name ends in _test. */
export function getTestDb(): ReturnType<typeof getDb> {
  const url = testDatabaseUrl();
  assertTestDatabase(url);
  return getDb(url);
}
