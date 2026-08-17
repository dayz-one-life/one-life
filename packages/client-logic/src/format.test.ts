import { describe, it, expect } from "vitest";
import { formatDuration, formatDistance, formatDateTime, boardLabel, BOARDS } from "./format";

describe("formatDuration", () => {
  it("formats seconds into compact units", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(3661)).toBe("1h 1m");
    expect(formatDuration(90061)).toBe("1d 1h 1m");
  });
});

describe("formatDistance", () => {
  it("formats meters, switching to km past 1000", () => {
    expect(formatDistance(50)).toBe("50 m");
    expect(formatDistance(1234.5)).toBe("1.23 km");
    expect(formatDistance(null)).toBe("—");
    expect(formatDistance(undefined)).toBe("—");
  });
});

describe("formatDateTime", () => {
  it("returns a dash for empty and a string otherwise", () => {
    expect(formatDateTime(null)).toBe("—");
    expect(typeof formatDateTime("2026-07-09T12:00:00.000Z")).toBe("string");
    expect(formatDateTime("2026-07-09T12:00:00.000Z")).not.toBe("—");
  });
});

describe("boardLabel + BOARDS", () => {
  it("lists 5 boards and titles them", () => {
    expect(BOARDS).toHaveLength(5);
    expect(BOARDS).toContain("alive-longest");
    expect(boardLabel("alive-longest")).toBe("Alive Longest");
  });
});
