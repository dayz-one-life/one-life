const HEADER_RE = /AdminLog started on (\d{4})-(\d{2})-(\d{2}) at (\d{2}):(\d{2}):(\d{2})/;
const TIME_RE = /^(\d{2}):(\d{2}):(\d{2})/;
const DAY_MS = 86_400_000;
const ROLLOVER_THRESHOLD_SEC = 43_200; // 12h

/** Per-line epoch-ms (UTC of the log's local clock). Null for header/blank/non-event lines. */
export function assignTimestamps(lines: string[], fallbackDate: Date): (number | null)[] {
  const out: (number | null)[] = new Array(lines.length).fill(null);
  let dayStart: number | null = null; // epoch ms at UTC midnight of the current log date
  let lastSec = -1;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw === "" || raw == null) continue;

    const h = HEADER_RE.exec(raw);
    if (h) {
      dayStart = Date.UTC(+h[1]!, +h[2]! - 1, +h[3]!, 0, 0, 0);
      lastSec = +h[4]! * 3600 + +h[5]! * 60 + +h[6]!;
      continue;
    }

    const t = TIME_RE.exec(raw);
    if (!t) continue;
    const sec = +t[1]! * 3600 + +t[2]! * 60 + +t[3]!;

    if (dayStart === null) {
      dayStart = Date.UTC(
        fallbackDate.getUTCFullYear(), fallbackDate.getUTCMonth(), fallbackDate.getUTCDate(), 0, 0, 0,
      );
    } else if (lastSec - sec > ROLLOVER_THRESHOLD_SEC) {
      dayStart += DAY_MS;
    }
    lastSec = sec;
    out[i] = dayStart + sec * 1000;
  }
  return out;
}
