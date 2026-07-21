/**
 * A settled feed fetch that distinguishes "resolved" (even to a genuinely empty feed) from
 * "the request itself failed." The old pattern (`fetch(...).catch(() => null)` then `?? []`)
 * collapsed both into the identical `[]` shape, so an API outage rendered as indistinguishable
 * from "the desk hasn't published yet" — see live-data-honesty spec §5.
 */
export type SettledFeed<T> = { data: T | null; failed: boolean };

export async function settleFeed<T>(p: Promise<T>): Promise<SettledFeed<T>> {
  try {
    return { data: await p, failed: false };
  } catch {
    return { data: null, failed: true };
  }
}
