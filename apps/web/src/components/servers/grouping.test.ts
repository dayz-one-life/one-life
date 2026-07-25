import { describe, expect, test } from "vitest";
import type { ServerCardData } from "@/components/account/format";
import { groupServerCards, isSoleRow } from "./grouping";

const card = (slug: string, state: ServerCardData["state"], qualified = true): ServerCardData => ({
  slug, map: "sakhal", state, lifeNumber: 1,
  alive: state === "alive" ? { timeAliveSeconds: 100, kills: 0, qualified, startedAt: null } : null,
  ban: state === "banned" ? { banId: 1, bannedAt: "2026-07-01T00:00:00Z", expiresAt: null, liftPending: false, verdict: null } : null,
  lastEndedAt: null,
});

describe("groupServerCards", () => {
  test("orders groups banned → alive → idle, the order the backend already ranks", () => {
    const groups = groupServerCards([card("a", "idle"), card("b", "alive"), card("c", "banned")]);
    expect(groups.map((g) => g.state)).toEqual(["banned", "alive", "idle"]);
  });

  // Every server always shown: a row that disappears when idle makes the player wonder whether
  // the server is down. The fleet is three today and four when Badlands ships.
  test("keeps every server, whatever the fleet size", () => {
    const cards = [card("a", "idle"), card("b", "alive"), card("c", "banned"), card("d", "idle")];
    const groups = groupServerCards(cards);
    expect(groups.flatMap((g) => g.cards.map((c) => c.slug)).sort()).toEqual(["a", "b", "c", "d"]);
  });

  test("omits groups with no rows rather than rendering an empty heading", () => {
    const groups = groupServerCards([card("a", "alive"), card("b", "alive")]);
    expect(groups.map((g) => g.state)).toEqual(["alive"]);
  });

  test("preserves the incoming order within a group", () => {
    const groups = groupServerCards([card("z", "idle"), card("a", "idle")]);
    expect(groups[0]!.cards.map((c) => c.slug)).toEqual(["z", "a"]);
  });

  test("an empty fleet yields no groups, not an empty idle group", () => {
    expect(groupServerCards([])).toEqual([]);
  });
});

describe("isSoleRow — the entire definition of 'hero'", () => {
  // Deliberately NOT a separate hero component, a promotion tie-break, or a layout that only
  // works at N <= 3. One conditional, and it scales with the fleet by construction.
  test("true for exactly one group holding exactly one row", () => {
    expect(isSoleRow(groupServerCards([card("a", "alive")]))).toBe(true);
  });

  test("false when the single group holds more than one row", () => {
    expect(isSoleRow(groupServerCards([card("a", "alive"), card("b", "alive")]))).toBe(false);
  });

  test("false when there is more than one group, even if each holds one row", () => {
    expect(isSoleRow(groupServerCards([card("a", "alive"), card("b", "idle")]))).toBe(false);
  });

  test("false for an empty fleet", () => {
    expect(isSoleRow([])).toBe(false);
  });
});
