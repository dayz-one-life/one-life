import type { DeathContext, Hit } from "../context/build.js";
import { refKey, type StampedLine } from "../context/server.js";
import { isoSeconds } from "../evidence/log-clock.js";
import type {
  AttributionBasis, AttributionRole, Confidence, ContributorRole, CreditEvidence, Condition, InternalCause, InternalVerdict,
} from "../types.js";
import { objectKeyFromText } from "../vocabulary.js";

/**
 * What a rule returns, before the post-pass and before it is shaped into an `InternalVerdict`.
 * A port of the dict the reference's `out()` builds, without its research prose (`sub_cause`,
 * `stated`, `inferred`): the operator reads the rule id, the flags, the notes and the evidence
 * lines instead.
 */
export interface Draft {
  rule: string;
  cause: InternalCause;
  confidence: Confidence;
  mechanismStated: boolean;
  /** The reference's `weapon_or_object`, verbatim. */
  objectText: string | null;
  /** The class the kill line names where a player would be, when it names one. */
  objectClass: string | null;
  upstream: { cause: string; confidence: Confidence } | null;
  coCauses: string[];
  attribution: InternalVerdict["attribution"];
  contributors: InternalVerdict["evidence"]["contributors"];
  flags: string[];
  notes: string[];
  /** At most 14 lines, no line twice. */
  evidence: StampedLine[];
}

export const EVIDENCE_MAX = 14;

/** A player a verdict is attributed to. ⚠️ `basis` is set by the rule, never worked out later:
 *  it decides whether the name may ever be printed (see `AttributionBasis`). */
export function att(name: string, id: string, role: AttributionRole, basis: AttributionBasis, confidence: Confidence): NonNullable<Draft["attribution"]> {
  return { role, basis, dayzId: id, gamertag: name, confidence };
}

export function contributor(name: string, id: string, role: ContributorRole, confidence: Confidence): Draft["contributors"][number] {
  return { role, dayzId: id, gamertag: name, confidence };
}

export interface OutOptions {
  mech?: boolean;
  weapon?: string | null;
  className?: string | null;
  upstream?: string | null;
  upstreamConf?: Confidence | null;
  co?: string[];
  attributed?: Draft["attribution"];
  contributors?: Draft["contributors"];
  flags?: string[];
  notes?: string[];
  evidence?: (StampedLine | Hit | null | undefined)[];
}

/** Builds a rule's answer. The mechanism counts as stated unless the rule says otherwise. */
export function out(rule: string, cause: InternalCause, confidence: Confidence, o: OutOptions = {}): Draft {
  const evidence: StampedLine[] = [];
  const seen = new Set<string>();
  for (const e of o.evidence ?? []) {
    if (e == null) continue;
    const line = "o" in e ? e.o : e;
    const key = refKey(line);
    if (seen.has(key)) continue;
    seen.add(key);
    evidence.push(line);
  }
  return {
    rule, cause, confidence, mechanismStated: o.mech ?? true,
    objectText: o.weapon ?? null, objectClass: o.className ?? null,
    upstream: o.upstream != null ? { cause: o.upstream, confidence: o.upstreamConf ?? "unknown" } : null,
    coCauses: o.co ?? [], attribution: o.attributed ?? null, contributors: o.contributors ?? [],
    flags: o.flags ?? [], notes: o.notes ?? [], evidence: evidence.slice(0, EVIDENCE_MAX),
  };
}

/** The role a line of evidence is stored under: its role in the death when it is one of the death
 *  lines, else the kind of line it is. */
function evidenceRole(c: DeathContext, o: StampedLine): string {
  const d = c.dl.find((x) => x.line === o);
  return d ? d.role : o.kind;
}

/** The stored verdict, from a rule's answer. */
export function toVerdict(c: DeathContext, d: Draft, conditions: Condition[], credit: CreditEvidence | null): InternalVerdict {
  return {
    cause: d.cause,
    confidence: d.confidence,
    mechanismStated: d.mechanismStated,
    object: d.objectText == null && d.objectClass == null ? null
      : { key: objectKeyFromText(d.objectText), className: d.objectClass, text: d.objectText },
    upstream: d.upstream,
    coCauses: d.coCauses,
    attribution: d.attribution,
    rule: d.rule,
    deathRef: c.cluster.primary,
    deathLines: c.cluster.lines.map((l) => ({ ...l.ref, role: l.role })),
    deathAt: isoSeconds(c.t0),
    conditions,
    evidence: {
      refs: d.evidence.map((o) => ({ admFileId: o.admFileId, lineIndex: o.lineIndex, role: evidenceRole(c, o) })),
      flags: d.flags, contributors: d.contributors, notes: d.notes, credit,
    },
  };
}

// ---- formatting, for operator notes only. No golden answer depends on a note's text.
export const f0 = (x: number): string => x.toFixed(0);
export const f1 = (x: number | null | undefined): string => (x ?? -1).toFixed(1);
export const lineRef = (o: StampedLine): string => refKey(o);
