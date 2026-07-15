import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

const BASE = { DATABASE_URL: "postgres://x/y", NITRADO_TOKEN: "tok" };

describe("rebooter config", () => {
  it("parses database url, nitrado token, and default log level", () => {
    const c = loadConfig({ ...BASE });
    expect(c.databaseUrl).toBe("postgres://x/y");
    expect(c.nitradoToken).toBe("tok");
    expect(c.logLevel).toBe("info");
  });

  it("throws when DATABASE_URL is missing", () => {
    expect(() => loadConfig({ NITRADO_TOKEN: "tok" })).toThrow();
  });

  it("throws when NITRADO_TOKEN is missing", () => {
    expect(() => loadConfig({ DATABASE_URL: "postgres://x/y" })).toThrow();
  });
});
