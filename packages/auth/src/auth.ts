import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink, bearer } from "better-auth/plugins";
import { user, session, account, verification, type Database } from "@onelife/db";
import type { AuthConfig } from "./config.js";

export function createAuth(db: Database, cfg: AuthConfig) {
  const socialProviders: Record<string, { clientId: string; clientSecret: string; prompt?: "consent" | "none" }> = {};
  // prompt=consent: Better Auth's Discord provider otherwise defaults to prompt=none,
  // which silently authorizes with whatever Discord account is already active (no account
  // chooser). Forcing consent lets the user review and switch accounts each sign-in.
  if (cfg.providers.discord) socialProviders.discord = { ...cfg.providers.discord, prompt: "consent" };
  if (cfg.providers.google) socialProviders.google = cfg.providers.google;
  if (cfg.providers.github) socialProviders.github = cfg.providers.github;

  return betterAuth({
    secret: cfg.secret,
    baseURL: cfg.baseURL,
    trustedOrigins: cfg.trustedOrigins,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { user, session, account, verification },
    }),
    emailAndPassword: { enabled: false },
    socialProviders,
    account: {
      accountLinking: {
        enabled: true,
        // Only email-verifying providers may auto-link by matching email.
        // Google verifies emails. A magic-link login already proves email
        // ownership, so it needs no entry. Discord/GitHub require explicit
        // link-while-logged-in (anti-takeover).
        trustedProviders: ["google"],
        allowDifferentEmails: false,
      },
    },
    plugins: [
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          await cfg.mailer.send({
            to: email,
            subject: "Your One Life sign-in link",
            body: `Click to sign in: ${url}`,
            url,
          });
        },
      }),
      bearer(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
