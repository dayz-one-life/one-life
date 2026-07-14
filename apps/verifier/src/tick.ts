import type { Database } from "@onelife/db";
import { getCursor, setCursor, readEventBatch } from "@onelife/event-log";
import { advance } from "@onelife/verification";
import { PgVerifierStore } from "./pg-store.js";

export type TickOpts = { batchSize: number; consumerName?: string; now?: Date };

export async function verifierTick(db: Database, opts: TickOpts): Promise<{ scanned: number; verified: number }> {
  const consumer = opts.consumerName ?? "verifier";
  const cursor = await getCursor(db, consumer);
  const batch = await readEventBatch(db, cursor, opts.batchSize);
  if (batch.length === 0) return { scanned: 0, verified: 0 };

  let scanned = 0;
  let verified = 0;
  await db.transaction(async (tx) => {
    const store = new PgVerifierStore(tx as unknown as Database);
    for (const row of batch) {
      if (row.type !== "emote.performed") continue;
      const payload = row.payload as { gamertag?: string; emote?: string };
      if (!payload.gamertag || !payload.emote) continue;
      scanned++;

      const challenges = await store.findPendingChallenges(payload.gamertag, row.occurredAt);
      for (const c of challenges) {
        if (row.id <= c.lastMatchedEventId) continue; // idempotent monotonic guard (replay-safe)
        const { index, complete } = advance(c.sequence, c.progressIndex, payload.emote);
        if (index === c.progressIndex) continue; // no forward progress; don't touch lastMatchedEventId

        const now = opts.now ?? row.occurredAt;
        await store.advanceChallenge(c.challengeId, index, row.id, complete ? now : null);
        if (!complete) continue;

        const existingVerified = await store.getVerifiedLinkId(payload.gamertag);
        if (existingVerified && existingVerified !== c.linkId) {
          await store.cancelLink(c.linkId); // someone else already won this gamertag
        } else {
          await store.verifyLink(c.linkId, now);
          await store.cancelOtherPendingLinks(payload.gamertag, c.linkId);
          verified++;
        }
      }
    }
    await setCursor(tx as unknown as Database, consumer, batch[batch.length - 1]!.id);
  });
  return { scanned, verified };
}
