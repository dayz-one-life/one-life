import type { DeathContext } from "../context/build.js";
import type { InternalVerdict } from "../types.js";
import { classifyBare } from "./bare.js";
import { conditions } from "./conditions.js";
import { creditEvidence, inCreditScope } from "./credit.js";
import { finish } from "./finish.js";
import { classifyKilled } from "./killed.js";
import { toVerdict, type Draft } from "./verdict.js";

/**
 * The verdict for one death: the first rule that matches, then the post-pass, then the evidence
 * half of the trap-kill bar.
 *
 * ⚠️ ONLY THE STATED RULES ARE PORTED. A death with a kill line (A01 to A17) or with a stated
 * mechanism on a bare death line (B01 to B08) gets the reference's answer. Every other death
 * comes back as rule `B00`, cause `unknown`: the rules that read timing, speed and health
 * bookkeeping are not ported yet. Nothing may store or show a verdict until they are — the
 * golden attestation's `gaps` says how many deaths that is.
 *
 * ⚠️ Not ported, on purpose: the reference's last pass over a player's NEXT death (a chain of
 * grenade deaths seconds after respawning raises `self (spawn reset)` to strong). A verdict that
 * depends on the future would change after it was stored, and no One Life death has the shape.
 *
 * ⚠️ The classifier never reads what the event parser or the life row says the cause was.
 */
export function classifyDeath(ctx: DeathContext): InternalVerdict {
  const first: Draft = ctx.killer ? classifyKilled(ctx) : classifyBare(ctx);
  // B00 is "no rule yet", not a verdict: it gets no post-pass.
  const draft = first.rule === "B00" ? first : finish(ctx, first);
  const verdict = toVerdict(ctx, draft, conditions(ctx), null);
  if (inCreditScope(verdict)) verdict.evidence.credit = creditEvidence(ctx, verdict);
  return verdict;
}
