import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  NITRADO_TOKEN: z.string().default(""),
  ENFORCER_DRY_RUN: z.string().optional(),
  ENFORCER_INTERVAL_SECONDS: z.coerce.number().int().positive().default(300),
  BAN_DURATION_HOURS: z.coerce.number().positive().default(24),
  LOG_LEVEL: z.string().default("info"),
});

export type Config = {
  databaseUrl: string;
  nitradoToken: string;
  dryRun: boolean;
  intervalSeconds: number;
  banDurationHours: number;
  logLevel: string;
};

export function loadConfig(env: Record<string, string | undefined>): Config {
  const p = schema.parse(env);
  return {
    databaseUrl: p.DATABASE_URL,
    nitradoToken: p.NITRADO_TOKEN,
    // SAFE DEFAULT: dry-run unless explicitly disabled with "false".
    dryRun: p.ENFORCER_DRY_RUN !== "false",
    intervalSeconds: p.ENFORCER_INTERVAL_SECONDS,
    banDurationHours: p.BAN_DURATION_HOURS,
    logLevel: p.LOG_LEVEL,
  };
}
