import { describe, expect, test } from "vitest";
import { buildSurvivorMetadata } from "./survivor-metadata";

describe("buildSurvivorMetadata", () => {
  test("self-referential canonical, page in title, prev/next", () => {
    const m = buildSurvivorMetadata({
      slug: "chernarus", page: 2, total: 60, pageSize: 25, leaderName: "Chad",
    });
    // ⚠️ Self-referential, NOT collapsed to page 1 — a paginated URL canonicalises to itself.
    expect(m.alternates?.canonical).toBe("/survivors/chernarus?page=2");
    expect(String(m.title)).toMatch(/Chernarus/);
    expect(String(m.title)).toMatch(/Page 2/);
    expect(m.other?.prev).toBe("/survivors/chernarus");
    expect(m.other?.next).toBe("/survivors/chernarus?page=3");
  });

  test("page 1 has a clean canonical and full OG", () => {
    const m = buildSurvivorMetadata({
      slug: "chernarus", page: 1, total: 10, pageSize: 25, leaderName: "Chad",
    });
    expect(m.alternates?.canonical).toBe("/survivors/chernarus");
    expect(m.openGraph?.title).toBeDefined();
    expect(m.twitter?.title).toBeDefined();
    // single page -> no prev, no next
    expect(m.other?.prev).toBeUndefined();
    expect(m.other?.next).toBeUndefined();
  });

  test("the title always names the map", () => {
    expect(String(buildSurvivorMetadata({ slug: "sakhal", page: 1, total: 5, pageSize: 25 }).title))
      .toMatch(/Sakhal/);
  });

  // ⚠️ The `by {sort}` clause is gone with the sort layer. There is one ranking, so naming it in
  // every title said nothing — and naming a sort that no longer exists would be a lie.
  test("no sort clause survives in the title, description or canonical", () => {
    const m = buildSurvivorMetadata({ slug: "chernarus", page: 1, total: 5, pageSize: 25 });
    expect(String(m.title)).not.toMatch(/\bby\b/i);
    expect(m.alternates?.canonical).not.toMatch(/kills|longest/);
    // The description may still say "time alive" — that is the ranking, stated once.
    expect(String(m.description)).not.toMatch(/longest kill/i);
  });

  test("a leader is named when there is one, and the sentence still reads without one", () => {
    const withLeader = buildSurvivorMetadata({ slug: "sakhal", page: 1, total: 5, pageSize: 25, leaderName: "Rick" });
    expect(String(withLeader.description)).toMatch(/Rick leads the pack\./);
    const without = buildSurvivorMetadata({ slug: "sakhal", page: 1, total: 5, pageSize: 25 });
    expect(String(without.description)).not.toMatch(/leads the pack/);
    expect(String(without.description)).toMatch(/\.$/);
  });
});
