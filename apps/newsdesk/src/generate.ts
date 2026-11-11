import type { ObituaryFacts } from "./facts.js";
import { buildObituaryPrompt, parseObituary, type Obituary } from "./prompt.js";
import type { RecentProse } from "./prose-pg-store.js";
import { findPlaceViolations } from "./no-place.js";
import { findCauseViolations } from "./cause-check.js";

/** The one capability the generator needs — real OpenRouter in prod, a stub in tests. */
export interface CompletionClient {
  complete(req: { system: string; user: string }): Promise<string>;
}

/** Internal hints for the cause check (`getDeathCheckHints`). Never sent to the model. */
export interface CheckHints { logoutFamily: boolean }

const NO_HINTS: CheckHints = { logoutFamily: false };

/**
 * Gamertags are identity, not scenery — a callsign containing a banned word must not trip. The
 * credited trap-setter is the third name an article can legitimately carry (spec 6.1).
 */
export function exemptions(facts: ObituaryFacts): string[] {
  return [facts.gamertag, facts.killerGamertag, facts.creditedGamertag].filter((g): g is string => !!g);
}

/** Both deterministic checks on one draft. */
export function checkDraft(obituary: Obituary, facts: ObituaryFacts, hints: CheckHints): { place: string[]; cause: string[] } {
  return {
    place: findPlaceViolations(obituary, { exempt: exemptions(facts) }),
    cause: findCauseViolations(obituary, facts, hints),
  };
}

/**
 * Build the prompt, call the model, parse + validate. A draft violating THE NO-PLACE RULE or the
 * cause check (`cause-check.ts`) gets exactly one retry with the violations named; a second
 * violation throws, landing on the tick's existing failure path (recordObituaryFailure →
 * attempts++ → retried by a later sweep until maxAttempts). Throws on client or parse failure too.
 */
export async function generateObituary(
  client: CompletionClient,
  facts: ObituaryFacts,
  recent: RecentProse[] = [],
  hints: CheckHints = NO_HINTS,
): Promise<Obituary> {
  const { system, user } = buildObituaryPrompt(facts, recent);

  const first = parseObituary(await client.complete({ system, user }));
  const v1 = checkDraft(first, facts, hints);
  if (v1.place.length === 0 && v1.cause.length === 0) return first;

  const feedback = [user, "", `Your previous draft was rejected.`];
  if (v1.place.length) {
    feedback.push(
      `It used banned subject matter — ${v1.place.join(", ")}. Locations and player-built construction are both off-limits.`,
      `Rewrite with ZERO spatial or setting references and no mention of building or structures — the map name is the only place you may use.`,
    );
  }
  if (v1.cause.length) {
    feedback.push(
      `It broke the rules about the cause of death: ${v1.cause.join("; ")}.`,
      `Follow the instructions about the cause exactly as given above.`,
    );
  }
  feedback.push(`Respond with only the JSON object.`);
  const second = parseObituary(await client.complete({ system, user: feedback.join("\n") }));
  const v2 = checkDraft(second, facts, hints);
  if (v2.place.length > 0) throw new Error(`no-place violation after retry: ${v2.place.join(", ")}`);
  if (v2.cause.length > 0) throw new Error(`cause-check violation after retry: ${v2.cause.join("; ")}`);
  return second;
}
