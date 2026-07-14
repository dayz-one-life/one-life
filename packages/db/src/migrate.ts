import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";

/** Run drizzle migrations (from this package's ./drizzle folder) against `url`, then close. */
export async function migrateDb(url: string): Promise<void> {
  const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
  const sql = postgres(url, { max: 1 });
  try {
    await migrate(drizzle(sql), { migrationsFolder });
  } finally {
    await sql.end();
  }
}
