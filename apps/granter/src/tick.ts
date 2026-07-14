import type { Database } from "@onelife/db";
import { grantVerification, grantMonthly, grantReferral } from "@onelife/tokens";

/** Calendar month key (UTC) used for the monthly/referral idempotency keys. */
export function ym(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export type GranterResult = { verification: number; monthly: number; referral: number };

/** One grant cycle — all sweeps are idempotent, so running every tick is safe. */
export async function granterTick(db: Database, opts: { now: Date }): Promise<GranterResult> {
  const month = ym(opts.now);
  return {
    verification: await grantVerification(db),
    monthly: await grantMonthly(db, month),
    referral: await grantReferral(db, month),
  };
}
