import { getDb, type Database } from "@onelife/db";
import { setCursor } from "@onelife/event-log";
import { sql } from "drizzle-orm";
import pino from "pino";
import { loadConfig } from "./config.js";

export async function rebuildAll(db: Database, consumerName = "projector"): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE
    positions, build_events, hit_events, kills, sessions, lives, players
    RESTART IDENTITY CASCADE`);
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
