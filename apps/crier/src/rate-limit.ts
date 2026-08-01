/** A 429 from a channel: throttling, NOT failure.
 *
 *  ⚠️ The tick must not call recordFailure for this — burning one of the 5 attempts on a rate
 *  limit would permanently poison every row a backfill touches, since CRIER_BATCH_CAP (10 per
 *  60s tick) runs ~150 posts per 15 minutes against X's ceiling of 100. The attempt budget is
 *  reserved for real errors like a revoked key. */
export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}
