import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

describe("projector config", () => {
  it("parses env with defaults", () => {
    const c = loadConfig({ DATABASE_URL: "postgres://x" });
    expect(c).toMatchObject({ databaseUrl: "postgres://x", intervalSeconds: 30, batchSize: 500 });
  });
  it("throws when DATABASE_URL missing", () => {
    expect(() => loadConfig({})).toThrow();
  });
});
