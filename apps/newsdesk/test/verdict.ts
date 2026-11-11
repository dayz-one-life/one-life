import type { Database } from "@onelife/db";
import { deathVerdicts } from "@onelife/db";
import { CLASSIFIER_VERSION } from "@onelife/death-verdict";

/**
 * A stored death verdict for a seeded life, as the projector's sweep writes it. The newsdesk only
 * writes about a life once one exists at the current version (`findObituaryTargets`), so a test
 * that expects an obituary seeds one. ⚠️ Invented values only.
 */
export async function seedVerdict(db: Database, lifeId: number, over: Partial<typeof deathVerdicts.$inferInsert> = {}): Promise<void> {
  await db.insert(deathVerdicts).values({
    lifeId, classifierVersion: CLASSIFIER_VERSION, settledBy: "file", deathFileId: 1, deathLineIndex: lifeId,
    deathAt: new Date("2031-01-01T00:00:00Z"), cause: "pvp", confidence: "definitive", mechanismStated: true, rule: "A04",
    ...over,
  });
}
