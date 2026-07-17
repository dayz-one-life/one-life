import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  OPENROUTER_API_KEY: z.string().default(""),
  NEWSDESK_MODEL: z.string().default("anthropic/claude-sonnet-5"),
  NEWSDESK_DRY_RUN: z.string().optional(),
  NEWSDESK_INTERVAL_SECONDS: z.coerce.number().int().positive().default(300),
  NEWSDESK_BATCH_CAP: z.coerce.number().int().positive().default(10),
  NEWSDESK_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  NEWSDESK_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.7),
  LOG_LEVEL: z.string().default("info"),
});

export type Config = {
  databaseUrl: string;
  openrouterApiKey: string;
  model: string;
  dryRun: boolean;
  intervalSeconds: number;
  batchCap: number;
  maxAttempts: number;
  temperature: number;
  logLevel: string;
};

export function loadConfig(env: Record<string, string | undefined>): Config {
  const p = schema.parse(env);
  return {
    databaseUrl: p.DATABASE_URL,
    openrouterApiKey: p.OPENROUTER_API_KEY,
    model: p.NEWSDESK_MODEL,
    // SAFE DEFAULT: dry-run unless explicitly disabled with "false".
    dryRun: p.NEWSDESK_DRY_RUN !== "false",
    intervalSeconds: p.NEWSDESK_INTERVAL_SECONDS,
    batchCap: p.NEWSDESK_BATCH_CAP,
    maxAttempts: p.NEWSDESK_MAX_ATTEMPTS,
    temperature: p.NEWSDESK_TEMPERATURE,
    logLevel: p.LOG_LEVEL,
  };
}
