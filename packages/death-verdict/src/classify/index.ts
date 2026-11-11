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
 * The whole ladder of the reference is ported: the stated rules (a kill line, A01 to A17; a stated
 * mechanism on a bare death line, B01 to B08) and the inferred ones (B09 to B23), which read
 * timing, speed and health bookkeeping and never claim more than strong. A death nothing
 * explains is rule B19, `unknown`. The golden attestation's `gaps` counts the deaths that differ
 * from the reference; readers may show verdicts only while it is 0.
 *
 * ⚠️ Not ported, on purpose: the reference's last pass over a player's NEXT death (a chain of
 * grenade deaths seconds after respawning raises `self (spawn reset)` to strong). A verdict that
 * depends on the future would change after it was stored, and no One Life death has the shape.
 *
 * ⚠️ The classifier never reads what the event parser or the life row says the cause was.
 */
export function classifyDeath(ctx: DeathContext): InternalVerdict {
  const first: Draft = ctx.killer ? classifyKilled(ctx) : classifyBare(ctx);
  const draft = finish(ctx, first);
  const verdict = toVerdict(ctx, draft, conditions(ctx), null);
  if (inCreditScope(verdict)) verdict.evidence.credit = creditEvidence(ctx, verdict);
  return verdict;
}
