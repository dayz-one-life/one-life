import { describe, expect, test } from "vitest";
import { ladderSteps } from "./ladder";

describe("ladderSteps", () => {
  // Pending no longer renders a ladder (it renders PendingHero instead) — unlinked is the only
  // remaining caller, so ladderSteps takes no parameter.
  test("claim is current, prove is still ahead", () => {
    expect(ladderSteps().map((s) => s.state)).toEqual(["done", "current", "upcoming"]);
  });

  test("exactly one step is current", () => {
    // Two `current` steps would expand two panels at once — the ladder's whole premise is that
    // one step is open and the rest are one-liners.
    expect(ladderSteps().filter((s) => s.state === "current")).toHaveLength(1);
  });

  test("signing in is always already done — this state is only reachable signed in", () => {
    expect(ladderSteps()[0]).toEqual({ label: "Signed in", state: "done" });
  });

  test("there is no 'go play' step", () => {
    // The site cannot know whether a signed-in user has played until they verify, so a step we
    // could never mark done would strand every player on it. See the ⚠️ in ladder.ts.
    const labels = ladderSteps().map((s) => s.label.toLowerCase());
    expect(labels).toHaveLength(3);
    expect(labels.some((l) => l.includes("play") || l.includes("session"))).toBe(false);
  });
});
