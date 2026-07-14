import { describe, it, expect } from "vitest";
import { NitradoClient } from "../src/client.js";

/** Fake fetch: GET settings returns the given ban string; POST records its parsed body. */
function makeFake(bansField: string, status = "success") {
  const posts: Array<{ category: string; key: string; value: string }> = [];
  const fetchFn = (async (_url: string, init?: { method?: string; body?: string }) => {
    if (init?.method === "POST") {
      posts.push(JSON.parse(init.body!));
      return { ok: true, json: async () => ({ status: "success", data: {} }) } as Response;
    }
    return {
      ok: true,
      json: async () => ({ status, data: { settings: { general: { bans: bansField } } } }),
    } as Response;
  }) as unknown as typeof fetch;
  return { fetchFn, posts };
}

describe("NitradoClient ban list", () => {
  it("getBans parses the \\r\\n string into trimmed non-empty names", async () => {
    const { fetchFn } = makeFake("Alice\r\nBob \r\n\r\n  Cee Lo GREEN 96\r\n");
    const c = new NitradoClient("tok", 123, fetchFn);
    expect(await c.getBans()).toEqual(["Alice", "Bob", "Cee Lo GREEN 96"]);
  });

  it("addBan appends the name and POSTs the whole \\r\\n-joined list", async () => {
    const { fetchFn, posts } = makeFake("Alice\r\nBob");
    const c = new NitradoClient("tok", 123, fetchFn);
    await c.addBan("Carol");
    expect(posts).toEqual([{ category: "general", key: "bans", value: "Alice\r\nBob\r\nCarol" }]);
  });

  it("addBan is idempotent (no POST when already present)", async () => {
    const { fetchFn, posts } = makeFake("Alice\r\nBob");
    const c = new NitradoClient("tok", 123, fetchFn);
    await c.addBan("Alice");
    expect(posts).toEqual([]);
  });

  it("removeBan POSTs the list minus the exact name", async () => {
    const { fetchFn, posts } = makeFake("Alice\r\nBob\r\nCarol");
    const c = new NitradoClient("tok", 123, fetchFn);
    await c.removeBan("Bob");
    expect(posts).toEqual([{ category: "general", key: "bans", value: "Alice\r\nCarol" }]);
  });

  it("throws on a non-success envelope", async () => {
    const { fetchFn } = makeFake("Alice", "error");
    const c = new NitradoClient("tok", 123, fetchFn);
    await expect(c.getBans()).rejects.toThrow(/Nitrado/);
  });
});
