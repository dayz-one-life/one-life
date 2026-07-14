import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("parses a valid env", () => {
    const cfg = loadConfig({
      DATABASE_URL: "postgres://x", NITRADO_TOKEN: "t", NITRADO_SERVICE_ID: "18196786",
      INGEST_INTERVAL_SECONDS: "60", ADM_BACKFILL_BUDGET: "15", LOG_LEVEL: "info",
    });
    expect(cfg.nitradoServiceId).toBe(18196786);
    expect(cfg.intervalSeconds).toBe(60);
    expect(cfg.backfillBudget).toBe(15);
  });
  it("throws on missing DATABASE_URL", () => {
    expect(() => loadConfig({ NITRADO_TOKEN: "t", NITRADO_SERVICE_ID: "1" })).toThrow();
  });
  it("applies defaults for interval and budget", () => {
    const cfg = loadConfig({ DATABASE_URL: "postgres://x", NITRADO_TOKEN: "t", NITRADO_SERVICE_ID: "1" });
    expect(cfg.intervalSeconds).toBe(60);
    expect(cfg.backfillBudget).toBe(15);
  });
});
