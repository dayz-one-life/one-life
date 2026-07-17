import { describe, it, expect } from "vitest";
import { accountStatus, hasPendingLink } from "./account-status";
import type { GamertagLink } from "./types";

const link = (over: Partial<GamertagLink>): GamertagLink => ({
  id: 1, gamertag: "GHOST_ACTOR", status: "pending",
  verifiedAt: null, challenge: null, ...over,
});

describe("accountStatus", () => {
  it("is loading when the loading flag is set", () => {
    expect(accountStatus({ signedIn: false, loading: true, links: undefined })).toEqual({ kind: "loading" });
  });
  it("is signedOut when not signed in", () => {
    expect(accountStatus({ signedIn: false, loading: false, links: undefined })).toEqual({ kind: "signedOut" });
  });
  it("is unlinked when signed in with no active link", () => {
    expect(accountStatus({ signedIn: true, loading: false, links: [] })).toEqual({ kind: "unlinked" });
    const cancelled = [link({ status: "cancelled" })];
    expect(accountStatus({ signedIn: true, loading: false, links: cancelled })).toEqual({ kind: "unlinked" });
  });
  it("is pending when the active link is pending", () => {
    const pend = link({ status: "pending" });
    expect(accountStatus({ signedIn: true, loading: false, links: [pend] })).toEqual({ kind: "pending", link: pend });
  });
  it("is verified when the active link is verified", () => {
    const ver = link({ status: "verified", verifiedAt: "2026-07-14T00:00:00Z" });
    expect(accountStatus({ signedIn: true, loading: false, links: [ver] })).toEqual({ kind: "verified", link: ver });
  });
});

describe("hasPendingLink", () => {
  it("is true only when some link is pending", () => {
    expect(hasPendingLink(undefined)).toBe(false);
    expect(hasPendingLink([link({ status: "verified" })])).toBe(false);
    expect(hasPendingLink([link({ status: "verified" }), link({ status: "pending" })])).toBe(true);
  });
});
