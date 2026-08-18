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
  // Minimum supported mobile app version, per platform. Unset means OFF, per the convention
  // above — see NO_VERSION_FLOOR for why that direction is not negotiable. Kept per-platform
  // because the stores genuinely diverge: a release can sit in App Store review for days while
  // the Android build has already shipped.
  IOS_MIN_APP_VERSION: z.string().optional(),
  ANDROID_MIN_APP_VERSION: z.string().optional(),
  // Comma-separated user ids allowed to review reported avatars. UNSET MEANS NOBODY, and every
  // moderation route 403s — never fail open. Blank entries are dropped so a trailing comma
  // cannot admit an empty id, which would match a caller with no session id.
  MODERATOR_USER_IDS: z.string().default(""),
});

/**
 * ⚠️ The gate's off switch, and the value every failure path lands on. No release can be below
 * it, so publishing it blocks nobody.
 *
 * This direction is deliberate and load-bearing. An over-permissive floor costs nothing — the
 * gate is a UX affordance telling an honest client to update, not a security boundary. An
 * over-strict one walls every user of a shipped app behind an update that does not exist, and
 * it is fixable only by an API deploy, only after someone notices.
 */
const NO_VERSION_FLOOR = "0.0.0";

/**
 * Dotted numeric, one to three segments. Deliberately stricter than `compareVersions` in
 * `@onelife/client-logic/app-version`, which additionally tolerates `-prerelease` and `+build`
 * suffixes: anything this accepts, the client can parse. A value that gets past here but not
 * past the client would fail open there and silently disable the gate.
 *
 * Not imported from that package: `packages/client-logic` is bundler-consumed (extensionless
 * specifiers) and this app is node/tsx-consumed (`.js` specifiers). No logic is shared anyway —
 * the server publishes a floor and never compares against it.
 */
const VERSION_RE = /^\d+(\.\d+){0,2}$/;

function versionFloor(raw: string | undefined): string {
  // Unset, blank, or a typo all land on the same safe value. Never throws: refusing to boot
  // over a mobile-only gate would take the whole public website down with it.
  return raw && VERSION_RE.test(raw.trim()) ? raw.trim() : NO_VERSION_FLOOR;
}

export type Config = {
  databaseUrl: string;
  port: number;
  logLevel: string;
  corsOrigins: string[];
  vapidPublicKey: string;
  avatarTestFetchAllowLoopback: boolean;
  stripe: { secretKey: string; webhookSecret: string; priceId: string } | null;
  minAppVersion: { ios: string; android: string };
  moderatorUserIds: string[];
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
    minAppVersion: {
      ios: versionFloor(p.IOS_MIN_APP_VERSION),
      android: versionFloor(p.ANDROID_MIN_APP_VERSION),
    },
    moderatorUserIds: p.MODERATOR_USER_IDS.split(",").map((s) => s.trim()).filter(Boolean),
  };
}
