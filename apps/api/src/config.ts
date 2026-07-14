import { z } from "zod";
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  AUTH_TRUSTED_ORIGINS: z.string().default("http://localhost:3000"),
});
export type Config = {
  databaseUrl: string;
  port: number;
  logLevel: string;
  corsOrigins: string[];
};
export function loadConfig(env: Record<string, string | undefined>): Config {
  const p = schema.parse(env);
  return {
    databaseUrl: p.DATABASE_URL,
    port: p.PORT,
    logLevel: p.LOG_LEVEL,
    corsOrigins: p.AUTH_TRUSTED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
  };
}
