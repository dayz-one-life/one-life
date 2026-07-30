import { describe, it, expect } from "vitest";
import { locationSharedNotification } from "../src/notify.js";

const base = {
  granteeUserId: "u1", granterGamertag: "Boots",
  mapSlug: "sakhal", mapName: "Sakhal",
};
const S1 = new Date("2026-07-25T10:00:00Z");
const S2 = new Date("2026-07-25T14:00:00Z");

describe("locationSharedNotification natural key", () => {
  // ⚠️ Keyed on the SESSION SNAPSHOT, so re-granting inside one session is swallowed by
  // onConflictDoNothing while a grant in the NEXT session notifies again. A key without the
  // session would tell the recipient once and then never again; a key using `now` would spam
  // them on every click.
  it("is stable within one session", () => {
    expect(locationSharedNotification({ ...base, sessionConnectedAt: S1 }).naturalKey)
      .toBe(locationSharedNotification({ ...base, sessionConnectedAt: S1 }).naturalKey);
  });

  it("differs across sessions", () => {
    expect(locationSharedNotification({ ...base, sessionConnectedAt: S1 }).naturalKey)
      .not.toBe(locationSharedNotification({ ...base, sessionConnectedAt: S2 }).naturalKey);
  });

  it("differs per grantee and per granter", () => {
    const a = locationSharedNotification({ ...base, sessionConnectedAt: S1 }).naturalKey;
    expect(locationSharedNotification({ ...base, granteeUserId: "u2", sessionConnectedAt: S1 }).naturalKey).not.toBe(a);
    expect(locationSharedNotification({ ...base, granterGamertag: "Other", sessionConnectedAt: S1 }).naturalKey).not.toBe(a);
  });

  it("carries no session id — ids are reassigned by a projection rebuild", () => {
    const k = locationSharedNotification({ ...base, sessionConnectedAt: S1 }).naturalKey;
    expect(k).toBe("location_shared:u1:Boots:2026-07-25T10:00:00.000Z");
  });

  // The body states the SCOPE, because the scope is the point: it is not a standing permission.
  it("tells the recipient the share is session-bound", () => {
    const n = locationSharedNotification({ ...base, sessionConnectedAt: S1 });
    expect(n.body).toMatch(/until they log out/i);
    expect(n.kind).toBe("location_shared");
    expect(n.href).toBe("/maps/sakhal");
  });
});
