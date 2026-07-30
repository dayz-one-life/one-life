import type { Database } from "@onelife/db";
import { gamertagLinks, locationShares, verificationChallenges } from "@onelife/db";
import { and, asc, eq, gt, lt, ne, isNull, sql as dsql } from "drizzle-orm";

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
        dsql`lower(${gamertagLinks.gamertag}) = lower(${gamertag})`,
        eq(gamertagLinks.status, "pending"),
        isNull(verificationChallenges.completedAt),
        gt(verificationChallenges.expiresAt, at),
        lt(verificationChallenges.issuedAt, at),
      ))
      // ⚠️ Load-bearing, not cosmetic. Two users can hold pending links for the same gamertag
      // (in the same or differing casing), and this is the only thing that decides which one
      // completes first — i.e. which one WINS. Without it the winner is whatever order the
      // planner happens to return, so first-verify-wins is untestable and its behaviour can
      // flip under an index or statistics change with no code change at all.
      .orderBy(asc(gamertagLinks.id));
    return rows.map((r) => ({ ...r, sequence: r.sequence as string[] }));
  }

  async advanceChallenge(challengeId: number, progressIndex: number, lastMatchedEventId: number, completedAt: Date | null): Promise<void> {
    await this.tx.update(verificationChallenges)
      .set({ progressIndex, lastMatchedEventId, completedAt })
      .where(eq(verificationChallenges.id, challengeId));
  }

  async getVerifiedLinkId(gamertag: string): Promise<number | null> {
    const r = await this.tx.select({ id: gamertagLinks.id }).from(gamertagLinks)
      .where(and(
        dsql`lower(${gamertagLinks.gamertag}) = lower(${gamertag})`,
        eq(gamertagLinks.status, "verified"),
      ));
    return r[0]?.id ?? null;
  }

  /**
   * Marks a link verified AND clears that user's outbound location-sharing grants.
   *
   * Both happen in the same transaction, deliberately. A re-verified link is a NEW claim on
   * that identity and must not inherit outbound sharing granted under the old one — this is
   * the session-scoped-grants half of what used to also reset a friends presence switch before
   * the v0.69 friends teardown removed that table entirely. One-directional: it clears what
   * this user shares, never what others share with them.
   */
  async verifyLink(linkId: number, verifiedAt: Date): Promise<void> {
    const [link] = await this.tx
      .update(gamertagLinks)
      .set({ status: "verified", verifiedAt })
      .where(eq(gamertagLinks.id, linkId))
      .returning({ userId: gamertagLinks.userId });
    if (!link) return;
    await this.tx.delete(locationShares).where(eq(locationShares.granterUserId, link.userId));
  }

  async cancelLink(linkId: number): Promise<void> {
    await this.tx.update(gamertagLinks).set({ status: "cancelled" }).where(eq(gamertagLinks.id, linkId));
  }

  async cancelOtherPendingLinks(gamertag: string, exceptLinkId: number): Promise<void> {
    await this.tx.update(gamertagLinks).set({ status: "cancelled" })
      .where(and(
        dsql`lower(${gamertagLinks.gamertag}) = lower(${gamertag})`,
        eq(gamertagLinks.status, "pending"),
        ne(gamertagLinks.id, exceptLinkId),
      ));
  }
}
