import type { Database } from "@onelife/db";
import { deathVerdicts } from "@onelife/db";
import { CLASSIFIER_VERSION } from "@onelife/death-verdict";

/**
 * Seed one stored verdict row. ⚠️ Invented values only. The INTERNAL columns are filled with
 * marker strings on purpose, so a leak test can assert that none of them ever reaches a response.
 */
export const INTERNAL_MARKERS = {
  objectText: "INTERNAL_OBJECT_TEXT",
  attrDayzId: "INTERNAL_ATTR_ID",
  rule: "INTERNAL_RULE",
} as const;

export interface SeedVerdict {
  lifeId: number;
  cause: string;
  confidence: string;
  mechanismStated?: boolean;
  objectKey?: string | null;
  upstreamCause?: string | null;
  upstreamConfidence?: string | null;
  conditions?: string[];
  attrBasis?: string | null;
  attrGamertag?: string | null;
  attrRole?: string | null;
  rule?: string;
  needsReview?: boolean;
  classifierVersion?: number;
  evidence?: Record<string, unknown>;
}

export async function seedVerdict(db: Database, v: SeedVerdict): Promise<void> {
  await db.insert(deathVerdicts).values({
    lifeId: v.lifeId,
    classifierVersion: v.classifierVersion ?? CLASSIFIER_VERSION,
    settledBy: "file",
    deathFileId: 1,
    deathLineIndex: v.lifeId,
    deathAt: new Date("2031-01-01T00:00:00Z"),
    cause: v.cause,
    confidence: v.confidence,
    mechanismStated: v.mechanismStated ?? true,
    objectKey: v.objectKey ?? null,
    objectClass: "INTERNAL_OBJECT_CLASS",
    objectText: INTERNAL_MARKERS.objectText,
    upstreamCause: v.upstreamCause ?? null,
    upstreamConfidence: v.upstreamConfidence ?? null,
    conditions: v.conditions ?? [],
    attrRole: v.attrRole ?? null,
    attrBasis: v.attrBasis ?? null,
    attrDayzId: v.attrGamertag ? INTERNAL_MARKERS.attrDayzId : null,
    attrGamertag: v.attrGamertag ?? null,
    rule: v.rule ?? INTERNAL_MARKERS.rule,
    evidence: v.evidence ?? { flags: ["INTERNAL_FLAG"], notes: ["INTERNAL_NOTE"] },
    needsReview: v.needsReview ?? false,
  });
}
