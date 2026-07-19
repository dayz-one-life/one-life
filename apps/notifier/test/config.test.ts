import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

const base = { DATABASE_URL: "postgres://x/y", SITE_URL: "https://dayzonelife.com" };

describe("loadConfig", () => {
  it("defaults dry run on and push enabled", () => {
    const c = loadConfig(base);
    expect(c.dryRun).toBe(true);
    expect(c.pushEnabled).toBe(true);
    expect(c.intervalSeconds).toBe(60);
    expect(c.lookbackHours).toBe(48);
    expect(c.pushMaxPerTick).toBe(50);
    expect(c.pushMaxAgeMinutes).toBe(60);
  });

  it("leaves since null when unset, empty, or unparseable", () => {
    expect(loadConfig(base).since).toBeNull();
    expect(loadConfig({ ...base, NOTIFIER_SINCE: "" }).since).toBeNull();
    expect(loadConfig({ ...base, NOTIFIER_SINCE: "not-a-date" }).since).toBeNull();
  });

  it("parses a valid ISO since", () => {
    const c = loadConfig({ ...base, NOTIFIER_SINCE: "2026-07-19T00:00:00Z" });
    expect(c.since?.toISOString()).toBe("2026-07-19T00:00:00.000Z");
  });

  it("reads NOTIFIER_DRY_RUN=false as live", () => {
    expect(loadConfig({ ...base, NOTIFIER_DRY_RUN: "false" }).dryRun).toBe(false);
  });
});
