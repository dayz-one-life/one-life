import { describe, it, expect } from "vitest";
import { orderPair, viewOf } from "../src/pair.js";

const base = {
  id: 1, userA: "aaa", userB: "bbb", status: "pending",
  requestedBy: "aaa", requestSeq: 1,
  createdAt: new Date("2026-07-01T00:00:00Z"), respondedAt: null,
  aSharesLocation: false, bSharesLocation: false,
  aSharesPresence: false, bSharesPresence: false,
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
    const row = { ...base, status: "accepted", aSharesLocation: true, bSharesPresence: true };
    const a = viewOf(row, "aaa", now);
    expect(a.iShareLocation).toBe(true);
    expect(a.theySharePresence).toBe(true);
    const b = viewOf(row, "bbb", now);
    expect(b.theyShareLocation).toBe(true);
    expect(b.iSharePresence).toBe(true);
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
