import { describe, expect, test } from "vitest";
import { buildSurvivorMetadata } from "./survivor-metadata";

describe("buildSurvivorMetadata", () => {
  test("self-referential canonical, page in title, prev/next", () => {
    const m = buildSurvivorMetadata({
      slug: "chernarus",
      sort: "kills",
      page: 2,
      total: 60,
      pageSize: 25,
      leaderName: "Chad",
    });
    expect(m.alternates?.canonical).toBe("/survivors/chernarus/kills?page=2");
    expect(String(m.title)).toMatch(/Chernarus/);
    expect(String(m.title)).toMatch(/Page 2/);
    // prev/next surfaced via `other`
    expect(m.other?.prev).toBe("/survivors/chernarus/kills");
    expect(m.other?.next).toBe("/survivors/chernarus/kills?page=3");
  });

  test("combined board default page has clean canonical and OG", () => {
    const m = buildSurvivorMetadata({
      slug: null,
      sort: "time",
      page: 1,
      total: 10,
      pageSize: 25,
      leaderName: "Chad",
    });
    expect(m.alternates?.canonical).toBe("/survivors");
    expect(m.openGraph?.title).toBeDefined();
    expect(m.twitter?.title).toBeDefined();
    // combined board uses "survivors" wording, no map name
    expect(String(m.title)).toMatch(/survivors/i);
    // single page -> no prev, no next
    expect(m.other?.prev).toBeUndefined();
    expect(m.other?.next).toBeUndefined();
  });

  test("non-default sort is reflected in title and canonical", () => {
    const m = buildSurvivorMetadata({
      slug: "sakhal",
      sort: "longest",
      page: 1,
      total: 5,
      pageSize: 25,
      leaderName: "Rick",
    });
    expect(m.alternates?.canonical).toBe("/survivors/sakhal/longest");
    expect(String(m.title)).toMatch(/Sakhal/);
    expect(String(m.title)).toMatch(/Longest kill/i);
    expect(String(m.title)).not.toMatch(/Page/);
  });
});
