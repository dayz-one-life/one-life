import { safeVerificationEmotes } from "@onelife/domain";

/** Draw `length` distinct safe emote tokens, in a random order. `rng` is injected for testability. */
export function generateSequence(rng: () => number, length = 3): string[] {
  const avail = safeVerificationEmotes().map((e) => e.token);
  const chosen: string[] = [];
  for (let i = 0; i < length && avail.length > 0; i++) {
    const j = Math.floor(rng() * avail.length);
    chosen.push(avail.splice(j, 1)[0]!);
  }
  return chosen;
}

export function isExpired(challenge: { expiresAt: Date }, now: Date): boolean {
  return now.getTime() > challenge.expiresAt.getTime();
}
