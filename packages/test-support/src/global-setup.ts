import postgres from "postgres";
import { migrateDb } from "@onelife/db";
import { assertTestDatabase, testDatabaseUrl } from "./guard.js";

/**
 * Truncated before every package's test run. A table belongs here unless some OTHER listed
 * table's `on delete cascade` already reaches it.
 *
 * ⚠️ A table with NO foreign key at all can only be cleaned by appearing here — see the
 * `blocked_avatar_hashes` entry and the test that guards this list.
 */
export const APP_TABLES = [
  "servers",
  "adm_files",
  "raw_lines",
  "events",
  "consumer_cursors",
  "players",
  "lives",
  "sessions",
  "kills",
  "hit_events",
  "build_events",
  "positions",
  "gamertag_links",
  "verification_challenges",
  "user",
  "account",
  "session",
  "verification",
  "bans",
  "token_transactions",
  "referrals",
  "notifications",
  "push_subscriptions",
  "articles",
  "avatars",
  // ⚠️ Listed explicitly BECAUSE it has no foreign key (a ban must survive the uploader
  // deleting their account), so nothing else's cascade reaches it. Without this line an
  // interrupted run leaves a ban row behind that silently 404s an unrelated avatar test.
  "blocked_avatar_hashes",
  // Same class of hole, found by the same test: the syndication ledger deliberately joins
  // `articles` by slug with NO FK, so nothing cascades into it either.
  "syndications",
];

/** Vitest globalSetup: provision + migrate + truncate the guarded onelife_test database. */
export default async function globalSetup(): Promise<void> {
  const url = testDatabaseUrl();
  assertTestDatabase(url);

  try {
    const parsed = new URL(url);
    const dbName = parsed.pathname.replace(/^\//, "");

    // Ensure the test database exists (connect to the maintenance `postgres` db).
    const maintenanceUrl = new URL(url);
    maintenanceUrl.pathname = "/postgres";
    const maintenanceSql = postgres(maintenanceUrl.toString(), { max: 1 });
    try {
      const rows = await maintenanceSql`select 1 from pg_database where datname = ${dbName}`;
      if (rows.length === 0) {
        await maintenanceSql.unsafe(`create database "${dbName}"`);
      }
    } finally {
      await maintenanceSql.end();
    }

    // Migrate the (now guaranteed to exist) test database to the latest schema.
    await migrateDb(url);

    // Truncate every app table for a clean slate before this package's test run.
    assertTestDatabase(url);
    const sql = postgres(url, { max: 1 });
    try {
      const tableList = APP_TABLES.map((t) => `"${t}"`).join(", ");
      await sql.unsafe(`truncate table ${tableList} restart identity cascade`);
    } finally {
      await sql.end();
    }
  } catch (err) {
    console.error("[@onelife/test-support] globalSetup failed:", err);
    throw err;
  }
}
