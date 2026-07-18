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
};

/** Parse the forward-only birth cutoff. Unset / empty / unparseable -> null (birth pass off) — a
 *  safe default parallel to the dry-run gate. */
function parseBirthSince(raw: string | undefined): Date | null {
  if (!raw || raw.trim() === "") return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
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
    birthSince: parseBirthSince(p.NEWSDESK_BIRTH_SINCE),
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
  };
}
