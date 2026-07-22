import { getDb, type Database } from "@onelife/db";
import { setCursor } from "@onelife/event-log";
import { sql } from "drizzle-orm";
import pino from "pino";
import { loadConfig } from "./config.js";

// ⚠️ NEVER name a table here that is CREATED by a migration shipping in the same release.
// deploy.sh runs the rebuild phase BEFORE the migrate phase, so on the deploy that introduces
// a projection table that table does not exist yet when this TRUNCATE runs — and naming a
// missing relation aborts the whole statement (`relation "…" does not exist`), which is the
// bug that took the v0.42.1 deploy down. A projection table with an FK to one listed here is
// cleared anyway by `RESTART IDENTITY CASCADE` (e.g. player_gamertags → players ON DELETE
// CASCADE), so it needs no entry; one with no such parent must wait a release before it is
// added. (List order is irrelevant — a single TRUNCATE ... CASCADE resolves and truncates the
// whole set atomically, reaching FK children regardless of position.)
export const REBUILD_TRUNCATE_TABLES = [
  "positions", "build_events", "hit_events", "kills", "sessions", "lives", "players",
] as const;

export async function rebuildAll(db: Database, consumerName = "projector"): Promise<void> {
  // Identifiers are a fixed internal allowlist (never user input), so sql.raw is safe here.
  await db.execute(sql`TRUNCATE TABLE ${sql.raw(REBUILD_TRUNCATE_TABLES.join(", "))} RESTART IDENTITY CASCADE`);
  await setCursor(db, consumerName, 0);
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const cfg = loadConfig(process.env);
  const log = pino({ level: cfg.logLevel });
  const { db, sql: end } = getDb(cfg.databaseUrl);
  rebuildAll(db)
    .then(() => log.info("projection rebuild complete (cursor reset to 0)"))
    .catch((err) => { log.fatal({ err }, "rebuild failed"); process.exitCode = 1; })
    .finally(() => end.end());
}
