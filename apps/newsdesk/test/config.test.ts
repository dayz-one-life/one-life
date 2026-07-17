import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

const BASE = { DATABASE_URL: "postgres://x/y" };

describe("newsdesk config — dry-run safety default", () => {
  it("defaults dryRun TRUE and the model slug when unset", () => {
    const c = loadConfig({ ...BASE });
    expect(c.dryRun).toBe(true);
    expect(c.model).toBe("anthropic/claude-sonnet-5");
    expect(c.batchCap).toBe(10);
    expect(c.maxAttempts).toBe(3);
  });
  it("stays dry-run for any value that is not exactly 'false'", () => {
    expect(loadConfig({ ...BASE, NEWSDESK_DRY_RUN: "" }).dryRun).toBe(true);
    expect(loadConfig({ ...BASE, NEWSDESK_DRY_RUN: "true" }).dryRun).toBe(true);
  });
  it("generates for real ONLY when NEWSDESK_DRY_RUN is exactly 'false'", () => {
    expect(loadConfig({ ...BASE, NEWSDESK_DRY_RUN: "false" }).dryRun).toBe(false);
  });
  it("honors an overridden model slug", () => {
    expect(loadConfig({ ...BASE, NEWSDESK_MODEL: "anthropic/claude-opus-4.5" }).model).toBe("anthropic/claude-opus-4.5");
  });
});

describe("newsdesk config — Discord notifier fields", () => {
  it("defaults webhook empty, siteUrl to prod, maxPerTick to 10", () => {
    const c = loadConfig({ ...BASE });
    expect(c.discordWebhookUrl).toBe("");
    expect(c.siteUrl).toBe("https://dayzonelife.com");
    expect(c.discordMaxPerTick).toBe(10);
  });

  it("reads the three Discord env vars when set", () => {
    const c = loadConfig({
      ...BASE,
      DISCORD_OBITUARY_WEBHOOK_URL: "https://discord.com/api/webhooks/1/abc",
      SITE_URL: "https://staging.example.com",
      NEWSDESK_DISCORD_MAX_PER_TICK: "5",
    });
    expect(c.discordWebhookUrl).toBe("https://discord.com/api/webhooks/1/abc");
    expect(c.siteUrl).toBe("https://staging.example.com");
    expect(c.discordMaxPerTick).toBe(5);
  });
});
