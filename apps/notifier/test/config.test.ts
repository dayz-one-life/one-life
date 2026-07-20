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

  // Operator input is not validated by an enum: a blank, mis-cased, or junk value must land on
  // the SAFE side (dry-run ON, push OFF) instead of throwing at module scope and crash-looping.
  it.each([
    [undefined, true],
    ["", true],
    ["true", true],
    ["TRUE", true],
    ["FALSE", true],
    ["false ", true],
    ["banana", true],
    ["false", false],
  ])("resolves NOTIFIER_DRY_RUN=%o to %s without throwing", (raw, expected) => {
    const env = raw === undefined ? { ...base } : { ...base, NOTIFIER_DRY_RUN: raw };
    expect(() => loadConfig(env)).not.toThrow();
    expect(loadConfig(env).dryRun).toBe(expected);
  });

  it.each([
    [undefined, true],
    ["", true],
    ["true", true],
    ["TRUE", true],
    ["FALSE", true],
    ["false ", true],
    ["banana", true],
    ["false", false],
  ])("resolves NOTIFIER_PUSH_ENABLED=%o to %s without throwing", (raw, expected) => {
    const env = raw === undefined ? { ...base } : { ...base, NOTIFIER_PUSH_ENABLED: raw };
    expect(() => loadConfig(env)).not.toThrow();
    expect(loadConfig(env).pushEnabled).toBe(expected);
  });
});
