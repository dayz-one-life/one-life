import { describe, it, expect } from "vitest";
import { formatExpiry } from "./format-expiry";

const NOW = 1_700_000_000_000;
const iso = (ms: number) => new Date(NOW + ms).toISOString();

describe("formatExpiry", () => {
  it("shows whole hours when an hour or more remains", () => {
    expect(formatExpiry(iso(6 * 3_600_000), NOW)).toBe("expires in 6h");
    expect(formatExpiry(iso(60 * 60_000), NOW)).toBe("expires in 1h");
  });
  it("shows minutes under an hour", () => {
    expect(formatExpiry(iso(30 * 60_000), NOW)).toBe("expires in 30m");
  });
  it("shows expired at or past the deadline", () => {
    expect(formatExpiry(iso(0), NOW)).toBe("expired");
    expect(formatExpiry(iso(-5 * 60_000), NOW)).toBe("expired");
  });
});
