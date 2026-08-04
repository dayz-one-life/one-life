import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  SITE_URL: z.string().default("https://dayzonelife.com"),
  CRIER_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
  CRIER_SINCE: z.string().optional(),
  CRIER_DRY_RUN: z.string().optional(),
  CRIER_BATCH_CAP: z.coerce.number().int().positive().default(10),
  CRIER_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  CRIER_DISCORD_WEBHOOK_URL: z.string().optional(),
  CRIER_FB_PAGE_ID: z.string().optional(),
  CRIER_FB_PAGE_ACCESS_TOKEN: z.string().optional(),
  CRIER_REDDIT_CLIENT_ID: z.string().optional(),
  CRIER_REDDIT_CLIENT_SECRET: z.string().optional(),
  CRIER_REDDIT_REFRESH_TOKEN: z.string().optional(),
  CRIER_REDDIT_SUBREDDIT: z.string().optional(),
  CRIER_REDDIT_USER_AGENT: z.string().optional(),
  CRIER_REDDIT_FLAIR_ID: z.string().optional(),
  CRIER_REDDIT_MIN_INTERVAL_SECONDS: z.coerce.number().int().nonnegative().default(600),
  LOG_LEVEL: z.string().default("info"),
});

/** ⚠️ Distinctive by design — Reddit throttles generic and shared user agents hard. */
const DEFAULT_REDDIT_USER_AGENT = "onelife-crier/1.0 (+https://dayzonelife.com)";

export type RedditConfig = {
  clientId: string; clientSecret: string; refreshToken: string;
  subreddit: string; userAgent: string; flairId: string | null;
};

export type Config = {
  databaseUrl: string; siteUrl: string; intervalSeconds: number;
  since: Date | null; dryRun: boolean; batchCap: number; maxAttempts: number;
  discordWebhookUrl: string | null;
  fbPageId: string | null; fbPageAccessToken: string | null;
  reddit: RedditConfig | null;
  redditMinIntervalSeconds: number;
  logLevel: string;
};

/** An unset, empty, or unparseable CRIER_SINCE means the worker does nothing — never a silent
 *  epoch default, which would blast every historical obituary into a fresh channel. */
function parseSince(raw: string | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const p = schema.parse(env);
  // Facebook needs BOTH creds; half a credential set stays disabled rather than half-posting.
  const fbEnabled = Boolean(p.CRIER_FB_PAGE_ID && p.CRIER_FB_PAGE_ACCESS_TOKEN);
  // Same rule, four credentials. User agent and flair are NOT part of the gate: one has a
  // default and the other is genuinely optional.
  const redditEnabled = Boolean(
    p.CRIER_REDDIT_CLIENT_ID && p.CRIER_REDDIT_CLIENT_SECRET &&
    p.CRIER_REDDIT_REFRESH_TOKEN && p.CRIER_REDDIT_SUBREDDIT,
  );
  return {
    databaseUrl: p.DATABASE_URL,
    siteUrl: p.SITE_URL,
    intervalSeconds: p.CRIER_INTERVAL_SECONDS,
    since: parseSince(p.CRIER_SINCE),
    // SAFE DEFAULT: dry-run unless explicitly disabled with "false". Deliberately NOT an enum —
    // a blank, mis-cased, or junk value must land on the safe side. Mirrors notifier/newsdesk.
    dryRun: p.CRIER_DRY_RUN !== "false",
    batchCap: p.CRIER_BATCH_CAP,
    maxAttempts: p.CRIER_MAX_ATTEMPTS,
    discordWebhookUrl: p.CRIER_DISCORD_WEBHOOK_URL || null,
    fbPageId: fbEnabled ? p.CRIER_FB_PAGE_ID! : null,
    fbPageAccessToken: fbEnabled ? p.CRIER_FB_PAGE_ACCESS_TOKEN! : null,
    reddit: redditEnabled
      ? {
          clientId: p.CRIER_REDDIT_CLIENT_ID!,
          clientSecret: p.CRIER_REDDIT_CLIENT_SECRET!,
          refreshToken: p.CRIER_REDDIT_REFRESH_TOKEN!,
          subreddit: p.CRIER_REDDIT_SUBREDDIT!,
          userAgent: p.CRIER_REDDIT_USER_AGENT || DEFAULT_REDDIT_USER_AGENT,
          flairId: p.CRIER_REDDIT_FLAIR_ID || null,
        }
      : null,
    redditMinIntervalSeconds: p.CRIER_REDDIT_MIN_INTERVAL_SECONDS,
    logLevel: p.LOG_LEVEL,
  };
}
