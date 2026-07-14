import { describe, it, expect } from "vitest";
import { loadAuthConfig, enabledAuthMethods } from "../src/config.js";
import { consoleMailer } from "../src/mailer.js";

const base = {
  BETTER_AUTH_SECRET: "s".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3001",
};

describe("loadAuthConfig", () => {
  it("defaults trustedOrigins and uses the console mailer", () => {
    const cfg = loadAuthConfig(base);
    expect(cfg.secret).toBe("s".repeat(32));
    expect(cfg.baseURL).toBe("http://localhost:3001");
    expect(cfg.trustedOrigins).toEqual(["http://localhost:3000"]);
    expect(cfg.mailer).toBe(consoleMailer);
    expect(cfg.providers).toEqual({});
  });

  it("registers only providers whose id+secret are both present", () => {
    const cfg = loadAuthConfig({
      ...base,
      GOOGLE_CLIENT_ID: "gid",
      GOOGLE_CLIENT_SECRET: "gsec",
      AUTH_TRUSTED_ORIGINS: "http://a.com,http://b.com",
    });
    expect(cfg.providers.google).toEqual({ clientId: "gid", clientSecret: "gsec" });
    expect(cfg.providers.discord).toBeUndefined();
    expect(cfg.trustedOrigins).toEqual(["http://a.com", "http://b.com"]);
  });

  it("throws when a provider is half-configured (id without secret)", () => {
    expect(() => loadAuthConfig({ ...base, DISCORD_CLIENT_ID: "only-id" })).toThrow();
  });

  it("throws when BETTER_AUTH_SECRET is missing", () => {
    expect(() => loadAuthConfig({ BETTER_AUTH_URL: "http://localhost:3001" })).toThrow();
  });

  it("enables magic link by default and disables it when MAGIC_LINK_ENABLED=false", () => {
    expect(loadAuthConfig(base).magicLink).toBe(true);
    expect(loadAuthConfig({ ...base, MAGIC_LINK_ENABLED: "false" }).magicLink).toBe(false);
    expect(loadAuthConfig({ ...base, MAGIC_LINK_ENABLED: "true" }).magicLink).toBe(true);
  });

  it("throws when MAGIC_LINK_ENABLED is not a boolean string", () => {
    expect(() => loadAuthConfig({ ...base, MAGIC_LINK_ENABLED: "yes" })).toThrow();
  });
});

describe("enabledAuthMethods", () => {
  it("lists only configured providers in a stable order, plus the magic-link flag", () => {
    const cfg = loadAuthConfig({
      ...base,
      GITHUB_CLIENT_ID: "id",
      GITHUB_CLIENT_SECRET: "sec",
      DISCORD_CLIENT_ID: "id",
      DISCORD_CLIENT_SECRET: "sec",
    });
    expect(enabledAuthMethods(cfg)).toEqual({ providers: ["discord", "github"], magicLink: true });
  });

  it("reports no methods when nothing is configured and magic link is off", () => {
    const cfg = loadAuthConfig({ ...base, MAGIC_LINK_ENABLED: "false" });
    expect(enabledAuthMethods(cfg)).toEqual({ providers: [], magicLink: false });
  });

  it("treats an absent magicLink field as enabled", () => {
    expect(
      enabledAuthMethods({ secret: "s", baseURL: "b", trustedOrigins: [], providers: {}, mailer: consoleMailer }).magicLink,
    ).toBe(true);
  });
});
