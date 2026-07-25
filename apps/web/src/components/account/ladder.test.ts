import { describe, expect, test } from "vitest";
import { ladderSteps } from "./ladder";

describe("ladderSteps", () => {
  test("unlinked: claim is current, prove is still ahead", () => {
    expect(ladderSteps("unlinked").map((s) => s.state)).toEqual(["done", "current", "upcoming"]);
  });

  test("pending: claim is behind you, prove is current", () => {
    expect(ladderSteps("pending").map((s) => s.state)).toEqual(["done", "done", "current"]);
  });

  test("exactly one step is current in every state", () => {
    // Two `current` steps would expand two panels at once — the ladder's whole premise is that
    // one step is open and the rest are one-liners.
    for (const kind of ["unlinked", "pending"] as const) {
      expect(ladderSteps(kind).filter((s) => s.state === "current")).toHaveLength(1);
    }
  });

  test("signing in is always already done — these states are only reachable signed in", () => {
    for (const kind of ["unlinked", "pending"] as const) {
      expect(ladderSteps(kind)[0]).toEqual({ label: "Signed in", state: "done" });
    }
  });

  test("there is no 'go play' step", () => {
    // The site cannot know whether a signed-in user has played until they verify, so a step we
    // could never mark done would strand every player on it. See the ⚠️ in ladder.ts.
    for (const kind of ["unlinked", "pending"] as const) {
      const labels = ladderSteps(kind).map((s) => s.label.toLowerCase());
      expect(labels).toHaveLength(3);
      expect(labels.some((l) => l.includes("play") || l.includes("session"))).toBe(false);
    }
  });

  test("progress only moves forward between the two states", () => {
    // A step that is `done` when unlinked must not regress to `current`/`upcoming` when pending.
    const rank = { upcoming: 0, current: 1, done: 2 };
    const a = ladderSteps("unlinked");
    const b = ladderSteps("pending");
    a.forEach((step, i) => expect(rank[b[i]!.state]).toBeGreaterThanOrEqual(rank[step.state]));
  });
});
