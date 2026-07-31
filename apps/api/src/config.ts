import { z } from "zod";
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  AUTH_TRUSTED_ORIGINS: z.string().default("http://localhost:3000"),
  // Optional on purpose: push is an opt-in extra, so a missing key must not stop the API
  // booting and take the whole public site down with it. main.ts warns loudly instead —
  // the failure it prevents is silent (subscribe() throws, the toggle swallows it, the
  // notifier reports success because it finds zero subscriptions).
  VAPID_PUBLIC_KEY: z.string().default(""),
  // Test-only escape hatch for fetchProviderImage's provider-host allowlist — permits plain
  // http on loopback so tests can stand up a local stub server without TLS. Unparseable, unset,
  // or anything other than the literal string "true" lands on the safe side (OFF), matching the
  // NOTIFIER_* convention: `.default()` only fires on `undefined`, so a blank/mis-cased value
  // must not throw at module scope.
  AVATAR_TEST_FETCH_ALLOW_LOOPBACK: z.string().optional(),
  // Token store (Stripe). All-or-nothing: the store is ON only when all three are set;
  // a partial set is treated as OFF and warned about in main.ts. Unset-means-OFF, per
  // the workers' convention — there is no default key and no test fallback.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_TOKEN_PRICE_ID: z.string().optional(),
});
export type Config = {
  databaseUrl: string;
  port: number;
  logLevel: string;
  corsOrigins: string[];
  vapidPublicKey: string;
  avatarTestFetchAllowLoopback: boolean;
  stripe: { secretKey: string; webhookSecret: string; priceId: string } | null;
};
export function loadConfig(env: Record<string, string | undefined>): Config {
  const p = schema.parse(env);
  return {
    databaseUrl: p.DATABASE_URL,
    port: p.PORT,
    logLevel: p.LOG_LEVEL,
    corsOrigins: p.AUTH_TRUSTED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
    vapidPublicKey: p.VAPID_PUBLIC_KEY,
    avatarTestFetchAllowLoopback: p.AVATAR_TEST_FETCH_ALLOW_LOOPBACK === "true",
    stripe:
      p.STRIPE_SECRET_KEY && p.STRIPE_WEBHOOK_SECRET && p.STRIPE_TOKEN_PRICE_ID
        ? { secretKey: p.STRIPE_SECRET_KEY, webhookSecret: p.STRIPE_WEBHOOK_SECRET, priceId: p.STRIPE_TOKEN_PRICE_ID }
        : null,
  };
}
