import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("parses a valid env without a per-server service id (servers come from the DB)", () => {
    const cfg = loadConfig({
      DATABASE_URL: "postgres://x", NITRADO_TOKEN: "t",
      INGEST_INTERVAL_SECONDS: "60", ADM_BACKFILL_BUDGET: "15", LOG_LEVEL: "info",
    });
    expect(cfg.nitradoToken).toBe("t");
    expect(cfg.intervalSeconds).toBe(60);
    expect(cfg.backfillBudget).toBe(15);
    expect("nitradoServiceId" in cfg).toBe(false); // no longer an env-pinned single server
  });
  it("throws on missing DATABASE_URL", () => {
    expect(() => loadConfig({ NITRADO_TOKEN: "t" })).toThrow();
  });
  it("throws on missing NITRADO_TOKEN", () => {
    expect(() => loadConfig({ DATABASE_URL: "postgres://x" })).toThrow();
  });
  it("applies defaults for interval and budget", () => {
    const cfg = loadConfig({ DATABASE_URL: "postgres://x", NITRADO_TOKEN: "t" });
    expect(cfg.intervalSeconds).toBe(60);
    expect(cfg.backfillBudget).toBe(15);
  });
});
