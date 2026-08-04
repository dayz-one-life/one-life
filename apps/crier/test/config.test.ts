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

  // Reddit needs FOUR credentials, so there are four ways to be half-configured. Same rule as
  // Facebook: a partial set leaves the channel off rather than half-enabling it.
  const redditEnv = {
    CRIER_REDDIT_CLIENT_ID: "cid",
    CRIER_REDDIT_CLIENT_SECRET: "csec",
    CRIER_REDDIT_REFRESH_TOKEN: "rtok",
    CRIER_REDDIT_SUBREDDIT: "dayzonelife",
  };

  it.each(Object.keys(redditEnv))("leaves reddit off when %s is missing", (missing) => {
    const partial = { ...redditEnv } as Record<string, string>;
    delete partial[missing];
    expect(loadConfig({ ...base, ...partial }).reddit).toBeNull();
  });

  it("enables reddit only with the full credential set", () => {
    expect(loadConfig({ ...base }).reddit).toBeNull();
    const c = loadConfig({ ...base, ...redditEnv });
    expect(c.reddit).toMatchObject({
      clientId: "cid", clientSecret: "csec", refreshToken: "rtok", subreddit: "dayzonelife",
    });
  });

  it("defaults the reddit user agent and flair, and takes overrides", () => {
    const d = loadConfig({ ...base, ...redditEnv }).reddit!;
    expect(d.userAgent).toMatch(/onelife/i);
    expect(d.flairId).toBeNull();
    const o = loadConfig({
      ...base, ...redditEnv,
      CRIER_REDDIT_USER_AGENT: "custom/2.0", CRIER_REDDIT_FLAIR_ID: "f-1",
    }).reddit!;
    expect(o.userAgent).toBe("custom/2.0");
    expect(o.flairId).toBe("f-1");
  });

  // 10 minutes. Reddit's spam heuristics dislike a burst of same-domain links far more than
  // Discord or Facebook do, so this channel paces itself independently of the 2s inter-post gap.
  it("defaults the reddit rate cap to 600s and accepts an override", () => {
    expect(loadConfig({ ...base, ...redditEnv }).redditMinIntervalSeconds).toBe(600);
    expect(
      loadConfig({ ...base, ...redditEnv, CRIER_REDDIT_MIN_INTERVAL_SECONDS: "120" }).redditMinIntervalSeconds,
    ).toBe(120);
  });

  it("applies defaults: 60s interval, batch cap 10, max attempts 5, prod site URL", () => {
    const c = loadConfig({ ...base });
    expect(c.intervalSeconds).toBe(60);
    expect(c.batchCap).toBe(10);
    expect(c.maxAttempts).toBe(5);
    expect(c.siteUrl).toBe("https://dayzonelife.com");
  });
});
