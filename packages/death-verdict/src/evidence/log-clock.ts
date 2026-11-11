/**
 * The log clock: when a line of an `.ADM` file was written, in UTC, worked out from the log
 * alone. A port of the reference pipeline's timing (`build_corpus`).
 *
 * A file carries its start date once, in the header (`AdminLog started on 2031-03-10 at
 * 12:00:00`), and every line after that only a wall-clock `HH:MM:SS`. So the date is rebuilt by
 * walking the file: a step back of more than twelve hours is midnight, and the server's zone
 * turns the wall clock into UTC.
 *
 * ⚠️ This is deliberately NOT `raw_lines.occurred_at`. That column is nullable and was stored
 * skewed for some files (15 minutes early for two, an hour early across a clock change). The
 * classifier compares seconds, so it reads the log's own clock and nothing else.
 *
 * ⚠️ A file must be stamped whole and in order. The date of a line depends on every midnight
 * before it, and the hour repeated when the clocks go back is told apart only by seeing the
 * clock step backwards. Stamp first, select lines afterwards; never the other way round.
 */

export type ZoneRule =
  | { mode: "fixed"; utcOffsetHours: number }   // UTC = wall clock - utcOffsetHours, all year
  | { mode: "zone"; zone: string };             // an IANA zone, daylight saving included

export const DEFAULT_ZONE: ZoneRule = { mode: "zone", zone: "America/Los_Angeles" };

/**
 * The zone each server's log is written in, by server id. Exported once from the reference run.
 * Server 1 ran on a host fixed at UTC-4 and was retired before the clocks changed; every other
 * host keeps Pacific time.
 */
export const SERVER_ZONES: Readonly<Record<number, ZoneRule>> = {
  1: { mode: "fixed", utcOffsetHours: -4 },
  2: DEFAULT_ZONE,
  3: DEFAULT_ZONE,
  6: DEFAULT_ZONE,
  7: DEFAULT_ZONE,
};

/**
 * The zone rule for a server. A server the table does not know falls back to the stored clock
 * offset when the caller has one (`servers.clock_offset_ms`, milliseconds to ADD to the wall
 * clock), and to Pacific time otherwise.
 */
export function zoneForServer(serverId: number, fallbackClockOffsetMs?: number | null): ZoneRule {
  const known = SERVER_ZONES[serverId];
  if (known) return known;
  if (fallbackClockOffsetMs != null) return { mode: "fixed", utcOffsetHours: -fallbackClockOffsetMs / 3_600_000 };
  return DEFAULT_ZONE;
}

export interface LogFile { admFileId: number; name: string; lines: [lineIndex: number, text: string][] }
export interface OrderedFile extends LogFile {
  /** The start of the file as the wall clock read it, in seconds, as if that clock were UTC. */
  bootLocal: number;
}
export interface StampedText { lineIndex: number; text: string; ts: number }

const HEADER_RE = /AdminLog started on (\d{4})-(\d\d)-(\d\d) at (\d\d):(\d\d):(\d\d)/;
const FNAME_RE = /DayZServer_X1_x64_(\d{4})-(\d\d)-(\d\d)_(\d\d)-(\d\d)-(\d\d)\.ADM/;
const TIME_RE = /^(\d\d):(\d\d):(\d\d) \| /;

const wall = (m: RegExpExecArray): number =>
  Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) / 1000;

/** The start time a file name states, as a wall-clock second; null when the name has none. */
export function bootFromName(name: string | null | undefined): number | null {
  const m = FNAME_RE.exec(name ?? "");
  return m ? wall(m) : null;
}

/**
 * Puts a server's files in the order they were written: by the start time in the header (looked
 * for in the first three lines), else by the one in the file name. ⚠️ Not by id: files are
 * registered in the order they were pulled, which is not the order the server wrote them.
 * A file with neither a header nor a dated name cannot be placed and is left out.
 */
export function orderFiles(files: readonly LogFile[]): OrderedFile[] {
  const out: OrderedFile[] = [];
  for (const f of files) {
    const lines = [...f.lines].sort((a, b) => a[0] - b[0]);
    let boot: number | null = null;
    for (const [, text] of lines.slice(0, 3)) {
      const m = HEADER_RE.exec(text);
      if (m) { boot = wall(m); break; }
    }
    boot ??= bootFromName(f.name);
    if (boot == null) continue;
    out.push({ admFileId: f.admFileId, name: f.name, lines, bootLocal: boot });
  }
  return out.sort((a, b) => a.bootLocal - b.bootLocal || a.admFileId - b.admFileId);
}

// ---- zone arithmetic. Intl is the only tz database this package may use (no dependencies).

