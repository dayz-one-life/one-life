import { describe, expect, test } from "vitest";
import { settleFeed } from "./settle-feed";

describe("settleFeed", () => {
  test("a resolved fetch, even to a genuinely empty feed, is not flagged as failed", async () => {
    const result = await settleFeed(Promise.resolve({ rows: [] as unknown[] }));
    expect(result).toEqual({ data: { rows: [] }, failed: false });
  });

  test("a resolved fetch with rows is not flagged as failed", async () => {
    const result = await settleFeed(Promise.resolve({ rows: [1, 2] }));
    expect(result).toEqual({ data: { rows: [1, 2] }, failed: false });
  });

  test("a REJECTED fetch is flagged failed with null data — distinguishable from genuine emptiness", async () => {
    const result = await settleFeed(Promise.reject(new Error("503")));
    expect(result).toEqual({ data: null, failed: true });
    // The old `.catch(() => null)` pattern produced `data: null` too, but with no `failed`
    // flag — downstream code could not tell this apart from "the desk hasn't published."
  });
});
