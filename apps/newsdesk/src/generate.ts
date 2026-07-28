import type { ObituaryFacts } from "./facts.js";
import { buildObituaryPrompt, parseObituary, type Obituary } from "./prompt.js";
import type { RecentProse } from "./prose-pg-store.js";
import { findPlaceViolations } from "./no-place.js";

/** The one capability the generator needs — real OpenRouter in prod, a stub in tests. */
export interface CompletionClient {
  complete(req: { system: string; user: string }): Promise<string>;
}

/** Gamertags are identity, not scenery — a callsign containing a banned word must not trip. */
function exemptions(facts: ObituaryFacts): string[] {
  return [facts.gamertag, facts.killerGamertag].filter((g): g is string => !!g);
}

/**
 * Build the prompt, call the model, parse + validate. A draft violating THE NO-PLACE RULE gets
 * exactly one retry with the violations named; a second violation throws, landing on the tick's
 * existing failure path (recordObituaryFailure → attempts++ → retried by a later sweep until
 * maxAttempts). Throws on client or parse failure too.
 */
export async function generateObituary(
  client: CompletionClient,
  facts: ObituaryFacts,
  recent: RecentProse[] = [],
): Promise<Obituary> {
  const { system, user } = buildObituaryPrompt(facts, recent);
  const exempt = exemptions(facts);

  const first = parseObituary(await client.complete({ system, user }));
  const violations = findPlaceViolations(first, { exempt });
  if (violations.length === 0) return first;

  const feedback = [
    user,
    "",
    `Your previous draft was rejected: it broke THE NO-PLACE RULE by mentioning ${violations.join(", ")}.`,
    `Rewrite the obituary with ZERO spatial or setting references — the map name is the only place you may use. Respond with only the JSON object.`,
  ].join("\n");
  const second = parseObituary(await client.complete({ system, user: feedback }));
  const still = findPlaceViolations(second, { exempt });
  if (still.length > 0) {
    throw new Error(`no-place violation after retry: ${still.join(", ")}`);
  }
  return second;
}
