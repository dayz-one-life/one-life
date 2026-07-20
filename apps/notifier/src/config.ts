import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  SITE_URL: z.string().min(1),
  NOTIFIER_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
  NOTIFIER_SINCE: z.string().optional(),
  NOTIFIER_DRY_RUN: z.string().optional(),
  NOTIFIER_LOOKBACK_HOURS: z.coerce.number().int().positive().default(48),
  NOTIFIER_PUSH_ENABLED: z.string().optional(),
  NOTIFIER_PUSH_MAX_PER_TICK: z.coerce.number().int().positive().default(50),
  NOTIFIER_PUSH_MAX_AGE_MINUTES: z.coerce.number().int().positive().default(60),
  VAPID_PUBLIC_KEY: z.string().default(""),
  VAPID_PRIVATE_KEY: z.string().default(""),
  VAPID_SUBJECT: z.string().default(""),
  LOG_LEVEL: z.string().default("info"),
});

export type Config = {
  databaseUrl: string; intervalSeconds: number; logLevel: string;
  since: Date | null; dryRun: boolean; lookbackHours: number; siteUrl: string;
  pushEnabled: boolean; pushMaxPerTick: number; pushMaxAgeMinutes: number;
  vapidPublicKey: string; vapidPrivateKey: string; vapidSubject: string;
};

/** An unset, empty, or unparseable NOTIFIER_SINCE means generation is OFF — never a
 *  silent epoch default, which would notify every player about their entire history. */
function parseSince(raw: string | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const p = schema.parse(env);
  return {
    databaseUrl: p.DATABASE_URL,
    intervalSeconds: p.NOTIFIER_INTERVAL_SECONDS,
    logLevel: p.LOG_LEVEL,
    since: parseSince(p.NOTIFIER_SINCE),
    // SAFE DEFAULT: dry-run unless explicitly disabled with "false". Deliberately NOT an enum —
    // a blank, mis-cased, or junk value must land on the safe side, not throw at module scope
    // in main.ts and crash-loop the unit. Mirrors apps/newsdesk/src/config.ts.
    dryRun: p.NOTIFIER_DRY_RUN !== "false",
    lookbackHours: p.NOTIFIER_LOOKBACK_HOURS,
    siteUrl: p.SITE_URL,
    // Same idiom, same reason: an unparseable value leaves push on its configured default
    // rather than killing the worker. VAPID validity is the real gate (see buildSender).
    pushEnabled: p.NOTIFIER_PUSH_ENABLED !== "false",
    pushMaxPerTick: p.NOTIFIER_PUSH_MAX_PER_TICK,
    pushMaxAgeMinutes: p.NOTIFIER_PUSH_MAX_AGE_MINUTES,
    vapidPublicKey: p.VAPID_PUBLIC_KEY,
    vapidPrivateKey: p.VAPID_PRIVATE_KEY,
    vapidSubject: p.VAPID_SUBJECT,
  };
}
