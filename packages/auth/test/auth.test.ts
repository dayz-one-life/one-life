import { describe, it, expect } from "vitest";
import { createAuth } from "../src/auth.js";
import { consoleMailer } from "../src/mailer.js";
import type { AuthConfig } from "../src/config.js";
import { getTestDb } from "@onelife/test-support";

// No DB connection is made at construction time, so the guarded test DB is fine.
const { db } = getTestDb();

function cfg(overrides: Partial<AuthConfig> = {}): AuthConfig {
  return {
    secret: "s".repeat(32),
    baseURL: "http://localhost:3001",
    trustedOrigins: ["http://localhost:3000"],
    providers: {},
    mailer: consoleMailer,
    ...overrides,
  };
}

describe("createAuth", () => {
  it("enables account linking with only trusted email-verifying providers", () => {
    const auth = createAuth(db, cfg());
    expect(auth.options.account?.accountLinking?.enabled).toBe(true);
    expect(auth.options.account?.accountLinking?.trustedProviders).toEqual(["google"]);
    expect(auth.options.account?.accountLinking?.allowDifferentEmails).toBe(false);
  });

  it("keeps email+password disabled", () => {
    const auth = createAuth(db, cfg());
    expect(auth.options.emailAndPassword?.enabled ?? false).toBe(false);
  });

  it("registers only the social providers present in config", () => {
    const auth = createAuth(
      db,
      cfg({ providers: { google: { clientId: "g", clientSecret: "gs" } } }),
    );
    expect(auth.options.socialProviders?.google).toBeDefined();
    expect(auth.options.socialProviders?.discord).toBeUndefined();
    expect(auth.options.socialProviders?.github).toBeUndefined();
  });

  it("invokes the mailer when magic-link asks to send", async () => {
    let captured = "";
    const mailer = { async send(m: { url: string }) { captured = m.url; } };
    const auth = createAuth(db, cfg({ mailer }));
    // The magic-link plugin option is stored on the plugin; call it directly.
    const plugin = auth.options.plugins?.find((p: { id?: string }) => p.id === "magic-link");
    expect(plugin).toBeDefined();
    // Guard: exact option surface is version-specific; this asserts wiring exists.
    expect(typeof (plugin as { options?: { sendMagicLink?: unknown } })?.options?.sendMagicLink).toBe("function");
    await (plugin as { options: { sendMagicLink: (d: { email: string; url: string; token: string }) => Promise<void> } })
      .options.sendMagicLink({ email: "a@b.com", url: "http://x/verify?token=t", token: "t" });
    expect(captured).toBe("http://x/verify?token=t");
  });
});
