import type { Database } from "@onelife/db";
import { gamertagLinks, verificationChallenges, userPreferences } from "@onelife/db";
import { and, eq, gt, lt, ne, isNull } from "drizzle-orm";

export type PendingChallenge = {
  challengeId: number;
  linkId: number;
  sequence: string[];
  progressIndex: number;
  lastMatchedEventId: number;
};

// `tx` is a Drizzle transaction handle (same surface as Database).
export class PgVerifierStore {
  constructor(private tx: Database) {}

  /** Open (pending, not completed, in-window) challenges for a gamertag, across all servers. */
  async findPendingChallenges(gamertag: string, at: Date): Promise<PendingChallenge[]> {
    const rows = await this.tx
      .select({
        challengeId: verificationChallenges.id,
        linkId: gamertagLinks.id,
        sequence: verificationChallenges.sequence,
        progressIndex: verificationChallenges.progressIndex,
        lastMatchedEventId: verificationChallenges.lastMatchedEventId,
      })
      .from(verificationChallenges)
      .innerJoin(gamertagLinks, eq(verificationChallenges.gamertagLinkId, gamertagLinks.id))
      .where(and(
        eq(gamertagLinks.gamertag, gamertag),
        eq(gamertagLinks.status, "pending"),
        isNull(verificationChallenges.completedAt),
        gt(verificationChallenges.expiresAt, at),
        lt(verificationChallenges.issuedAt, at),
      ));
    return rows.map((r) => ({ ...r, sequence: r.sequence as string[] }));
  }

  async advanceChallenge(challengeId: number, progressIndex: number, lastMatchedEventId: number, completedAt: Date | null): Promise<void> {
    await this.tx.update(verificationChallenges)
      .set({ progressIndex, lastMatchedEventId, completedAt })
      .where(eq(verificationChallenges.id, challengeId));
  }

  async getVerifiedLinkId(gamertag: string): Promise<number | null> {
    const r = await this.tx.select({ id: gamertagLinks.id }).from(gamertagLinks)
      .where(and(eq(gamertagLinks.gamertag, gamertag), eq(gamertagLinks.status, "verified")));
    return r[0]?.id ?? null;
  }

  /**
   * Marks a link verified AND resets that user's sharing master switches.
   *
   * Both happen in the same transaction, deliberately. A friendship's per-pair sharing flags
   * survive a link being released, so without this a user who releases a gamertag and later
   * verifies a DIFFERENT one silently resurrects consent their friends granted against the old
   * identity (F1's deferred prerequisite; see the F2 spec §4).
   *
   * This fires on EVERY verification, not only a re-verification. For a first-time verifier it
   * updates zero rows — an absent user_preferences row already means false — so there is no
   * "is this a re-verification?" branch to get wrong, and no row is created just to hold
   * defaults.
   */
  async verifyLink(linkId: number, verifiedAt: Date): Promise<void> {
    const [link] = await this.tx
      .update(gamertagLinks)
      .set({ status: "verified", verifiedAt })
      .where(eq(gamertagLinks.id, linkId))
      .returning({ userId: gamertagLinks.userId });
    if (!link) return;
    await this.tx
      .update(userPreferences)
      .set({ sharePresence: false, shareLocation: false, updatedAt: verifiedAt })
      .where(eq(userPreferences.userId, link.userId));
  }

  async cancelLink(linkId: number): Promise<void> {
    await this.tx.update(gamertagLinks).set({ status: "cancelled" }).where(eq(gamertagLinks.id, linkId));
  }

  async cancelOtherPendingLinks(gamertag: string, exceptLinkId: number): Promise<void> {
    await this.tx.update(gamertagLinks).set({ status: "cancelled" })
      .where(and(
        eq(gamertagLinks.gamertag, gamertag),
        eq(gamertagLinks.status, "pending"),
        ne(gamertagLinks.id, exceptLinkId),
      ));
  }
}
