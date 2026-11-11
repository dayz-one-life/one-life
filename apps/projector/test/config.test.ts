import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

describe("projector config", () => {
  it("parses env with defaults", () => {
    const c = loadConfig({ DATABASE_URL: "postgres://x" });
    expect(c).toMatchObject({ databaseUrl: "postgres://x", intervalSeconds: 30, batchSize: 500 });
  });
  it("leaves trap kills unwritten unless TRAP_KILLS_WRITE is exactly true", () => {
    expect(loadConfig({ DATABASE_URL: "postgres://x" }).trapKillsWrite).toBe(false);
    expect(loadConfig({ DATABASE_URL: "postgres://x", TRAP_KILLS_WRITE: "1" }).trapKillsWrite).toBe(false);
    expect(loadConfig({ DATABASE_URL: "postgres://x", TRAP_KILLS_WRITE: "TRUE" }).trapKillsWrite).toBe(false);
    expect(loadConfig({ DATABASE_URL: "postgres://x", TRAP_KILLS_WRITE: "true" }).trapKillsWrite).toBe(true);
  });
  it("throws when DATABASE_URL missing", () => {
    expect(() => loadConfig({})).toThrow();
  });
});
