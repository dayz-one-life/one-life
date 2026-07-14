import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PROJECTOR_INTERVAL_SECONDS: z.coerce.number().int().positive().default(30),
  PROJECTOR_BATCH_SIZE: z.coerce.number().int().positive().default(500),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export type Config = { databaseUrl: string; intervalSeconds: number; batchSize: number; logLevel: string };

export function loadConfig(env: Record<string, string | undefined>): Config {
  const p = schema.parse(env);
  return { databaseUrl: p.DATABASE_URL, intervalSeconds: p.PROJECTOR_INTERVAL_SECONDS, batchSize: p.PROJECTOR_BATCH_SIZE, logLevel: p.LOG_LEVEL };
}
