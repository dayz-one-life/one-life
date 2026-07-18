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

describe("newsdesk config — NEWSDESK_BIRTH_SINCE (forward-only birth cutoff)", () => {
  it("defaults birthSince to null when unset (birth pass off)", () => {
    expect(loadConfig({ ...BASE }).birthSince).toBeNull();
  });
  it("is null for an empty or whitespace value", () => {
    expect(loadConfig({ ...BASE, NEWSDESK_BIRTH_SINCE: "" }).birthSince).toBeNull();
    expect(loadConfig({ ...BASE, NEWSDESK_BIRTH_SINCE: "   " }).birthSince).toBeNull();
  });
  it("parses a valid ISO-8601 timestamp into a Date", () => {
    const c = loadConfig({ ...BASE, NEWSDESK_BIRTH_SINCE: "2026-07-17T00:00:00Z" });
    expect(c.birthSince).toBeInstanceOf(Date);
    expect(c.birthSince?.toISOString()).toBe("2026-07-17T00:00:00.000Z");
  });
  it("is null for an unparseable value (safe: birth pass stays off)", () => {
    expect(loadConfig({ ...BASE, NEWSDESK_BIRTH_SINCE: "not-a-date" }).birthSince).toBeNull();
  });
  it("leaves the dry-run default untouched", () => {
    expect(loadConfig({ ...BASE, NEWSDESK_BIRTH_SINCE: "2026-07-17T00:00:00Z" }).dryRun).toBe(true);
  });
});

describe("newsdesk config — article images (R5c)", () => {
  it("image defaults: workhorse mini, flagship 5.4, quality low, enabled", () => {
    const c = loadConfig({ DATABASE_URL: "x" });
    expect(c.imageModel).toBe("openai/gpt-5-image-mini");
    expect(c.imageFlagshipModel).toBe("openai/gpt-5.4-image-2");
    expect(c.imageQuality).toBe("low");
    expect(c.imagesEnabled).toBe(true);
  });
  it("NEWSDESK_IMAGES_ENABLED=false disables; anything else keeps it on", () => {
    expect(loadConfig({ DATABASE_URL: "x", NEWSDESK_IMAGES_ENABLED: "false" }).imagesEnabled).toBe(false);
    expect(loadConfig({ DATABASE_URL: "x", NEWSDESK_IMAGES_ENABLED: "0" }).imagesEnabled).toBe(true);
  });
});
