import { describe, it, expect } from "vitest";
import { ApiError } from "./api";
import { claimErrorMessage } from "./claim-error";

describe("claimErrorMessage", () => {
  it("maps active_link_exists to the one-gamertag message", () => {
    expect(claimErrorMessage(new ApiError(409, "active_link_exists"))).toMatch(/only claim one|already have/i);
  });
  it("maps 422 to a not-seen message", () => {
    expect(claimErrorMessage(new ApiError(422, "gamertag_not_seen"))).toMatch(/haven't seen/i);
  });
  it("maps a plain 409 to already-claimed", () => {
    expect(claimErrorMessage(new ApiError(409, "already_verified"))).toMatch(/already claimed/i);
  });
  it("falls back for unknown errors", () => {
    expect(claimErrorMessage(new Error("boom"))).toMatch(/something went wrong/i);
  });
});
