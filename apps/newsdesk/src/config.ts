import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  OPENROUTER_API_KEY: z.string().default(""),
  NEWSDESK_MODEL: z.string().default("anthropic/claude-sonnet-5"),
  NEWSDESK_DRY_RUN: z.string().optional(),
  NEWSDESK_BIRTH_SINCE: z.string().optional(),
  NEWSDESK_INTERVAL_SECONDS: z.coerce.number().int().positive().default(300),
  NEWSDESK_BATCH_CAP: z.coerce.number().int().positive().default(10),
  NEWSDESK_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  NEWSDESK_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.7),
  DISCORD_OBITUARY_WEBHOOK_URL: z.string().default(""),
  SITE_URL: z.string().default("https://dayzonelife.com"),
  NEWSDESK_DISCORD_MAX_PER_TICK: z.coerce.number().int().positive().default(10),
  LOG_LEVEL: z.string().default("info"),
  NEWSDESK_IMAGE_MODEL: z.string().default("openai/gpt-5-image-mini"),
  NEWSDESK_IMAGE_MODEL_FLAGSHIP: z.string().default("openai/gpt-5.4-image-2"),
  NEWSDESK_IMAGE_QUALITY: z.string().default("low"),
  NEWSDESK_IMAGES_ENABLED: z.string().optional(),
  // ── R5d news pass. Two independent OFF switches: the kill switch below, and an unset
  // NEWSDESK_NEWS_SINCE. Both default to off, so this release is inert until an operator opts in.
  NEWSDESK_NEWS_ENABLED: z.string().optional(),
  NEWSDESK_NEWS_SINCE: z.string().optional(),
  NEWSDESK_NEWS_MAX_PER_TICK: z.coerce.number().int().positive().default(2),
  NEWSDESK_STANDING_DEAD_HOURS: z.coerce.number().positive().default(72),
  NEWSDESK_STANDING_DEAD_MIN_PLAYTIME_SECONDS: z.coerce.number().int().nonnegative().default(1800),
  NEWSDESK_STANDING_DEAD_MIN_HITS: z.coerce.number().int().nonnegative().default(100),
  NEWSDESK_NEWS_SUPPRESSED_GAMERTAGS: z.string().default(""),
  NEWSDESK_LONGFORM_WINDOW_SECONDS: z.coerce.number().positive().default(180),
  NEWSDESK_LONGFORM_RADIUS_METERS: z.coerce.number().positive().default(100),
  NEWSDESK_LONGFORM_MAX_FIX_AGE_SECONDS: z.coerce.number().positive().default(120),
});

export type Config = {
  databaseUrl: string;
  openrouterApiKey: string;
  model: string;
  dryRun: boolean;
  birthSince: Date | null;
  intervalSeconds: number;
  batchCap: number;
  maxAttempts: number;
  temperature: number;
  discordWebhookUrl: string;
  siteUrl: string;
  discordMaxPerTick: number;
  logLevel: string;
  imageModel: string;
  imageFlagshipModel: string;
  imageQuality: string;
  imagesEnabled: boolean;
  newsEnabled: boolean;
  newsSince: Date | null;
  newsMaxPerTick: number;
  standingDeadHours: number;
  standingDeadMinPlaytimeSeconds: number;
  standingDeadMinHits: number;
  newsSuppressedGamertags: string[];
  longFormWindowSeconds: number;
  longFormRadiusMeters: number;
  longFormMaxFixAgeSeconds: number;
};

/** Parse a forward-only go-live cutoff. Unset / empty / unparseable -> null, which turns the
 *  owning pass OFF — a safe default parallel to the dry-run gate. Shared by the birth pass and
 *  the news pass so the two cutoffs can never drift in parsing behaviour. */
function parseSince(raw: string | undefined): Date | null {
  if (!raw || raw.trim() === "") return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Comma-separated subject opt-out list (spec §13.3). Trimmed, empties dropped, CASE PRESERVED:
 *  the targeting layer lowercases for comparison itself, and a gamertag is stored verbatim
 *  everywhere else in this codebase. */
function parseGamertagList(raw: string): string[] {
  return raw.split(",").map((g) => g.trim()).filter((g) => g.length > 0);
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const p = schema.parse(env);
  return {
    databaseUrl: p.DATABASE_URL,
    openrouterApiKey: p.OPENROUTER_API_KEY,
    model: p.NEWSDESK_MODEL,
    // SAFE DEFAULT: dry-run unless explicitly disabled with "false".
    dryRun: p.NEWSDESK_DRY_RUN !== "false",
    // SAFE DEFAULT: birth pass off unless a valid ISO cutoff is provided.
    birthSince: parseSince(p.NEWSDESK_BIRTH_SINCE),
    intervalSeconds: p.NEWSDESK_INTERVAL_SECONDS,
    batchCap: p.NEWSDESK_BATCH_CAP,
    maxAttempts: p.NEWSDESK_MAX_ATTEMPTS,
    temperature: p.NEWSDESK_TEMPERATURE,
    discordWebhookUrl: p.DISCORD_OBITUARY_WEBHOOK_URL,
    siteUrl: p.SITE_URL,
    discordMaxPerTick: p.NEWSDESK_DISCORD_MAX_PER_TICK,
    logLevel: p.LOG_LEVEL,
    imageModel: p.NEWSDESK_IMAGE_MODEL,
    imageFlagshipModel: p.NEWSDESK_IMAGE_MODEL_FLAGSHIP,
    imageQuality: p.NEWSDESK_IMAGE_QUALITY,
    // Kill switch for images only — a broken image pipeline must never stop the prose.
    imagesEnabled: p.NEWSDESK_IMAGES_ENABLED !== "false",
    // SAFE DEFAULT, INVERTED vs the image switch: the news pass is OPT-IN. It publishes permanent
    // indexed articles about people who are alive and did not ask to be covered, so the default
    // must be silence and only the exact string "true" may break it.
    newsEnabled: p.NEWSDESK_NEWS_ENABLED === "true",
    // SAFE DEFAULT: news pass off unless a valid ISO cutoff is provided.
    newsSince: parseSince(p.NEWSDESK_NEWS_SINCE),
    newsMaxPerTick: p.NEWSDESK_NEWS_MAX_PER_TICK,
    standingDeadHours: p.NEWSDESK_STANDING_DEAD_HOURS,
    standingDeadMinPlaytimeSeconds: p.NEWSDESK_STANDING_DEAD_MIN_PLAYTIME_SECONDS,
    standingDeadMinHits: p.NEWSDESK_STANDING_DEAD_MIN_HITS,
    newsSuppressedGamertags: parseGamertagList(p.NEWSDESK_NEWS_SUPPRESSED_GAMERTAGS),
    longFormWindowSeconds: p.NEWSDESK_LONGFORM_WINDOW_SECONDS,
    longFormRadiusMeters: p.NEWSDESK_LONGFORM_RADIUS_METERS,
    longFormMaxFixAgeSeconds: p.NEWSDESK_LONGFORM_MAX_FIX_AGE_SECONDS,
  };
}
