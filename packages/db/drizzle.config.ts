import { defineConfig } from "drizzle-kit";

// drizzle-kit reads DATABASE_URL and nothing else — notably NOT TEST_DATABASE_URL, which is
// what every test suite in this repo uses. This previously carried a
// `?? "postgres://onelife:onelife@localhost:5432/onelife"` fallback, which meant a
// `pnpm db:migrate` run with only TEST_DATABASE_URL exported silently targeted a *different*
// database (and, on this dev machine, a port nothing is listening on) while reporting success.
// Migrations that appear to apply but do not are the worst possible failure here, so an unset
// URL is now a loud error.
//
// To migrate the test database, name it explicitly:
//   DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @onelife/db run db:migrate
const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "DATABASE_URL is not set. drizzle-kit does not read TEST_DATABASE_URL — pass the target " +
      'database explicitly, e.g. DATABASE_URL="$TEST_DATABASE_URL" pnpm db:migrate',
  );
}

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
});
