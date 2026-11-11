import { parseEvidenceLine, type LogFile, type StampedLine } from "../src/index.js";

/**
 * Invented log lines for the public tests. ⚠️ Nothing here is from a real server: the names are
 * made up, the ids are one digit repeated, the positions are round numbers. Keep it that way —
 * this repository is public and real lines identify real players.
 */
export const ID = (digit: string): string => digit.repeat(40);
export const VICTIM = { name: "Victim One", id: ID("1") };
export const OTHER = { name: "Other Two", id: ID("2") };
export const THIRD = { name: "Third Three", id: ID("3") };

export type Who = { name: string; id: string };
export const at = (x: number, z: number, alt = 10): string => `<${x.toFixed(1)}, ${z.toFixed(1)}, ${alt.toFixed(1)}>`;
/** `Player "name" (id=... pos=<...>)`, or the `(DEAD)` form. */
export const who = (p: Who, pos = at(1000, 2000), dead = false): string => `Player "${p.name}" ${dead ? "(DEAD) " : ""}(id=${p.id} pos=${pos})`;
export const clock = (secOfDay: number): string => {
  const s = ((secOfDay % 86400) + 86400) % 86400;
  const two = (n: number) => String(Math.floor(n)).padStart(2, "0");
  return `${two(s / 3600)}:${two((s % 3600) / 60)}:${two(s % 60)}`;
};

/** Noon on an invented day, UTC, as the base of hand-stamped lines. */
export const T0 = Date.UTC(2031, 2, 10, 12, 0, 0) / 1000;

/**
 * Hand-stamped lines: each entry is seconds from `T0` and the text after `HH:MM:SS | `. All in
 * file 7, line index = position, so a line can be named by its index.
 */
export function stamped(entries: [dt: number, rest: string][], admFileId = 7): StampedLine[] {
  return entries.map(([dt, rest], i) => ({ ...parseEvidenceLine(admFileId, i, `${clock(12 * 3600 + dt)} | ${rest}`), seq: i, ts: T0 + dt }));
}
export const ref = (lineIndex: number, admFileId = 7) => ({ admFileId, lineIndex });

/** A log file as the server writes it: a banner, the dated header, then the lines. */
export function logFile(admFileId: number, date: string, startClock: string, lines: [clock: string, rest: string][]): LogFile {
  const name = `DayZServer_X1_x64_${date}_${startClock.replace(/:/g, "-")}.ADM`;
  const all = ["******************************************", `AdminLog started on ${date} at ${startClock}`, ...lines.map(([c, rest]) => `${c} | ${rest}`)];
  return { admFileId, name, lines: all.map((text, i) => [i, text]) };
}
