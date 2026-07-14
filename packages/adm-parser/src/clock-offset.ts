const FIFTEEN_MIN_MS = 900_000;

export function deriveClockOffsetMs(
  files: { localTimestampMs: number; modifiedAtMs: number }[],
): number {
  let best: number | null = null;
  for (const f of files) {
    const candidate = f.modifiedAtMs - f.localTimestampMs;
    if (best === null || candidate < best) best = candidate;
  }
  if (best === null) return 0;
  return Math.round(best / FIFTEEN_MIN_MS) * FIFTEEN_MIN_MS;
}
