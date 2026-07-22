import { describe, it, expect } from "vitest";
import { shouldNotifyPresence, FRIEND_ONLINE_COOLDOWN_HOURS, FRIEND_ONLINE_MAX_AGE_MINUTES } from "../src/presence.js";

const base = { status: "accepted", masterShare: true, pairShare: true, pairNotify: true };

describe("shouldNotifyPresence", () => {
  it("notifies when the pair is accepted and all three flags are on", () => {
    expect(shouldNotifyPresence(base)).toBe(true);
  });

  // Exhaustive over the three booleans: the four-way AND must not drift.
  const flags = ["masterShare", "pairShare", "pairNotify"] as const;
  for (const off of flags) {
    it(`does not notify when ${off} is off`, () => {
      expect(shouldNotifyPresence({ ...base, [off]: false })).toBe(false);
    });
  }

  it("does not notify for a non-accepted pair", () => {
    for (const status of ["pending", "declined"]) {
      expect(shouldNotifyPresence({ ...base, status })).toBe(false);
    }
  });

  it("pins the tuning constants", () => {
    expect(FRIEND_ONLINE_COOLDOWN_HOURS).toBe(4);
    expect(FRIEND_ONLINE_MAX_AGE_MINUTES).toBe(15);
  });
});
