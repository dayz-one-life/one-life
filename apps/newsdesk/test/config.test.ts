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
