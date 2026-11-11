import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PROJECTOR_INTERVAL_SECONDS: z.coerce.number().int().positive().default(30),
  PROJECTOR_BATCH_SIZE: z.coerce.number().int().positive().default(500),
  TRAP_KILLS_WRITE: z.string().optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export type Config = {
  databaseUrl: string; intervalSeconds: number; batchSize: number; logLevel: string;
  /**
   * Whether the verdict sweep writes trap kills into `kills` (death-verdict spec 2.4). SAFE
   * DEFAULT off: a row in `kills` is public, counts toward qualification and so toward bans, the
   * moment it is written. Off, the outcome is kept in `death_verdicts.evidence.credit` only and any
   * trap row found is removed on the next pass, which also makes it the rollback.
   */
  trapKillsWrite: boolean;
};

export function loadConfig(env: Record<string, string | undefined>): Config {
  const p = schema.parse(env);
  return { databaseUrl: p.DATABASE_URL, intervalSeconds: p.PROJECTOR_INTERVAL_SECONDS, batchSize: p.PROJECTOR_BATCH_SIZE, logLevel: p.LOG_LEVEL,
    trapKillsWrite: p.TRAP_KILLS_WRITE === "true" };
}
