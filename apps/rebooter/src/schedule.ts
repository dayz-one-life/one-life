/** 2 hours in ms — the reboot interval. */
export const INTERVAL_MS = 2 * 60 * 60 * 1000;

/**
 * Ms from `nowMs` until the next even UTC hour at :00:00.
 * The Unix epoch (1970-01-01T00:00:00Z) is itself an even-hour boundary, so every
 * multiple of INTERVAL_MS from the epoch lands on 00,02,…,22 UTC — hence the modulo.
 * On an exact boundary this returns INTERVAL_MS (the next one), never 0.
 */
export function msUntilNextBoundary(nowMs: number): number {
  return INTERVAL_MS - (nowMs % INTERVAL_MS);
}
