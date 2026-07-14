import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("parses defaults", () => {
    const c = loadConfig({ DATABASE_URL: "postgres://x" });
    expect(c).toEqual({ databaseUrl: "postgres://x", intervalSeconds: 30, batchSize: 500, logLevel: "info" });
  });
  it("coerces overrides", () => {
    const c = loadConfig({ DATABASE_URL: "postgres://x", VERIFIER_INTERVAL_SECONDS: "5", VERIFIER_BATCH_SIZE: "10" });
    expect(c.intervalSeconds).toBe(5);
    expect(c.batchSize).toBe(10);
  });
  it("throws without DATABASE_URL", () => {
    expect(() => loadConfig({})).toThrow();
  });
});
