import type { Database } from "@onelife/db";
import { gamertagLinks, verificationChallenges } from "@onelife/db";
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

  /** Open (pending, not completed, in-window) challenges for a gamertag on a server. */
  async findPendingChallenges(serverId: number, gamertag: string, at: Date): Promise<PendingChallenge[]> {
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
        eq(gamertagLinks.serverId, serverId),
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

  async getVerifiedLinkId(serverId: number, gamertag: string): Promise<number | null> {
    const r = await this.tx.select({ id: gamertagLinks.id }).from(gamertagLinks)
      .where(and(eq(gamertagLinks.serverId, serverId), eq(gamertagLinks.gamertag, gamertag), eq(gamertagLinks.status, "verified")));
    return r[0]?.id ?? null;
  }

  async verifyLink(linkId: number, verifiedAt: Date): Promise<void> {
    await this.tx.update(gamertagLinks).set({ status: "verified", verifiedAt }).where(eq(gamertagLinks.id, linkId));
  }

  async cancelLink(linkId: number): Promise<void> {
    await this.tx.update(gamertagLinks).set({ status: "cancelled" }).where(eq(gamertagLinks.id, linkId));
  }

  async cancelOtherPendingLinks(serverId: number, gamertag: string, exceptLinkId: number): Promise<void> {
    await this.tx.update(gamertagLinks).set({ status: "cancelled" })
      .where(and(
        eq(gamertagLinks.serverId, serverId),
        eq(gamertagLinks.gamertag, gamertag),
        eq(gamertagLinks.status, "pending"),
        ne(gamertagLinks.id, exceptLinkId),
      ));
  }
}
