import { describe, it, expect } from "vitest";
import { toBackendPath } from "../src/path.js";

describe("toBackendPath", () => {
  it("strips the /api prefix from read/me/gamertag routes", () => {
    expect(toBackendPath("/api/servers")).toBe("/servers");
    expect(toBackendPath("/api/me")).toBe("/me");
  });

  it("leaves the auth prefix untouched", () => {
    expect(toBackendPath("/api/auth")).toBe("/api/auth");
    expect(toBackendPath("/api/auth/providers")).toBe("/api/auth/providers");
  });

  it("leaves a non-/api path untouched", () => {
    expect(toBackendPath("/media/x.png")).toBe("/media/x.png");
  });
});
