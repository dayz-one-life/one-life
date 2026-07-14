import { describe, it, expect } from "vitest";
import { activeLink } from "./active-link";
import type { GamertagLink } from "./types";

const link = (over: Partial<GamertagLink>): GamertagLink => ({
  id: 1, serverId: 0, gamertag: "GT", status: "cancelled", verifiedAt: null, challenge: null, ...over,
});

describe("activeLink", () => {
  it("returns null for undefined or empty input", () => {
    expect(activeLink(undefined)).toBeNull();
    expect(activeLink([])).toBeNull();
  });
  it("returns null when every link is cancelled", () => {
    expect(activeLink([link({ status: "cancelled" }), link({ id: 2, status: "cancelled" })])).toBeNull();
  });
  it("returns the pending link", () => {
    const l = link({ id: 3, status: "pending", gamertag: "Alice" });
    expect(activeLink([link({ status: "cancelled" }), l])).toBe(l);
  });
  it("returns the verified link", () => {
    const l = link({ id: 4, status: "verified", gamertag: "Bob" });
    expect(activeLink([l])).toBe(l);
  });
});
