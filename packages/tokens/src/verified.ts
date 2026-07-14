import { and, eq } from "drizzle-orm";
import { type Database, gamertagLinks } from "@onelife/db";

/** A user is verified once they hold at least one verified gamertag link. */
export async function isVerifiedUser(db: Database, userId: string): Promise<boolean> {
  const [r] = await db
    .select({ id: gamertagLinks.id })
    .from(gamertagLinks)
    .where(and(eq(gamertagLinks.userId, userId), eq(gamertagLinks.status, "verified")))
    .limit(1);
  return !!r;
}

export async function verifiedUserIds(db: Database): Promise<string[]> {
  const rows = await db
    .selectDistinct({ userId: gamertagLinks.userId })
    .from(gamertagLinks)
    .where(eq(gamertagLinks.status, "verified"));
  return rows.map((r) => r.userId);
}
