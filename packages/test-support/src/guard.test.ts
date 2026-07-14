import { describe, it, expect } from "vitest";
import { assertTestDatabase } from "./guard.js";

describe("assertTestDatabase", () => {
  it("does not throw for a _test database", () => {
    expect(() =>
      assertTestDatabase("postgres://onelife:onelife@localhost:5432/onelife_test"),
    ).not.toThrow();
  });

  it("throws for the real onelife database", () => {
    expect(() =>
      assertTestDatabase("postgres://onelife:onelife@localhost:5432/onelife"),
    ).toThrow(/Refusing to run tests/);
  });

  it("throws for a production-looking database", () => {
    expect(() =>
      assertTestDatabase("postgres://user:pw@prod.example.com:5432/onelife_production"),
    ).toThrow(/Refusing to run tests/);
  });

  it("is case-insensitive for the _test suffix", () => {
    expect(() =>
      assertTestDatabase("postgres://user:pw@host:5432/myapp_TEST"),
    ).not.toThrow();
  });

  it("throws for an invalid URL", () => {
    expect(() => assertTestDatabase("not-a-valid-url")).toThrow();
  });
});
