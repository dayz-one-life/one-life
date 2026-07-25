import type { ServerCardData } from "@/components/account/format";

export type ServerGroup = { state: ServerCardData["state"]; cards: ServerCardData[] };

/**
 * Group order is `banned → alive → idle` — the same ranking `getPlayerPage` already applies when
 * it decides a card's state, so the page and the read-model agree about what matters most.
 *
 * ⚠️ Every server the caller passes comes back. A row that disappears when idle makes a player
 * wonder whether the server is down, and the fleet is a moving target (three today, four when
 * Badlands ships) — so nothing here is keyed to a count.
 *
 * Empty groups are omitted rather than returned with no rows, so a caller can render one heading
 * per group without checking for emptiness.
 */
const ORDER: ServerCardData["state"][] = ["banned", "alive", "idle"];

export function groupServerCards(cards: ServerCardData[]): ServerGroup[] {
  return ORDER.map((state) => ({ state, cards: cards.filter((c) => c.state === state) })).filter(
    (g) => g.cards.length > 0,
  );
}

/**
 * **The entire definition of "hero".** A group holding exactly one row, when it is the only
 * group, renders expanded.
 *
 * Deliberately not a separate hero component, not a promotion tie-break, and not a layout that
 * only works at N ≤ 3: one player on one server gets one big row, and a player spread across four
 * servers in three states gets three ordinary groups. It scales with the fleet by construction.
 */
export function isSoleRow(groups: ServerGroup[]): boolean {
  return groups.length === 1 && groups[0]!.cards.length === 1;
}
