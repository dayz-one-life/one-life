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
 *
 * Pending no longer renders a ladder — its hero's "Step 3 of 3" kicker carries that state
 * (pending-hero spec §2). Unlinked is the only remaining caller, so the parameter is gone.
 */
export function ladderSteps(): LadderStep[] {
  return [
    { label: "Signed in", state: "done" },
    { label: "Claim your gamertag", state: "current" },
    { label: "Prove it's you", state: "upcoming" },
  ];
}