const formatters = new Map<string, Intl.DateTimeFormat>();
/** Wall clock minus UTC, in seconds, at a UTC instant. */
function offsetAt(zone: string, utc: number): number {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    formatters.set(zone, f);
  }
  const p: Record<string, number> = {};
  for (const part of f.formatToParts(new Date(utc * 1000))) if (part.type !== "literal") p[part.type] = Number(part.value);
  return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!) / 1000 - utc;
}

const QUARTER = 900;
const resolved = new Map<string, { first: number; second: number | null }>();
/**
 * The UTC offsets a wall-clock time can have in a zone: one, or two in the hour that repeats when
 * the clocks go back (`first` is the earlier instant, before the change). A time the clocks skip
 * takes the offset from before the change. Cached per quarter hour: no zone changes inside one.
 */
function offsetsFor(zone: string, local: number): { first: number; second: number | null } {
  const bucket = Math.floor(local / QUARTER);
  const key = `${zone}|${bucket}`;
  let r = resolved.get(key);
  if (r) return r;
  const at = bucket * QUARTER;
  const before = offsetAt(zone, at - 14 * 3600), after = offsetAt(zone, at + 14 * 3600);
  if (before === after) r = { first: before, second: null };
  else {
    const okBefore = offsetAt(zone, at - before) === before, okAfter = offsetAt(zone, at - after) === after;
    if (okBefore && okAfter) r = { first: before, second: after };
    else r = { first: okAfter && !okBefore ? after : before, second: null };
  }
  resolved.set(key, r);
  return r;
}

/** UTC for a wall-clock second. `repeated` picks the second pass through a repeated hour. */
function toUtc(zone: ZoneRule, local: number, repeated: boolean): number {
  if (zone.mode === "fixed") return local - zone.utcOffsetHours * 3600;
  const o = offsetsFor(zone.zone, local);
  return local - (repeated && o.second != null ? o.second : o.first);
}

/**
 * Stamps every line of one file with its UTC second.
 *
 * - **Midnight.** The clock stepping back by more than twelve hours is the next day. The header
 *   time seeds the check, so a file whose first line is already past midnight is dated right.
 * - **The night the clocks go back** (a zone rule only). The hour from 01:00 to 02:00 is written
 *   twice. The first pass is daylight time; a step back of 30 to 90 minutes that lands in that
 *   hour starts the second pass, which lasts until the clock leaves the hour.
 * - **A line with no time** (the header, a banner) takes the time of the line before it — the
 *   last line of the previous file when `previousTs` is given — and the file's start otherwise.
 */
export function stampLines(file: OrderedFile, zone: ZoneRule, previousTs: number | null = null): StampedText[] {
  const out: StampedText[] = [];
  let day = Math.floor(file.bootLocal / 86400) * 86400;
  let prev = file.bootLocal - day;
  let repeated = false;
  let last = previousTs;
  for (const [lineIndex, text] of file.lines) {
    const m = TIME_RE.exec(text);
    if (!m) {
      last ??= toUtc(zone, file.bootLocal, false);
      out.push({ lineIndex, text, ts: last });
      continue;
    }
    const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    const back = prev - sec;
    let local = day + sec;
    if (back > 12 * 3600) {
      day += 86400;
      local = day + sec;
    } else if (zone.mode === "zone" && !repeated && back >= 1800 && back <= 5400 && offsetsFor(zone.zone, local).second != null) {
      repeated = true;
    }
    if (repeated && (zone.mode !== "zone" || offsetsFor(zone.zone, local).second == null)) repeated = false;
    prev = sec;
    last = toUtc(zone, local, repeated);
    out.push({ lineIndex, text, ts: last });
  }
  return out;
}

/** `2031-03-10T16:00:05Z`: the form the verdict stores, to the second. */
export const isoSeconds = (ts: number): string => new Date(ts * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");

/**
 * Stamps ONE line of a file that is not in hand, from the file's name and the line's own clock.
 * For the rare old line a death needs from outside the files loaded for it (a trap set weeks
 * earlier). The date cannot be walked, so it is taken from `approxTs` when the caller has a rough
 * time for the line (to the nearest day is enough), and otherwise assumed to be within a day of
 * the file's start. Null when the name carries no date or the line no time.
 */
export function stampDetached(fileName: string, text: string, zone: ZoneRule, approxTs: number | null = null): number | null {
  const boot = bootFromName(fileName);
  const m = TIME_RE.exec(text);
  if (boot == null || !m) return null;
  const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  const day = Math.floor(boot / 86400) * 86400;
  let local = day + sec + (sec < boot - day ? 86400 : 0);
  if (approxTs != null) local += Math.round((approxTs - toUtc(zone, local, false)) / 86400) * 86400;
  return toUtc(zone, local, false);
}
