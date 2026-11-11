import type { DeathContext } from "../context/build.js";
import { isoSeconds } from "../evidence/log-clock.js";
import type { InternalVerdict } from "../types.js";

/**
 * The verdict for one death.
 *
 * ⚠️ NOT A CLASSIFIER YET. No rule is ported: every death comes back `unknown`, with only the
 * parts the context already settles — which line the death is keyed on, the lines that make it
 * up, and when it happened by the log's own clock. Nothing may store or show this verdict.
 */
export function classifyDeath(ctx: DeathContext): InternalVerdict {
  return {
    cause: "unknown",
    confidence: "unknown",
    mechanismStated: false,
    object: null,
    upstream: null,
    coCauses: [],
    attribution: null,
    rule: "B00",
    deathRef: ctx.cluster.primary,
    deathLines: ctx.cluster.lines.map((l) => ({ ...l.ref, role: l.role })),
    deathAt: isoSeconds(ctx.t0),
    conditions: [],
    evidence: { refs: [], flags: [], contributors: [], notes: [], credit: null },
  };
}
