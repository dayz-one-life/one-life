// RPT line timestamps are server-local HH:MM:SS.frac with no date. The base calendar date comes
// from the file header ("Current time:  YYYY/MM/DD HH:MM:SS"); midnight rollover is detected by a
// backward jump; the server-local instant is shifted to UTC by the per-server clock offset.

const HEADER_RE = /Current time:\s+(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/;

/** Base date (as a naive-UTC instant) from the header, or null if absent. */
export function headerDate(content: string): Date | null {
  const m = HEADER_RE.exec(content);
  if (!m) return null;
  return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!));
}

const ROLLOVER_MS = 20 * 3600 * 1000;

/** Converts server-local HH:MM:SS.frac line times to UTC, tracking day rollover across a file. */
export class TimeTracker {
  private y: number;
  private mo: number;
  private d: number;
  private lastMsOfDay: number | null = null;

  constructor(base: Date, private offsetMs: number) {
    this.y = base.getUTCFullYear();
    this.mo = base.getUTCMonth();
    this.d = base.getUTCDate();
  }

  /** frac is the fractional-seconds string (variable width, e.g. "14", "195"). */
  at(h: number, m: number, s: number, frac: string): Date {
    const fracMs = Math.round(Number(`0.${frac}`) * 1000);
    const msOfDay = ((h * 60 + m) * 60 + s) * 1000 + fracMs;
    if (this.lastMsOfDay !== null && this.lastMsOfDay - msOfDay >= ROLLOVER_MS) {
      // clock jumped backwards past midnight → next day
      const next = new Date(Date.UTC(this.y, this.mo, this.d + 1));
      this.y = next.getUTCFullYear();
      this.mo = next.getUTCMonth();
      this.d = next.getUTCDate();
    }
    this.lastMsOfDay = msOfDay;
    const localUtc = Date.UTC(this.y, this.mo, this.d, h, m, s) + fracMs;
    return new Date(localUtc + this.offsetMs);
  }
}
