import postgres from "postgres";
import { migrateDb } from "@onelife/db";
import { assertTestDatabase, testDatabaseUrl } from "./guard.js";

const APP_TABLES = [
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
  "rpt_files",
  "character_sightings",
  "characters",
  "articles",
  "article_images",
  "notifications",
  "push_subscriptions",
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
