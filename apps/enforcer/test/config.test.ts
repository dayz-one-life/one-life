import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

const BASE = { DATABASE_URL: "postgres://x/y" };

describe("enforcer config — dry-run safety default", () => {
  it("defaults dryRun to TRUE when ENFORCER_DRY_RUN is unset", () => {
    expect(loadConfig({ ...BASE }).dryRun).toBe(true);
  });

  it("stays dry-run for any value that is not exactly 'false'", () => {
    expect(loadConfig({ ...BASE, ENFORCER_DRY_RUN: "" }).dryRun).toBe(true);
    expect(loadConfig({ ...BASE, ENFORCER_DRY_RUN: "0" }).dryRun).toBe(true);
    expect(loadConfig({ ...BASE, ENFORCER_DRY_RUN: "true" }).dryRun).toBe(true);
    expect(loadConfig({ ...BASE, ENFORCER_DRY_RUN: "yes" }).dryRun).toBe(true);
  });

  it("enforces for real ONLY when ENFORCER_DRY_RUN is exactly 'false'", () => {
    expect(loadConfig({ ...BASE, ENFORCER_DRY_RUN: "false" }).dryRun).toBe(false);
  });

  it("defaults ban duration to 24h and interval to 300s", () => {
    const c = loadConfig({ ...BASE });
    expect(c.banDurationHours).toBe(24);
    expect(c.intervalSeconds).toBe(300);
  });
});
