import { z } from "zod";
import { consoleMailer, type Mailer } from "./mailer.js";

const schema = z
  .object({
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.string().url(),
    AUTH_TRUSTED_ORIGINS: z.string().default("http://localhost:3000"),
    MAIL_TRANSPORT: z.enum(["console"]).default("console"),
    // Magic-link (email) sign-in is on unless explicitly disabled.
    MAGIC_LINK_ENABLED: z.enum(["true", "false"]).default("true"),
    DISCORD_CLIENT_ID: z.string().optional(),
    DISCORD_CLIENT_SECRET: z.string().optional(),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    GITHUB_CLIENT_ID: z.string().optional(),
    GITHUB_CLIENT_SECRET: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    for (const p of ["DISCORD", "GOOGLE", "GITHUB"] as const) {
      const id = v[`${p}_CLIENT_ID`];
      const secret = v[`${p}_CLIENT_SECRET`];
      if (Boolean(id) !== Boolean(secret)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${p}_CLIENT_ID and ${p}_CLIENT_SECRET must be set together`,
          path: [`${p}_CLIENT_ID`],
        });
      }
    }
  });

export interface ProviderCreds {
  clientId: string;
  clientSecret: string;
}

export interface AuthConfig {
  secret: string;
  baseURL: string;
  trustedOrigins: string[];
  providers: { discord?: ProviderCreds; google?: ProviderCreds; github?: ProviderCreds };
  /** Whether email/magic-link sign-in is enabled. Absent is treated as enabled. */
  magicLink?: boolean;
  mailer: Mailer;
}

/** The sign-in methods the login UI should offer, derived from what is configured. */
export interface AuthMethods {
  /** Configured social providers, in a stable order (discord, google, github). */
  providers: string[];
  magicLink: boolean;
}

/** Derives the enabled sign-in methods from a loaded config. Single source of truth for the login UI. */
export function enabledAuthMethods(cfg: AuthConfig): AuthMethods {
  return {
    providers: Object.entries(cfg.providers)
      .filter(([, creds]) => creds)
      .map(([name]) => name),
    magicLink: cfg.magicLink !== false,
  };
}

const MAILERS: Record<string, Mailer> = { console: consoleMailer };

export function loadAuthConfig(env: Record<string, string | undefined>): AuthConfig {
  const p = schema.parse(env);
  const pair = (id?: string, secret?: string): ProviderCreds | undefined =>
    id && secret ? { clientId: id, clientSecret: secret } : undefined;
  const mailer = MAILERS[p.MAIL_TRANSPORT];
  if (!mailer) throw new Error(`Unknown MAIL_TRANSPORT: ${p.MAIL_TRANSPORT}`);
  return {
    secret: p.BETTER_AUTH_SECRET,
    baseURL: p.BETTER_AUTH_URL,
    trustedOrigins: p.AUTH_TRUSTED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
    providers: {
      discord: pair(p.DISCORD_CLIENT_ID, p.DISCORD_CLIENT_SECRET),
      google: pair(p.GOOGLE_CLIENT_ID, p.GOOGLE_CLIENT_SECRET),
      github: pair(p.GITHUB_CLIENT_ID, p.GITHUB_CLIENT_SECRET),
    },
    magicLink: p.MAGIC_LINK_ENABLED !== "false",
    mailer,
  };
}
