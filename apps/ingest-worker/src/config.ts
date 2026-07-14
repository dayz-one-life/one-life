import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  NITRADO_TOKEN: z.string().min(1),
  INGEST_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
  ADM_BACKFILL_BUDGET: z.coerce.number().int().nonnegative().default(15),
  CHAR_STALE_HOURS: z.coerce.number().positive().default(72),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export type Config = {
  databaseUrl: string;
  nitradoToken: string;
  intervalSeconds: number;
  backfillBudget: number;
  charStaleHours: number;
  logLevel: string;
};

export function loadConfig(env: Record<string, string | undefined>): Config {
  const p = schema.parse(env);
  return {
    databaseUrl: p.DATABASE_URL,
    nitradoToken: p.NITRADO_TOKEN,
    intervalSeconds: p.INGEST_INTERVAL_SECONDS,
    backfillBudget: p.ADM_BACKFILL_BUDGET,
    charStaleHours: p.CHAR_STALE_HOURS,
    logLevel: p.LOG_LEVEL,
  };
}
