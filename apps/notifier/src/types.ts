import type { Database } from "@onelife/db";

export type NotificationDraft = {
  userId: string;
  kind: string;
  naturalKey: string;
  title: string;
  body: string;
  href: string;
};

export type GeneratorDeps = {
  db: Database;
  now: Date;
  since: Date;
  lookbackHours: number;
  siteUrl: string;
};

export type Generator = (deps: GeneratorDeps) => Promise<NotificationDraft[]>;

export type Log = {
  info: (obj: unknown, msg?: string) => void;
  warn?: (obj: unknown, msg?: string) => void;
};

/** Lower bound for a generator's query window: the later of the global cutoff and
 *  now-minus-lookback. Bounds per-tick work without ever reaching before go-live. */
export function windowStart(deps: GeneratorDeps): Date {
  const lookback = new Date(deps.now.getTime() - deps.lookbackHours * 3600_000);
  return lookback > deps.since ? lookback : deps.since;
}
