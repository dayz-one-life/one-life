/** Where a step sits relative to the player's progress. */
export type LadderState = "done" | "current" | "upcoming";

export type LadderStep = { label: string; state: LadderState };

/**
 * The onboarding ladder: signed in → claim your gamertag → prove it's you.
 *
 * ⚠️ "Go play a session" is deliberately NOT a step. The claim autocomplete searches gamertags
 * the LOGS have seen, and anyone can type any gamertag, so the site can never know whether a
 * signed-in user has played until they verify. Adding a step we cannot mark done would strand
 * every player on it. "Go play" belongs in the claim step's empty state (the How to connect
 * panel), nowhere else.
 *
 * Exactly one step is `current` in every state — that is what "the current step expands and the
 * others collapse to a line" means, and a second `current` would expand two panels at once.
 */
export function ladderSteps(kind: "unlinked" | "pending"): LadderStep[] {
  return [
    { label: "Signed in", state: "done" },
    { label: "Claim your gamertag", state: kind === "unlinked" ? "current" : "done" },
    { label: "Prove it's you", state: kind === "unlinked" ? "upcoming" : "current" },
  ];
}
