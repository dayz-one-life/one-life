import { describe, it, expect } from "vitest";
import { loadAuthConfig } from "../src/config.js";
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
});
