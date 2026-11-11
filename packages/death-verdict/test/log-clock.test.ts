import { describe, it, expect } from "vitest";
import { isoSeconds, orderFiles, stampDetached, stampLines, zoneForServer, type ZoneRule } from "../src/index.js";
import { logFile, VICTIM, who } from "./lines.js";

const V = who(VICTIM);
const LA: ZoneRule = { mode: "zone", zone: "America/Los_Angeles" };
const EAST: ZoneRule = { mode: "fixed", utcOffsetHours: -4 };
const times = (file: ReturnType<typeof logFile>, zone: ZoneRule) => stampLines(orderFiles([file])[0]!, zone).map((l) => isoSeconds(l.ts));

describe("the log clock", () => {
  it("dates a line from the header date and the line's own clock", () => {
    const f = logFile(1, "2031-03-10", "12:00:00", [["12:00:05", V], ["13:30:00", V]]);
    expect(times(f, EAST).slice(2)).toEqual(["2031-03-10T16:00:05Z", "2031-03-10T17:30:00Z"]);
  });

  it("rolls the date at midnight", () => {
    const f = logFile(1, "2031-03-10", "23:50:00", [["23:59:58", V], ["00:00:03", V], ["00:10:00", V]]);
    expect(times(f, EAST).slice(2)).toEqual(["2031-03-11T03:59:58Z", "2031-03-11T04:00:03Z", "2031-03-11T04:10:00Z"]);
  });

  it("rolls the date when the first line is already past midnight", () => {
    const f = logFile(1, "2031-03-10", "23:59:59", [["00:00:01", V]]);
    expect(times(f, EAST)[2]).toBe("2031-03-11T04:00:01Z");
  });

  it("a small step back is not midnight", () => {
    const f = logFile(1, "2031-03-10", "12:00:00", [["12:00:10", V], ["12:00:08", V]]);
    expect(times(f, EAST).slice(2)).toEqual(["2031-03-10T16:00:10Z", "2031-03-10T16:00:08Z"]);
  });

  it("a line with no time takes the time of the line before it", () => {
    const f = logFile(1, "2031-03-10", "12:00:00", [["12:00:10", V]]);
    f.lines.push([3, "a banner with no clock"]);
    const t = times(f, EAST);
    expect(t[3]).toBe(t[2]);
    // and before any timed line, the file's start
    expect(t[0]).toBe("2031-03-10T16:00:00Z");
  });

  it("follows daylight saving in a named zone", () => {
    const summer = logFile(1, "2031-07-01", "12:00:00", [["12:00:00", V]]);
    const winter = logFile(2, "2031-12-01", "12:00:00", [["12:00:00", V]]);
    expect(times(summer, LA)[2]).toBe("2031-07-01T19:00:00Z");
    expect(times(winter, LA)[2]).toBe("2031-12-01T20:00:00Z");
  });

  it("steps one hour on the DST night", () => {
    // 2031-11-02: Pacific clocks go back at 02:00 to 01:00. The hour 01:00-02:00 is written twice.
    const f = logFile(1, "2031-11-02", "00:30:00", [
      ["00:59:00", V], ["01:10:00", V], ["01:50:00", V],     // first pass: daylight time, UTC-7
      ["01:05:00", V], ["01:55:00", V],                       // the clock stepped back: second pass, UTC-8
      ["02:10:00", V],
    ]);
    expect(times(f, LA).slice(2)).toEqual([
      "2031-11-02T07:59:00Z", "2031-11-02T08:10:00Z", "2031-11-02T08:50:00Z",
      "2031-11-02T09:05:00Z", "2031-11-02T09:55:00Z",
      "2031-11-02T10:10:00Z",
    ]);
  });

  it("a file that starts after the clocks went back is in winter time throughout", () => {
    const f = logFile(1, "2031-11-02", "02:30:00", [["02:31:00", V], ["09:00:00", V]]);
    expect(times(f, LA).slice(2)).toEqual(["2031-11-02T10:31:00Z", "2031-11-02T17:00:00Z"]);
  });

  it("a fixed-offset server ignores daylight saving", () => {
    const f = logFile(1, "2031-11-02", "00:30:00", [["01:50:00", V], ["01:05:00", V]]);
    expect(times(f, EAST).slice(2)).toEqual(["2031-11-02T05:50:00Z", "2031-11-02T05:05:00Z"]);
  });

  it("orders files by boot time, not by id", () => {
    const late = logFile(1, "2031-03-10", "18:00:00", [["18:00:01", V]]);
    const early = logFile(2, "2031-03-10", "06:00:00", [["06:00:01", V]]);
    const noHeader = { admFileId: 3, name: "DayZServer_X1_x64_2031-03-10_12-00-00.ADM", lines: [[0, `12:00:01 | ${V}`]] as [number, string][] };
    const unplaceable = { admFileId: 4, name: "notes.txt", lines: [[0, `12:00:01 | ${V}`]] as [number, string][] };
    expect(orderFiles([late, early, noHeader, unplaceable]).map((f) => f.admFileId)).toEqual([2, 3, 1]);
  });

  it("sorts a file's lines by line index before stamping", () => {
    const f = logFile(1, "2031-03-10", "23:50:00", [["23:59:58", V], ["00:00:03", V]]);
    f.lines.reverse();
    expect(times(f, EAST).slice(2)).toEqual(["2031-03-11T03:59:58Z", "2031-03-11T04:00:03Z"]);
  });

  it("knows the zone of each server, and falls back to the stored offset, then to Pacific time", () => {
    expect(zoneForServer(1)).toEqual({ mode: "fixed", utcOffsetHours: -4 });
    expect(zoneForServer(2)).toEqual(LA);
    expect(zoneForServer(99, 3 * 3_600_000)).toEqual({ mode: "fixed", utcOffsetHours: -3 });
    expect(zoneForServer(99)).toEqual(LA);
  });

  it("stamps one line of a file that is not in hand, from the file's name", () => {
    const name = "DayZServer_X1_x64_2031-03-10_22-00-00.ADM";
    expect(isoSeconds(stampDetached(name, `23:00:00 | ${V}`, EAST)!)).toBe("2031-03-11T03:00:00Z");
    // past midnight: the next day
    expect(isoSeconds(stampDetached(name, `01:00:00 | ${V}`, EAST)!)).toBe("2031-03-11T05:00:00Z");
    // a rough time for the line settles the day when the file ran for longer
    const rough = Date.UTC(2031, 2, 12, 6, 0, 0) / 1000;
    expect(isoSeconds(stampDetached(name, `01:00:00 | ${V}`, EAST, rough)!)).toBe("2031-03-12T05:00:00Z");
    expect(stampDetached("notes.txt", `01:00:00 | ${V}`, EAST)).toBeNull();
    expect(stampDetached(name, "no clock here", EAST)).toBeNull();
  });
});
