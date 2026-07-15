import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  NITRADO_TOKEN: z.string().min(1),
  LOG_LEVEL: z.string().default("info"),
});

export type Config = { databaseUrl: string; nitradoToken: string; logLevel: string };

export function loadConfig(env: Record<string, string | undefined>): Config {
  const p = schema.parse(env);
  return { databaseUrl: p.DATABASE_URL, nitradoToken: p.NITRADO_TOKEN, logLevel: p.LOG_LEVEL };
}
