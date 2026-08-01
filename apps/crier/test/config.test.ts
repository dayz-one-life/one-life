import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

const base = { DATABASE_URL: "postgres://x/y" };

describe("crier config", () => {
  it("defaults to dry-run for anything except the literal string false", () => {
    expect(loadConfig({ ...base }).dryRun).toBe(true);
    expect(loadConfig({ ...base, CRIER_DRY_RUN: "0" }).dryRun).toBe(true);
    expect(loadConfig({ ...base, CRIER_DRY_RUN: "FALSE" }).dryRun).toBe(true);
    expect(loadConfig({ ...base, CRIER_DRY_RUN: "false" }).dryRun).toBe(false);
  });

  it("treats unset or unparseable CRIER_SINCE as OFF (null), never an epoch", () => {
    expect(loadConfig({ ...base }).since).toBeNull();
    expect(loadConfig({ ...base, CRIER_SINCE: "not a date" }).since).toBeNull();
    expect(loadConfig({ ...base, CRIER_SINCE: "2026-07-31T00:00:00Z" }).since).toEqual(new Date("2026-07-31T00:00:00Z"));
  });

  it("enables a channel only when its full credential set is present", () => {
    const none = loadConfig({ ...base });
    expect(none.discordWebhookUrl).toBeNull();
    expect(none.fbPageId).toBeNull();
    const half = loadConfig({ ...base, CRIER_FB_PAGE_ID: "123" });
    expect(half.fbPageId).toBeNull(); // page id without token is NOT an enabled channel
    const full = loadConfig({
      ...base,
      CRIER_DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/1/x",
      CRIER_FB_PAGE_ID: "123", CRIER_FB_PAGE_ACCESS_TOKEN: "tok",
    });
    expect(full.discordWebhookUrl).toBe("https://discord.com/api/webhooks/1/x");
    expect(full.fbPageId).toBe("123");
    expect(full.fbPageAccessToken).toBe("tok");
  });

  it("applies defaults: 60s interval, batch cap 10, max attempts 5, prod site URL", () => {
    const c = loadConfig({ ...base });
    expect(c.intervalSeconds).toBe(60);
    expect(c.batchCap).toBe(10);
    expect(c.maxAttempts).toBe(5);
    expect(c.siteUrl).toBe("https://dayzonelife.com");
  });

  it("enables x only when all four credentials are present", () => {
    const all = {
      CRIER_X_API_KEY: "ck", CRIER_X_API_SECRET: "cs",
      CRIER_X_ACCESS_TOKEN: "at", CRIER_X_ACCESS_SECRET: "as",
    };
    expect(loadConfig({ ...base }).x).toBeNull();
    expect(loadConfig({ ...base, ...all }).x).toEqual({
      apiKey: "ck", apiSecret: "cs", accessToken: "at", accessSecret: "as",
    });
    // Every single omission must leave the channel off — half a credential set never half-posts.
    for (const k of Object.keys(all)) {
      const partial = { ...all, [k]: undefined };
      expect(loadConfig({ ...base, ...partial }).x, `missing ${k}`).toBeNull();
    }
  });
});
