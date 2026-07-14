import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  GRANTER_INTERVAL_SECONDS: z.coerce.number().int().positive().default(300),
  LOG_LEVEL: z.string().default("info"),
});

export type Config = { databaseUrl: string; intervalSeconds: number; logLevel: string };

export function loadConfig(env: Record<string, string | undefined>): Config {
  const p = schema.parse(env);
  return { databaseUrl: p.DATABASE_URL, intervalSeconds: p.GRANTER_INTERVAL_SECONDS, logLevel: p.LOG_LEVEL };
}
