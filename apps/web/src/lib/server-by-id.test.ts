import { describe, it, expect, vi, afterEach } from "vitest";
import { slugForServerId } from "./server-by-id";

afterEach(() => vi.restoreAllMocks());

describe("slugForServerId", () => {
  it("maps a serverId to its slug", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([{ id: 2, slug: "sakhal" }]), { status: 200 })
    );
    expect(await slugForServerId(2)).toBe("sakhal");
  });
  it("returns null for unknown id", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("[]", { status: 200 }));
    expect(await slugForServerId(99)).toBeNull();
  });
});
