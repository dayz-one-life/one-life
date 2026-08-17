import { describe, it, expect } from "vitest";
import { compareVersions, isUpdateRequired } from "./app-version";

describe("compareVersions", () => {
  it("orders equal versions as equal", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  it("orders by major, then minor, then patch", () => {
    expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
    expect(compareVersions("1.9.9", "2.0.0")).toBe(-1);
    expect(compareVersions("1.3.0", "1.2.9")).toBe(1);
    expect(compareVersions("1.2.3", "1.2.4")).toBe(-1);
  });

  // The classic string-comparison bug: "1.10.0" < "1.9.0" lexically, but 10 > 9.
  it("compares segments numerically, not lexically", () => {
    expect(compareVersions("1.10.0", "1.9.0")).toBe(1);
    expect(compareVersions("1.0.10", "1.0.9")).toBe(1);
  });

  it("treats missing trailing segments as zero", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("1", "1.0.0")).toBe(0);
    expect(compareVersions("1.2.1", "1.2")).toBe(1);
  });

  it("ignores a build suffix after the patch number", () => {
    // Expo's `version` is plain, but hand-set values pick up build metadata.
    expect(compareVersions("1.2.3+45", "1.2.3")).toBe(0);
    expect(compareVersions("1.2.3-beta.1", "1.2.3")).toBe(0);
  });
});

describe("isUpdateRequired", () => {
  it("requires an update when the app is below the floor", () => {
    expect(isUpdateRequired("1.1.0", "1.2.0")).toBe(true);
  });

  it("does not require an update at or above the floor", () => {
    expect(isUpdateRequired("1.2.0", "1.2.0")).toBe(false);
    expect(isUpdateRequired("1.3.0", "1.2.0")).toBe(false);
  });

  // ⚠️ The load-bearing safety property. A misconfigured or missing floor must lock NOBODY out:
  // the failure mode of getting this backwards is every user of a shipped app staring at an
  // update wall for a release that does not exist, fixable only by a deploy.
  it("fails OPEN when the minimum is unparseable, empty or absent", () => {
    expect(isUpdateRequired("1.0.0", "")).toBe(false);
    expect(isUpdateRequired("1.0.0", "not-a-version")).toBe(false);
    expect(isUpdateRequired("1.0.0", undefined)).toBe(false);
    expect(isUpdateRequired("1.0.0", "0.0.0")).toBe(false);
  });

  it("fails OPEN when the app's own version is unparseable", () => {
    expect(isUpdateRequired("", "1.2.0")).toBe(false);
    expect(isUpdateRequired("garbage", "1.2.0")).toBe(false);
  });
});
