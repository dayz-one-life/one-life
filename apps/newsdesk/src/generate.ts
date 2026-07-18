import type { ObituaryFacts } from "./facts.js";
import { buildObituaryPrompt, parseObituary, type Obituary } from "./prompt.js";
import type { BirthFacts } from "./birth-facts.js";
import { buildBirthPrompt, parseBirthNotice, type BirthNotice } from "./birth-prompt.js";
import type { RecentProse } from "./prose-pg-store.js";

/** The one capability the generator needs — real OpenRouter in prod, a stub in tests. */
export interface CompletionClient {
  complete(req: { system: string; user: string }): Promise<string>;
}

/** Build the prompt, call the model, parse + validate. Throws on client or parse failure. */
export async function generateObituary(
  client: CompletionClient,
  facts: ObituaryFacts,
  recent: RecentProse[] = [],
): Promise<Obituary> {
  const { system, user } = buildObituaryPrompt(facts, recent);
  const raw = await client.complete({ system, user });
  return parseObituary(raw);
}

/** Birth-pass sibling of generateObituary: build the Nursery prompt, call the model, parse + validate. */
export async function generateBirthNotice(
  client: CompletionClient,
  facts: BirthFacts,
  recent: RecentProse[] = [],
): Promise<BirthNotice> {
  const { system, user } = buildBirthPrompt(facts, recent);
  const raw = await client.complete({ system, user });
  return parseBirthNotice(raw);
}
