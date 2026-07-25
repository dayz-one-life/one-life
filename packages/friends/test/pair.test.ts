import { describe, it, expect } from "vitest";
import { orderPair, viewOf } from "../src/pair.js";

const base = {
  id: 1, userA: "aaa", userB: "bbb", status: "pending",
  requestedBy: "aaa", requestSeq: 1,
  createdAt: new Date("2026-07-01T00:00:00Z"), respondedAt: null,
  aSharesPresence: false, bSharesPresence: false,
  aNotifyPresence: true, bNotifyPresence: true,
};
const now = new Date("2026-07-10T00:00:00Z");

describe("orderPair", () => {
  it("normalizes regardless of argument order", () => {
    expect(orderPair("bbb", "aaa")).toEqual({ userA: "aaa", userB: "bbb", viewerIsA: false });
    expect(orderPair("aaa", "bbb")).toEqual({ userA: "aaa", userB: "bbb", viewerIsA: true });
  });
});

describe("viewOf", () => {
  it("reports outgoing to the requester and incoming to the recipient", () => {
    expect(viewOf(base, "aaa", now).status).toBe("outgoing");
    expect(viewOf(base, "bbb", now).status).toBe("incoming");
  });

  it("names the other party as the friend from either side", () => {
    expect(viewOf(base, "aaa", now).friendUserId).toBe("bbb");
    expect(viewOf(base, "bbb", now).friendUserId).toBe("aaa");
  });

  it("maps the directional share flags to the viewer's perspective", () => {
    const row = { ...base, status: "accepted", aSharesPresence: true, bNotifyPresence: true };
    const a = viewOf(row, "aaa", now);
    expect(a.iSharePresence).toBe(true);
    expect(a.theyNotifyPresence).toBe(true);
    const b = viewOf(row, "bbb", now);
    expect(b.theySharePresence).toBe(true);
    expect(b.iNotifyPresence).toBe(true);
  });

  // ⚠️ Sub-project E dropped the location flags entirely. A viewer-relative location field here
  // would mean the standing consent model had come back — sharing is a session-scoped grant now,
  // held in `location_shares`, and a friendship row says nothing about it.
  it("carries NO location fields", () => {
    const v = viewOf({ ...base, status: "accepted" }, "aaa", now) as Record<string, unknown>;
    expect(Object.keys(v).some((k) => /location/i.test(k))).toBe(false);
  });

  it("reports cooldown inside 7 days of a decline and none after", () => {
    const declined = { ...base, status: "declined", respondedAt: new Date("2026-07-08T00:00:00Z") };
    const inside = viewOf(declined, "aaa", now);
    expect(inside.status).toBe("cooldown");
    expect(inside.cooldownUntil).toEqual(new Date("2026-07-15T00:00:00Z"));
    const outside = viewOf(declined, "aaa", new Date("2026-07-16T00:00:00Z"));
    expect(outside.status).toBe("none");
    expect(outside.cooldownUntil).toBeNull();
  });
});
