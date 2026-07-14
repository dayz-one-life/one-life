import { describe, it, expect, vi, afterEach } from "vitest";
import { getServerBySlug } from "./servers";

afterEach(() => vi.restoreAllMocks());

describe("getServerBySlug", () => {
  it("returns the server whose slug matches", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify([
      { id: 1, slug: "chernarus", map: "chernarusplus", name: "Chernarus" },
      { id: 2, slug: "sakhal", map: "sakhal", name: "Sakhal" },
    ]), { status: 200 }));
    const s = await getServerBySlug("sakhal");
    expect(s?.id).toBe(2);
  });
  it("returns null when no slug matches", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("[]", { status: 200 }));
    expect(await getServerBySlug("nope")).toBeNull();
  });
});
