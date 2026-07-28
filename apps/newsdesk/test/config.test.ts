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
  it("defaults intervalSeconds, temperature and logLevel", () => {
    const c = loadConfig({ ...BASE });
    expect(c.intervalSeconds).toBe(300);
    expect(c.temperature).toBe(0.7);
    expect(c.logLevel).toBe("info");
  });
  it("honors overridden intervalSeconds, temperature and logLevel", () => {
    const c = loadConfig({
      ...BASE,
      NEWSDESK_INTERVAL_SECONDS: "60",
      NEWSDESK_TEMPERATURE: "0.3",
      LOG_LEVEL: "debug",
    });
    expect(c.intervalSeconds).toBe(60);
    expect(c.temperature).toBe(0.3);
    expect(c.logLevel).toBe("debug");
  });
});

describe("newsdesk config — NEWSDESK_SINCE (forward-only obituary cutoff)", () => {
  it("parses NEWSDESK_SINCE; unset/blank/garbage ⇒ null (pass off)", () => {
    const base = { DATABASE_URL: "postgres://x" };
    expect(loadConfig({ ...base, NEWSDESK_SINCE: "2026-07-28T00:00:00Z" }).since)
      .toEqual(new Date("2026-07-28T00:00:00Z"));
    expect(loadConfig(base).since).toBeNull();
    expect(loadConfig({ ...base, NEWSDESK_SINCE: "" }).since).toBeNull();
    expect(loadConfig({ ...base, NEWSDESK_SINCE: "not-a-date" }).since).toBeNull();
  });
  it("is null for a whitespace-only value", () => {
    expect(loadConfig({ ...BASE, NEWSDESK_SINCE: "   " }).since).toBeNull();
  });
  it("leaves the dry-run default untouched", () => {
    expect(loadConfig({ ...BASE, NEWSDESK_SINCE: "2026-07-17T00:00:00Z" }).dryRun).toBe(true);
  });
});
